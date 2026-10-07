import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';

export const AuditView: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [verdict, setVerdict] = useState<string | null>(null);
  useEffect(() => {
    apiFetch('/api/audit').then((d) => setRows(Array.isArray(d) ? d : [])).catch(() => setRows([]));
  }, []);
  const verify = async () => {
    const r = await apiFetch('/api/audit/verify');
    setVerdict(r.intact ? `Audit trail intact - ${r.count} chained records verified.` : `TAMPERING DETECTED at record #${r.broken_at}: ${r.reason}`);
  };
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="p-4 flex justify-between items-center border-b border-slate-800">
        <div><h3 className="font-bold text-xs text-slate-200">Audit trail</h3><p className="text-[11px] text-slate-500">Append-only, SHA-256 hash-chained</p></div>
        <div className="flex items-center gap-3">
          {verdict && <span className={`text-xs ${verdict.startsWith('TAMPER') ? 'text-rose-400' : 'text-emerald-400'}`}>{verdict}</span>}
          <button onClick={verify} className="px-3 py-1.5 bg-emerald-700 text-white rounded text-xs font-bold">Verify integrity</button>
        </div>
      </div>
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-950 text-slate-400 uppercase"><tr><th className="px-4 py-2">#</th><th className="px-4 py-2">When</th><th className="px-4 py-2">Actor</th><th className="px-4 py-2">Record</th><th className="px-4 py-2">Action</th></tr></thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((r) => (
            <tr key={r.id}><td className="px-4 py-2 font-mono">{r.seq}</td><td className="px-4 py-2">{new Date(r.event_timestamp).toLocaleString()}</td><td className="px-4 py-2">{r.actor_email}<div className="text-[10px] text-slate-500">{r.actor_role}</div></td><td className="px-4 py-2">{r.entity_type} <span className="font-mono text-sky-400">{r.entity_id}</span></td><td className="px-4 py-2">{r.action}<div className="text-[10px] text-slate-500">{r.details}</div></td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const NotificationsView: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    apiFetch('/api/notifications').then((d) => setRows(Array.isArray(d) ? d : [])).catch(() => setRows([]));
  }, []);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-800 text-xs font-bold text-slate-200">Email notification log (last 500)</div>
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-950 text-slate-400 uppercase"><tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">To</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Error</th></tr></thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((r) => (
            <tr key={r.id}><td className="px-4 py-2">{new Date(r.timestamp).toLocaleString()}</td><td className="px-4 py-2">{r.type}{r.legacy && <span className="ml-1 text-[10px] text-slate-500">(legacy)</span>}</td><td className="px-4 py-2">{r.recipient}</td><td className={`px-4 py-2 ${r.status === 'SENT' ? 'text-emerald-400' : 'text-rose-400'}`}>{r.status}</td><td className="px-4 py-2 text-slate-500 max-w-xs truncate">{r.error}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
