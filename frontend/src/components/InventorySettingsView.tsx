import React, { useEffect, useState } from 'react';
import { Settings, Save, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { apiFetch } from '../api';

export const InventorySettingsView: React.FC = () => {
  const [settings, setSettings] = useState({
    DEFAULT_REORDER_LEVEL: '3',
    LOW_STOCK_EMAILS: 'admin@ont.co.ke',
    LOW_STOCK_ENABLED: 'TRUE',
    TASK_ASSIGNMENT_ENABLED: 'TRUE',
    PURCHASING_EMAIL: 'procurement@ont.co.ke',
    FINANCE_EMAIL: 'finance@ont.co.ke',
    GENIEACS_URL: 'http://genieacs.local:7557',
    COMPANY_NAME: 'ONT Network Services',
  });

  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchSettings = () => {
    apiFetch('/api/settings')
      .then((data) => {
        if (data && typeof data === 'object') {
          setSettings((prev) => ({ ...prev, ...data }));
        }
      })
      .catch((err) => console.error(err));
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    try {
      const res = await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify(settings),
      });
      setMsg({ type: 'success', text: res.message || 'Settings saved successfully' });
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'Failed to save settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleLowStockScan = async () => {
    setScanning(true);
    setMsg(null);

    try {
      const res = await apiFetch('/api/inventory/low-stock-scan', { method: 'POST' });
      setMsg({ type: 'success', text: res.message });
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'Scan failed' });
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-6 shadow-xl">
        <div className="flex justify-between items-center border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-sky-950 border border-sky-800 rounded-lg text-sky-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-100">Inventory System Settings</h2>
              <p className="text-xs text-slate-400">Configure alert thresholds, email recipients, and GenieACS integration</p>
            </div>
          </div>

          <button
            onClick={handleLowStockScan}
            disabled={scanning}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-xs transition-all shadow-md disabled:opacity-50"
          >
            {scanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
            <span>Run Low-Stock Scan</span>
          </button>
        </div>

        {msg && (
          <div
            className={`p-3 rounded-lg text-xs flex items-center space-x-2 border ${
              msg.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300'
                : 'bg-rose-950/80 border-rose-800 text-rose-300'
            }`}
          >
            {msg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{msg.text}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-400 mb-1">Company / Organization Name</label>
              <input
                type="text"
                value={settings.COMPANY_NAME}
                onChange={(e) => setSettings({ ...settings, COMPANY_NAME: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Default Reorder Threshold</label>
              <input
                type="number"
                min="0"
                value={settings.DEFAULT_REORDER_LEVEL}
                onChange={(e) => setSettings({ ...settings, DEFAULT_REORDER_LEVEL: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-400 mb-1">Low-Stock Alert Email Recipients</label>
              <input
                type="text"
                value={settings.LOW_STOCK_EMAILS}
                onChange={(e) => setSettings({ ...settings, LOW_STOCK_EMAILS: e.target.value })}
                placeholder="admin@ont.co.ke, store@ont.co.ke"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Purchasing Team Email</label>
              <input
                type="text"
                value={settings.PURCHASING_EMAIL}
                onChange={(e) => setSettings({ ...settings, PURCHASING_EMAIL: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-400 mb-1">Finance Approver Email</label>
              <input
                type="text"
                value={settings.FINANCE_EMAIL}
                onChange={(e) => setSettings({ ...settings, FINANCE_EMAIL: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">GenieACS Server Base URL</label>
              <input
                type="text"
                value={settings.GENIEACS_URL}
                onChange={(e) => setSettings({ ...settings, GENIEACS_URL: e.target.value })}
                placeholder="http://genieacs.local:7557"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 font-mono"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg shadow-md transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{loading ? 'Saving Settings...' : 'Save Configuration'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
