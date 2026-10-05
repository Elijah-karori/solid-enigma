import React, { useEffect, useState } from 'react';
import { AuditLedger } from '../types';
import { ShieldCheck, ShieldAlert, CheckCircle2, RefreshCw } from 'lucide-react';
import { apiFetch } from '../api';

export const AuditLedgerView: React.FC = () => {
  const [logs, setLogs] = useState<AuditLedger[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ intact: boolean; message: string } | null>(null);

  const fetchAudit = () => {
    apiFetch('/api/audit')
      .then((data) => setLogs(Array.isArray(data) ? data : []))
      .catch((err) => console.error(err));
  };

  useEffect(() => {
    fetchAudit();
  }, []);

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);

    try {
      const res = await apiFetch('/api/audit/verify', { method: 'POST' });
      setVerifyResult({ intact: res.intact, message: res.message });
    } catch (err: any) {
      setVerifyResult({ intact: false, message: err.message || 'Audit verification failed' });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-950 border border-emerald-800 rounded-lg text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-sm text-slate-100">SHA-256 Hash-Chained Audit Trail</h2>
            <p className="text-xs text-slate-400">
              Append-only cryptographic event log. Tampering or editing past rows breaks the SHA-256 hash chain.
            </p>
          </div>
        </div>

        <button
          onClick={handleVerify}
          disabled={verifying}
          className="flex items-center space-x-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg text-xs transition-all shadow-md shadow-emerald-600/30 disabled:opacity-50"
        >
          {verifying ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <ShieldCheck className="w-4 h-4" />
          )}
          <span>Verify Audit Integrity</span>
        </button>
      </div>

      {verifyResult && (
        <div
          className={`p-4 rounded-xl border text-xs flex items-center space-x-3 shadow-lg ${
            verifyResult.intact
              ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/80 border-rose-800 text-rose-300'
          }`}
        >
          {verifyResult.intact ? (
            <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
          ) : (
            <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0" />
          )}
          <div>
            <p className="font-bold text-sm">
              {verifyResult.intact ? 'Audit Integrity Verified' : 'Tampering Detected in Audit Log'}
            </p>
            <p className="mt-0.5 opacity-90">{verifyResult.message}</p>
          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase font-semibold">
            <tr>
              <th className="p-3">Timestamp</th>
              <th className="p-3">Actor</th>
              <th className="p-3">Target Entity</th>
              <th className="p-3">Action</th>
              <th className="p-3">Details / Change</th>
              <th className="p-3 font-mono">Prev Hash</th>
              <th className="p-3 font-mono">SHA-256 Hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-slate-500">
                  No audit trail records logged yet.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-850 transition-colors">
                  <td className="p-3 text-slate-400">
                    {new Date(log.event_timestamp).toLocaleString()}
                  </td>
                  <td className="p-3">
                    <p className="font-semibold text-slate-200">{log.actor_email}</p>
                    <span className="text-[10px] text-sky-400">{log.actor_role}</span>
                  </td>
                  <td className="p-3">
                    <p className="font-bold text-slate-100">{log.entity_type}</p>
                    <p className="font-mono text-[10px] text-slate-400">{log.entity_id}</p>
                  </td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 bg-slate-950 border border-slate-700 text-slate-300 rounded text-[10px]">
                      {log.action}
                    </span>
                  </td>
                  <td className="p-3 max-w-xs truncate text-slate-300">
                    {log.details || log.new_state || '—'}
                  </td>
                  <td className="p-3 font-mono text-[10px] text-slate-500 truncate max-w-[100px]">
                    {log.prev_hash || 'GENESIS'}
                  </td>
                  <td className="p-3 font-mono text-[10px] text-emerald-400 truncate max-w-[120px]">
                    {log.hash ? log.hash.substring(0, 16) + '...' : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
