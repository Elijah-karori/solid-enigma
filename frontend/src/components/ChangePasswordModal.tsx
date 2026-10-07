import React, { useState } from 'react';
import { apiFetch } from '../api';

export const ChangePasswordModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await apiFetch('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password: cur, new_password: pw }) });
      setMsg({ ok: true, text: r.message });
      setCur('');
      setPw('');
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };
  const cls = 'w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200';
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <form onSubmit={submit} className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-sm space-y-3 text-xs">
        <h3 className="font-bold text-slate-100 text-base">Change password</h3>
        <input type="password" required value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Current password" autoComplete="current-password" className={cls} />
        <input type="password" required minLength={10} maxLength={72} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (10+ chars, letter + number)" autoComplete="new-password" className={cls} />
        {msg && <p className={msg.ok ? 'text-emerald-400' : 'text-rose-400'}>{msg.text}</p>}
        <div className="flex justify-end space-x-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-800 text-slate-300 rounded font-bold">Close</button>
          <button disabled={busy} className="px-4 py-2 bg-sky-600 text-white rounded font-bold disabled:opacity-50">Update</button>
        </div>
      </form>
    </div>
  );
};
