import React, { useEffect, useState } from 'react';
import { FolderKanban, ShoppingCart, Plus, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiFetch } from '../api';
import { ItemCatalog, Project, ProcurementRequest } from '../types';
import { ProcurementSchema } from '../schemas';
import { useAuth } from '../auth';

export const ProjectsProcurementView: React.FC = () => {
  const { can } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [procurement, setProcurement] = useState<ProcurementRequest[]>([]);
  const [catalog, setCatalog] = useState<ItemCatalog[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [projForm, setProjForm] = useState({
    name: '',
    code: '',
    status: 'Active',
    manager: '',
    budget_kes: 0,
    start_date: '',
    end_date: '',
    description: '',
  });

  const [procForm, setProcForm] = useState({
    item_sku: '',
    quantity: 1,
    project_id: '',
    supplier: '',
    notes: '',
  });

  const fetchData = () => {
    apiFetch('/api/projects')
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Error fetching projects:', err));

    apiFetch('/api/procurement')
      .then((data) => setProcurement(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Error fetching procurement:', err));

    apiFetch('/api/catalog')
      .then((data) => setCatalog(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Error fetching catalog:', err));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projForm.name.trim()) {
      setMessage({ type: 'error', text: 'Project name is required.' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      await apiFetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify(projForm),
      });
      setMessage({ type: 'success', text: 'Project created successfully!' });
      setProjForm({
        name: '',
        code: '',
        status: 'Active',
        manager: '',
        budget_kes: 0,
        start_date: '',
        end_date: '',
        description: '',
      });
      fetchData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save project' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProcurement = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = ProcurementSchema.safeParse(procForm);
    if (!val.success) {
      setMessage({ type: 'error', text: val.error.errors[0].message });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      await apiFetch('/api/procurement', {
        method: 'POST',
        body: JSON.stringify(procForm),
      });
      setMessage({ type: 'success', text: 'Procurement request submitted to Finance.' });
      setProcForm({
        item_sku: '',
        quantity: 1,
        project_id: '',
        supplier: '',
        notes: '',
      });
      fetchData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to create procurement request' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {message && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center space-x-2 border ${
            message.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/80 border-rose-800 text-rose-300'
          }`}
        >
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* PROJECTS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {can('manageProjects') && (
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
            <h3 className="font-bold text-sm text-slate-100 flex items-center space-x-2 border-b border-slate-800 pb-2">
              <FolderKanban className="w-4 h-4 text-sky-400" />
              <span>Create New Project</span>
            </h3>
            <form onSubmit={handleSaveProject} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Project Name *</label>
                <input
                  type="text"
                  required
                  value={projForm.name}
                  onChange={(e) => setProjForm({ ...projForm, name: e.target.value })}
                  placeholder="FTTH Expansion Zone 4"
                  className="w-full p-2 bg-slate-950 border border-slate-800 rounded text-slate-200"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Project Code</label>
                  <input
                    type="text"
                    value={projForm.code}
                    onChange={(e) => setProjForm({ ...projForm, code: e.target.value })}
                    placeholder="PRJ-Z4"
                    className="w-full p-2 bg-slate-950 border border-slate-800 rounded text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Status</label>
                  <select
                    value={projForm.status}
                    onChange={(e) => setProjForm({ ...projForm, status: e.target.value })}
                    className="w-full p-2 bg-slate-950 border border-slate-800 rounded text-slate-200"
                  >
                    <option value="Planning">Planning</option>
                    <option value="Active">Active</option>
                    <option value="On Hold">On Hold</option>
                    <option value="Completed">Completed</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Budget (KES)</label>
                  <input
                    type="number"
                    min="0"
                    value={projForm.budget_kes}
                    onChange={(e) => setProjForm({ ...projForm, budget_kes: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2 bg-slate-950 border border-slate-800 rounded text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Manager Email</label>
                  <input
                    type="text"
                    value={projForm.manager}
                    onChange={(e) => setProjForm({ ...projForm, manager: e.target.value })}
                    placeholder="pm@ont.co.ke"
                    className="w-full p-2 bg-slate-950 border border-slate-800 rounded text-slate-200"
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Description / Notes</label>
                <textarea
                  rows={2}
                  value={projForm.description}
                  onChange={(e) => setProjForm({ ...projForm, description: e.target.value })}
                  className="w-full p-2 bg-slate-950 border border-slate-800 rounded text-slate-200"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded flex items-center justify-center space-x-1"
              >
                <Plus className="w-4 h-4" />
                <span>Save Project</span>
              </button>
            </form>
          </div>
        )}

        <div className={`p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4 ${can('manageProjects') ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <h3 className="font-bold text-sm text-slate-100 flex items-center space-x-2 border-b border-slate-800 pb-2">
            <FolderKanban className="w-4 h-4 text-sky-400" />
            <span>Active Network Projects</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {projects.map((p) => (
              <div key={p.project_id} className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
                <div className="flex justify-between font-bold text-slate-100">
                  <span>{p.name} ({p.project_id})</span>
                  <span className="text-sky-400">{p.status}</span>
                </div>
                <p className="text-[10px] text-slate-400">Manager: {p.manager || 'Unassigned'}</p>
                <p className="text-[10px] text-slate-400">{p.description}</p>
                {can('viewCosts') && (
                  <div className="flex justify-between text-[11px] pt-2 border-t border-slate-800">
                    <span className="text-slate-400">Budget: KES {p.budget_kes || 0}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PROCUREMENT SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {can('requestProcurement') && (
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
            <h3 className="font-bold text-sm text-slate-100 flex items-center space-x-2 border-b border-slate-800 pb-2">
              <ShoppingCart className="w-4 h-4 text-purple-400" />
              <span>Purchase Request</span>
            </h3>
            <form onSubmit={handleCreateProcurement} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Item SKU *</label>
                <select
                  required
                  value={procForm.item_sku}
                  onChange={(e) => setProcForm({ ...procForm, item_sku: e.target.value })}
                  className="w-full p-2 bg-slate-950 border border-slate-800 rounded text-slate-200"
                >
                  <option value="">-- Select SKU --</option>
                  {catalog.map((c) => (
                    <option key={c.sku} value={c.sku}>
                      {c.sku} - {c.model}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={procForm.quantity}
                    onChange={(e) => setProcForm({ ...procForm, quantity: parseFloat(e.target.value) || 1 })}
                    className="w-full p-2 bg-slate-950 border border-slate-800 rounded text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Project</label>
                  <select
                    value={procForm.project_id}
                    onChange={(e) => setProcForm({ ...procForm, project_id: e.target.value })}
                    className="w-full p-2 bg-slate-950 border border-slate-800 rounded text-slate-200"
                  >
                    <option value="">-- None / Shared --</option>
                    {projects.map((p) => (
                      <option key={p.project_id} value={p.project_id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Preferred Supplier</label>
                <input
                  type="text"
                  value={procForm.supplier}
                  onChange={(e) => setProcForm({ ...procForm, supplier: e.target.value })}
                  placeholder="Supplier Name"
                  className="w-full p-2 bg-slate-950 border border-slate-800 rounded text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Reason / Notes</label>
                <textarea
                  rows={2}
                  value={procForm.notes}
                  onChange={(e) => setProcForm({ ...procForm, notes: e.target.value })}
                  className="w-full p-2 bg-slate-950 border border-slate-800 rounded text-slate-200"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded flex items-center justify-center space-x-1"
              >
                <Plus className="w-4 h-4" />
                <span>Submit to Finance</span>
              </button>
            </form>
          </div>
        )}

        <div className={`p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4 ${can('requestProcurement') ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <h3 className="font-bold text-sm text-slate-100 flex items-center space-x-2 border-b border-slate-800 pb-2">
            <ShoppingCart className="w-4 h-4 text-purple-400" />
            <span>Procurement Requests</span>
          </h3>
          <div className="bg-slate-950 rounded-lg border border-slate-800 overflow-hidden text-xs">
            <table className="w-full text-left">
              <thead className="bg-slate-900 text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="px-4 py-2">Proc ID</th>
                  <th className="px-4 py-2">SKU & Qty</th>
                  {can('viewCosts') && <th className="px-4 py-2">Est Total (KES)</th>}
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {procurement.map((pr) => (
                  <tr key={pr.procurement_id}>
                    <td className="px-4 py-2 font-mono text-sky-400">{pr.procurement_id}</td>
                    <td className="px-4 py-2">
                      {pr.item_sku} (x{pr.quantity})
                    </td>
                    {can('viewCosts') && <td className="px-4 py-2 font-mono">{pr.est_total || 0}</td>}
                    <td className="px-4 py-2 text-purple-400">{pr.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
