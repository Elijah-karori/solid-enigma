import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { useAuth } from '../auth';

interface U {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  site_station: string;
  must_reset_password: boolean;
  last_login_at: string | null;
}

const ROLES = ['Admin', 'Store Manager', 'Finance', 'Project Manager', 'Support', 'Technician'];
const empty = { email: '', name: '', role: 'Technician', status: 'active', site_station: '' };

export const UsersView: React.FC = () => {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<U[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => apiFetch('/api/users').then((d) => setUsers(Array.isArray(d) ? d : [])).catch((e) => setMsg({ ok: false, text: e.message }));
  useEffect(() => {
    load();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(form) });
      setMsg({ ok: true, text: r.message });
      setForm(empty);
      setEditing(false);
      load();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    }
  };

  const revoke = async (email: string) => {
    try {
      const r = await apiFetch(`/api/users/${encodeURIComponent(email)}/revoke-sessions`, { method: 'POST' });
      setMsg({ ok: true, text: r.message });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    }
  };

  const cls = 'w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200';
  return (
    <div className="grid xl:grid-cols-3 gap-6">
      <form onSubmit={save} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 text-xs self-start">
        <h3 className="font-bold text-slate-100 text-sm">{editing ? 'Edit user' : 'Add user'}</h3>
        <input className={cls} type="email" required readOnly={editing} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className={cls} required placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <select className={cls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <select className={cls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <input className={cls} placeholder="Site / station" value={form.site_station} onChange={(e) => setForm({ ...form, site_station: e.target.value })} />
        <p className="text-slate-500">No password is set here. New users get an email and choose their own through “Forgot password”.</p>
        {msg && <p className={msg.ok ? 'text-emerald-400' : 'text-rose-400'}>{msg.text}</p>}
        <div className="flex gap-2">
          <button className="flex-1 py-2 bg-sky-600 text-white rounded font-bold">Save user</button>
          <button type="button" onClick={() => { setForm(empty); setEditing(false); }} className="px-3 py-2 bg-slate-800 text-slate-300 rounded">Clear</button>
        </div>
      </form>

      <div className="xl:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 text-slate-400 uppercase border-b border-slate-800">
            <tr><th className="px-4 py-3">User</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Password</th><th className="px-4 py-3 text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-800/50">
                <td className="px-4 py-3"><div className="font-bold text-slate-100">{u.name}</div><div className="text-slate-400">{u.email}</div></td>
                <td className="px-4 py-3">{u.role}</td>
                <td className="px-4 py-3">{u.status}</td>
                <td className="px-4 py-3">{u.must_reset_password ? <span className="text-amber-400">Not set yet</span> : <span className="text-emerald-400">Set</span>}</td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => { setForm({ email: u.email, name: u.name, role: u.role, status: u.status, site_station: u.site_station || '' }); setEditing(true); }} className="px-2 py-1 bg-slate-800 rounded">Edit</button>
                  {u.email !== me.email && <button onClick={() => revoke(u.email)} className="px-2 py-1 bg-rose-950 text-rose-300 border border-rose-800 rounded">Sign out everywhere</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
