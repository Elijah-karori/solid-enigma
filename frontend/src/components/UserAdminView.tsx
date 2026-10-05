import React, { useEffect, useState } from 'react';
import { User } from '../types';
import { Users, UserPlus, Edit2, Shield } from 'lucide-react';
import { apiFetch } from '../api';

export const UserAdminView: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const [form, setForm] = useState({
    email: '',
    name: '',
    role: 'Technician',
    status: 'active',
    password: '',
    site_station: 'Main Store',
    contact_info: '',
  });

  const fetchUsers = () => {
    apiFetch('/api/users')
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch((err) => console.error(err));
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    apiFetch('/api/users', {
      method: 'POST',
      body: JSON.stringify(
        editingUser
          ? {
              email: editingUser.email,
              name: editingUser.name,
              role: editingUser.role,
              status: editingUser.status,
              site_station: editingUser.site_station,
              contact_info: editingUser.contact_info,
            }
          : form
      ),
    })
      .then(() => {
        setShowModal(false);
        setEditingUser(null);
        fetchUsers();
      })
      .catch((err) => alert(err.message || 'Error saving user'));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-purple-950 border border-purple-800 rounded-lg text-purple-400">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-sm text-slate-100">User Administration & RBAC Roles</h2>
            <p className="text-xs text-slate-400">Manage portal operators, role permissions, and access status</p>
          </div>
        </div>

        <button
          onClick={() => {
            setEditingUser(null);
            setShowModal(true);
          }}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-lg text-xs transition-all shadow-md shadow-purple-600/30"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add System User</span>
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase font-semibold">
            <tr>
              <th className="p-3">User Name</th>
              <th className="p-3">Email Address</th>
              <th className="p-3">Role</th>
              <th className="p-3">Status</th>
              <th className="p-3">Station / Site</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id || u.email} className="hover:bg-slate-850 transition-colors">
                  <td className="p-3 font-semibold text-slate-100">{u.name}</td>
                  <td className="p-3 font-mono text-sky-400">{u.email}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 bg-purple-950 text-purple-400 border border-purple-800 rounded text-[10px] font-semibold">
                      {u.role}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        u.status === 'active'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-rose-950 text-rose-400 border border-rose-800'
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="p-3 text-slate-400">{u.site_station || 'Main Store'}</td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => {
                        setEditingUser(u);
                        setShowModal(true);
                      }}
                      className="p-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-base text-slate-100 border-b border-slate-800 pb-2">
              {editingUser ? `Edit User: ${editingUser.email}` : 'Add New Portal User'}
            </h3>
            <form onSubmit={handleSave} className="space-y-3 text-xs">
              {!editingUser && (
                <div>
                  <label className="block text-slate-400 mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                  />
                </div>
              )}

              <div>
                <label className="block text-slate-400 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={editingUser ? editingUser.name : form.name}
                  onChange={(e) =>
                    editingUser
                      ? setEditingUser({ ...editingUser, name: e.target.value })
                      : setForm({ ...form, name: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Assigned Role</label>
                  <select
                    value={editingUser ? editingUser.role : form.role}
                    onChange={(e) =>
                      editingUser
                        ? setEditingUser({ ...editingUser, role: e.target.value })
                        : setForm({ ...form, role: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                  >
                    <option value="Admin">Admin</option>
                    <option value="Store Manager">Store Manager</option>
                    <option value="Finance">Finance</option>
                    <option value="Project Manager">Project Manager</option>
                    <option value="Support">Support</option>
                    <option value="Technician">Technician</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Status</label>
                  <select
                    value={editingUser ? editingUser.status : form.status}
                    onChange={(e) =>
                      editingUser
                        ? setEditingUser({ ...editingUser, status: e.target.value })
                        : setForm({ ...form, status: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                  >
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                </div>
              </div>

              {!editingUser && (
                <div>
                  <label className="block text-slate-400 mb-1">Initial Password</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Defaults to Password123! if blank"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                  />
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-purple-600 text-white rounded-lg font-semibold">
                  Save User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
