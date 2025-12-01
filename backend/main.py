import os
import time
import firebase_admin
from firebase_admin import credentials, firestore, storage, messaging
from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import Optional
import pandas as pd
import numpy as np
from datetime import datetime

from dotenv import load_dotenv

load_dotenv()

# --- 1. SETUP FIREBASE ---
if not firebase_admin._apps:
    cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH")
    if cred_path and os.path.exists(cred_path):
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
    else:
        print("Warning: FIREBASE_CREDENTIALS_PATH not found or invalid. Attempting default init.")
        firebase_admin.initialize_app() 

db = firestore.client()
bucket = storage.bucket()

app = FastAPI()

# --- 2. CUSTOMIZABLE CONVERTER LOGIC ---

class SpreadsheetLogic:
    def __init__(self):
        print("Initializing Spreadsheet Converter Engine...")

    def clean_headers(self, df):
        df.columns = df.columns.str.strip().str.lower().str.replace(' ', '_')
        return df

    def apply_business_rules(self, df, category: str):
        """
        Custom Logic zależy teraz także od kategorii pliku.
        """
        # Logika wspólna
        df = df.fillna('') 

        # Logika specyficzna dla kategorii
        if category == 'financial':
            if 'amount' in df.columns:
                 df['amount'] = pd.to_numeric(df['amount'], errors='coerce').fillna(0)
        elif category == 'inventory':
            if 'stock' in df.columns:
                df['low_stock_alert'] = np.where(pd.to_numeric(df['stock'], errors='coerce') < 10, True, False)
        
        return df

    def process(self, raw_data, category: str):
        print(f"Converting {len(raw_data)} records for category: {category}...")
        df = pd.DataFrame(raw_data)
        df = self.clean_headers(df)
        df = self.apply_business_rules(df, category)
        return df.to_dict(orient='records')

converter = SpreadsheetLogic()

# --- 3. DATA MODELS ---

class ProcessRequest(BaseModel):
    filePath: str
    fileName: str
    userId: str
    category: str
    fileType: str # 'main' lub 'side'
    customName: Optional[str] = None # Tylko dla side files
    expiryDate: Optional[str] = None # Tylko dla side files (Format YYYY-MM-DD)

class DeleteRequest(BaseModel):
    taskId: str
    userId: str

# --- 4. CORE LOGIC ---

def process_file_task(request: ProcessRequest):
    temp_path = f"/tmp/{request.fileName}"
    # Ensure /tmp exists or use a local temp dir
    os.makedirs("/tmp", exist_ok=True)
    
    task_ref = None

    try:
        print(f"[{request.userId}] Processing {request.fileType} file: {request.fileName}")
        
        # A. Przygotuj dane do zapisu w Firestore
        task_data = {
            'fileName': request.fileName,
            'uploadedBy': request.userId,
            'status': 'processing',
            'category': request.category,
            'type': request.fileType,
            'createdAt': firestore.SERVER_TIMESTAMP,
            'notificationSent': False
        }

        # Dla plików pobocznych dodajemy nazwę własną i datę ważności
        if request.fileType == 'side':
            task_data['customName'] = request.customName
            if request.expiryDate:
                task_data['expiryDate'] = request.expiryDate
                # Opcjonalnie: Ustawienie pola dla Firebase TTL Policy (jeśli skonfigurowane w konsoli)
                # task_data['expireAt'] = datetime.strptime(request.expiryDate, '%Y-%m-%d')

        task_ref = db.collection('processing_tasks').document()
        task_ref.set(task_data)

        # B. Pobierz plik
        blob = bucket.blob(request.filePath)
        blob.download_to_filename(temp_path)

        # C. Konwersja
        if request.fileName.endswith('.csv'):
            df = pd.read_csv(temp_path)
        else:
            df = pd.read_excel(temp_path)
        
        raw_data = df.to_dict(orient='records')
        processed_data = converter.process(raw_data, request.category)

        # D. Zapisz wyniki (Sync logic: App pulls from here on demand)
        batch = db.batch()
        # Note: Firestore batch limit is 500 operations. The code slices [:400] which is safe.
        for item in processed_data[:400]: 
            doc_ref = db.collection('app_data').document()
            batch.set(doc_ref, {
                **item,
                'sourceFileId': task_ref.id,
                'category': request.category,
                'customName': request.customName, # Ważne dla UI w apce
                'updatedAt': firestore.SERVER_TIMESTAMP
            })
        batch.commit()

        # E. Update status
        task_ref.update({
            'status': 'completed',
            'recordCount': len(processed_data),
            'notificationSent': True
        })

        # F. Trigger Sync (Push Notification)
        # To zapewnia logikę: "If open -> update, if not -> download later"
        # Payload data pozwala aplikacji zareagować w tle.
        try:
            message = messaging.Message(
                notification=messaging.Notification(
                    title="New Data Synced",
                    body=f"Updated {request.category}: {request.customName or 'Main File'}"
                ),
                data={
                    "type": "DATA_UPDATE",
                    "categoryId": request.category,
                    "sourceId": task_ref.id
                },
                topic="data_updates"
            )
            messaging.send(message)
        except Exception as msg_err:
            print(f"Notification error: {msg_err}")

    except Exception as e:
        print(f"Error: {e}")
        if task_ref:
            task_ref.update({'status': 'error', 'errorMessage': str(e)})

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

def delete_file_task(request: DeleteRequest):
    """Usuwa plik i powiązane dane z chmury"""
    try:
        # 1. Pobierz info o zadaniu
        doc = db.collection('processing_tasks').document(request.taskId).get()
        if not doc.exists:
            return
        
        data = doc.to_dict()
        
        # 2. Usuń plik z Storage (zakładając, że mamy ścieżkę lub rekonstruujemy)
        # W prostej wersji pomijamy dokładne czyszczenie Storage, skupiamy się na danych
        
        # 3. Usuń przekonwertowane dane
        batch = db.batch()
        docs = db.collection('app_data').where('sourceFileId', '==', request.taskId).stream()
        for d in docs:
            batch.delete(d.reference)
        batch.commit()

        # 4. Usuń wpis zadania
        db.collection('processing_tasks').document(request.taskId).delete()
        
        print(f"Deleted task {request.taskId}")

    except Exception as e:
        print(f"Delete error: {e}")

# --- 5. API ENDPOINTS ---

@app.post("/convert", status_code=202)
async def trigger_conversion(request: ProcessRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(process_file_task, request)
    return {"message": "Conversion started", "file": request.fileName}

@app.post("/delete-cloud", status_code=200)
async def delete_cloud_data(request: DeleteRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(delete_file_task, request)
    return {"message": "Deletion started"}

@app.get("/health")
def health_check():
    return {"status": "ready"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
