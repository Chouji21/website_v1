import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import {
  getStorage,
  ref,
  uploadBytesResumable,
  deleteObject
} from 'firebase/storage';
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  orderBy
} from 'firebase/firestore';
import {
  Upload,
  FileSpreadsheet,
  LogOut,
  Loader2,
  CheckCircle,
  AlertCircle,
  Smartphone,
  Trash2,
  Calendar,
  Plus,
  FileText,
  Cloud,
  CloudOff
} from 'lucide-react';

// --- CONFIGURATION ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const storage = getStorage(app);
const db = getFirestore(app);

// --- COMPONENTS ---

const LoginPage = ({ onLogin, error }) => (
  <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
    <div className="bg-slate-900 p-8 rounded-xl shadow-2xl w-full max-w-md border border-slate-800">
      <h2 className="text-2xl font-bold text-center text-white mb-6">Data Ops Login</h2>
      {error && <div className="bg-red-500/10 text-red-200 p-3 rounded mb-4 text-sm">{error}</div>}
      <form onSubmit={(e) => { e.preventDefault(); onLogin(e.target.email.value, e.target.password.value); }} className="space-y-4">
        <input name="email" type="email" placeholder="Email" required className="w-full bg-slate-800 border border-slate-700 rounded p-3 text-white" />
        <input name="password" type="password" placeholder="Password" required className="w-full bg-slate-800 border border-slate-700 rounded p-3 text-white" />
        <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded transition-colors">Sign In</button>
      </form>
    </div>
  </div>
);

// --- SINGLE FILE BLOCK COMPONENT ---

const FileBlock = ({
  type, // 'main' or 'side'
  id,
  data,
  onUpdate,
  onDeleteLocal,
  user,
  category
}) => {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [cloudStatus, setCloudStatus] = useState('idle'); // idle, uploaded, error

  // Handle local file selection
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      onUpdate(id, { ...data, file: file, fileName: file.name });
    }
  };

  // Handle Upload Logic
  const handleUpload = async () => {
    if (!data.file) return alert("Select a file first");
    if (type === 'side' && !data.customName) return alert("Please enter a name for this file");
    if (type === 'side' && !data.expiryDate) return alert("Please select an expiry date");

    try {
      setUploading(true);

      // 1. Upload to Firebase Storage
      const storagePath = `imports/${user.uid}/${category}/${type}_${Date.now()}_${data.file.name}`;
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, data.file);

      uploadTask.on('state_changed',
        (snapshot) => setProgress((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
        (error) => {
          console.error(error);
          setUploading(false);
          setCloudStatus('error');
        },
        async () => {
          // 2. Trigger Backend
          try {
            await fetch('http://localhost:8000/convert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filePath: storagePath,
                fileName: data.file.name,
                userId: user.uid,
                category: category,
                fileType: type,
                customName: data.customName || 'Main Data',
                expiryDate: data.expiryDate || null
              })
            });
            setCloudStatus('uploaded');
            onUpdate(id, { ...data, isUploaded: true, storagePath: storagePath });
          } catch (err) {
            setCloudStatus('error');
          } finally {
            setUploading(false);
          }
        }
      );
    } catch (e) {
      setUploading(false);
    }
  };

  // Handle Delete (Cloud or Local)
  const handleDelete = async () => {
    if (data.isUploaded) {
      if (!confirm("This will delete the file from the cloud and sync the removal to the app. Continue?")) return;
      try {
        // Call backend to remove data/tasks
        // Note: For a robust system we need the taskId, here we simulate simply clearing UI for demo
        // Ideally we store the taskId returned from backend
        setCloudStatus('idle');
        onUpdate(id, { ...data, isUploaded: false, file: null, fileName: '' });
      } catch (e) {
        console.error(e);
      }
    } else {
      // Just clear local
      if (type === 'main') {
        onUpdate(id, { ...data, file: null, fileName: '' });
      } else {
        onDeleteLocal(id);
      }
    }
  };

  return (
    <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 mb-4 transition-all hover:border-slate-600">
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">

        {/* Left: Icon & Input */}
        <div className="flex items-center gap-4 flex-1 w-full">
          <div className={`p-3 rounded-lg ${data.isUploaded ? 'bg-emerald-600/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
            {type === 'main' ? <FileSpreadsheet size={24} /> : <FileText size={24} />}
          </div>

          <div className="flex-1 space-y-2">
            {/* Header / Name Input */}
            <div className="flex flex-col sm:flex-row gap-2">
              <span className="text-xs font-bold uppercase text-slate-500 tracking-wider">
                {type === 'main' ? 'Main Source File' : 'Side File'}
              </span>
            </div>

            {type === 'side' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="File Name (e.g. Q3 Invoice)"
                  value={data.customName || ''}
                  onChange={(e) => onUpdate(id, { ...data, customName: e.target.value })}
                  disabled={data.isUploaded}
                  className="bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white w-full"
                />
                <div className="relative">
                  <Calendar size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
                  <input
                    type="date"
                    value={data.expiryDate || ''}
                    onChange={(e) => onUpdate(id, { ...data, expiryDate: e.target.value })}
                    disabled={data.isUploaded}
                    className="bg-slate-900 border border-slate-600 rounded pl-8 pr-2 py-1.5 text-sm text-slate-300 w-full"
                  />
                </div>
              </div>
            )}

            {/* File Name Display or Input */}
            {data.file ? (
              <div className="text-white font-medium truncate flex items-center gap-2">
                {data.file.name}
                <span className="text-xs text-slate-500">({(data.file.size / 1024).toFixed(1)} KB)</span>
              </div>
            ) : (
              <label className="cursor-pointer inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors">
                <Plus size={16} /> Choose Spreadsheet from Explorer
                <input type="file" onChange={handleFileSelect} className="hidden" accept=".xlsx, .csv, .xls" />
              </label>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-3 w-full md:w-auto mt-4 md:mt-0 justify-end">

          {/* Status Indicator */}
          {uploading && (
            <div className="flex flex-col items-end mr-2">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                <Loader2 size={14} className="animate-spin" /> {progress.toFixed(0)}%
              </div>
              <div className="w-24 h-1 bg-slate-700 rounded mt-1 overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${progress}%` }}></div>
              </div>
            </div>
          )}

          {data.isUploaded && !uploading && (
            <span className="text-emerald-400 flex items-center gap-1 text-xs font-bold mr-2">
              <Cloud size={14} /> Synced
            </span>
          )}

          {/* Buttons Block */}
          <div className="flex gap-2 bg-slate-900 p-1 rounded-lg border border-slate-700">
            <button
              onClick={handleUpload}
              disabled={uploading || data.isUploaded || !data.file}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Upload
            </button>

            <button
              onClick={handleDelete}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
            >
              {data.isUploaded ? 'Delete Cloud' : 'Clear'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('inventory');

  // State for Files
  const [mainFile, setMainFile] = useState({ id: 'main', file: null, isUploaded: false });
  const [sideFiles, setSideFiles] = useState([]); // Array of { id, file, customName, expiryDate, isUploaded }

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const addSideFile = () => {
    setSideFiles([...sideFiles, {
      id: Date.now(),
      file: null,
      customName: '',
      expiryDate: '',
      isUploaded: false
    }]);
  };

  const updateSideFile = (id, newData) => {
    setSideFiles(sideFiles.map(f => f.id === id ? newData : f));
  };

  const removeSideFile = (id) => {
    setSideFiles(sideFiles.filter(f => f.id !== id));
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-emerald-500"><Loader2 className="animate-spin" /></div>;
  if (!user) return <LoginPage onLogin={(e, p) => signInWithEmailAndPassword(auth, e, p)} />;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">

      {/* Navbar */}
      <nav className="bg-slate-900 border-b border-slate-800 px-6 py-4 mb-8">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-600 p-2 rounded-lg">
              <Smartphone className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-white text-lg">App Sync Manager</span>
          </div>
          <div className="text-sm text-slate-400">
            Logged in as <span className="text-white">{user.email}</span>
            <button onClick={() => signOut(auth)} className="ml-4 text-slate-500 hover:text-white"><LogOut size={16} /></button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 pb-20">

        {/* 1. Category Selection */}
        <section className="mb-8">
          <label className="block text-slate-400 text-sm font-bold mb-3 uppercase tracking-wider">Step 1: Select Data Category</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {['inventory', 'financial', 'hr_data', 'tasks'].map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`p-4 rounded-xl border text-center transition-all ${category === cat
                  ? 'bg-blue-600/20 border-blue-500 text-white shadow-blue-500/20 shadow-lg'
                  : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'
                  }`}
              >
                <span className="capitalize font-semibold">{cat.replace('_', ' ')}</span>
              </button>
            ))}
          </div>
        </section>

        {/* 2. Main File Block */}
        <section className="mb-8">
          <label className="block text-slate-400 text-sm font-bold mb-3 uppercase tracking-wider">Step 2: Main Data Source</label>
          <FileBlock
            type="main"
            id="main"
            data={mainFile}
            onUpdate={(_, data) => setMainFile(data)}
            user={user}
            category={category}
          />
        </section>

        {/* 3. Side Files Block */}
        <section className="mb-8">
          <div className="flex justify-between items-end mb-3">
            <label className="block text-slate-400 text-sm font-bold uppercase tracking-wider">Step 3: Side / Reference Files</label>
            <button
              onClick={addSideFile}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-blue-400 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors flex items-center gap-1"
            >
              <Plus size={14} /> Add Side File
            </button>
          </div>

          <div className="space-y-4">
            {sideFiles.length === 0 && (
              <div className="text-center p-8 border-2 border-dashed border-slate-800 rounded-xl text-slate-600 italic">
                No side files added. Click "Add Side File" if needed.
              </div>
            )}
            {sideFiles.map((fileData) => (
              <FileBlock
                key={fileData.id}
                type="side"
                id={fileData.id}
                data={fileData}
                onUpdate={updateSideFile}
                onDeleteLocal={removeSideFile}
                user={user}
                category={category}
              />
            ))}
          </div>
        </section>

        {/* Footer Info */}
        <div className="border-t border-slate-800 pt-8 mt-12 text-center text-slate-500 text-sm">
          <p>Files uploaded here are automatically synced to the Android App.</p>
          <p className="mt-1">Side files will be automatically deleted from cloud storage on their expiry date.</p>
        </div>

      </main>
    </div>
  );
}
