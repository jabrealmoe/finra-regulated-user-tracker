import React, { useEffect, useState } from 'react';
import PacManGame from './PacManGame';
import { invoke } from '@forge/bridge';
import { Settings, Save, Loader2, Cpu } from 'lucide-react';

const AdminPage = () => {
  const [settings, setSettings] = useState({
    topK: -1,
    topP: 0.9,
    temperature: 0.7,
    maxTokens: 2048
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    // Fetch existing settings
    invoke('getAiSettings').then(data => {
      if (data) setSettings(data);
      setLoading(false);
    }).catch(err => {
      console.error('Failed to load settings:', err);
      setLoading(false);
    });
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: name === 'webhookUrl' ? value : parseFloat(value) 
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus('');
    try {
      await invoke('saveAiSettings', settings);
      setSaveStatus('Settings saved successfully!');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err) {
      console.error(err);
      setSaveStatus('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
     return <div className="flex justify-center items-center h-screen"><Loader2 className="animate-spin text-blue-500" /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 font-sans text-slate-800 bg-white min-h-screen">
      
      {/* Game Section */}
      <PacManGame />

      {/* Settings Section */}
      <div className="bg-white rounded-lg shadow-md p-6 mt-8 border border-slate-200">
        <div className="flex items-center space-x-2 mb-6 text-slate-700">
           <Cpu className="w-6 h-6" />
           <h2 className="text-2xl font-bold">N8N Engine Configuration</h2>
        </div>

        <div className="grid grid-cols-1 gap-8 mb-8">
             {/* Webhook URL */}
             <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">N8N Webhook URL</label>
                 <input 
                  type="text" 
                  name="webhookUrl" 
                  value={settings.webhookUrl || ''} 
                  onChange={handleChange}
                  placeholder="https://your-n8n-instance.com/webhook/..."
                  className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none font-mono text-sm"
                />
                 <p className="text-xs text-slate-500">
                    If set, this overrides the <code className="bg-slate-100 px-1 rounded">N8N_WEBHOOK_URL</code> environment variable.
                 </p>
             </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Temperature */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Temperature: {settings.temperature}</label>
             <input 
              type="range" 
              name="temperature" 
              min="0" 
              max="1" 
              step="0.05" 
              value={settings.temperature} 
              onChange={handleChange}
              className="w-full accent-blue-600"
            />
            <p className="text-xs text-slate-500">Controls randomness (0 = deterministic, 1 = creative).</p>
          </div>

          {/* Top P */}
          <div className="space-y-2">
             <label className="block text-sm font-medium text-slate-700">Top P: {settings.topP}</label>
             <input 
              type="range" 
              name="topP" 
              min="0" 
              max="1" 
              step="0.05" 
              value={settings.topP} 
              onChange={handleChange}
              className="w-full accent-blue-600"
            />
            <p className="text-xs text-slate-500">Nucleus sampling probability mass.</p>
          </div>

          {/* Top K */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Top K</label>
             <input 
              type="number" 
              name="topK" 
              value={settings.topK} 
              onChange={handleChange}
              className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none"
            />
             <p className="text-xs text-slate-500">Common token pool size.</p>
          </div>

           {/* Max Tokens */}
           <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Max Tokens</label>
             <input 
              type="number" 
              name="maxTokens" 
              value={settings.maxTokens} 
              onChange={handleChange}
               className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none"
            />
             <p className="text-xs text-slate-500">Maximum length of generated response.</p>
          </div>

        </div>

        <div className="mt-8 flex items-center justify-between">
            <span className={`text-sm font-medium ${saveStatus.includes('Failed') ? 'text-red-500' : 'text-green-600'}`}>
                {saveStatus}
            </span>
            <button 
                onClick={handleSave}
                disabled={saving}
                className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md shadow transition-colors disabled:opacity-50"
            >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
            </button>
        </div>
      </div>
      
      <div className="mt-8 text-center text-slate-400 text-xs text-mono">
        Dr. Jira Dictate v3.2.0 (Hybrid Config)
      </div>
    </div>
  );
};

export default AdminPage;
