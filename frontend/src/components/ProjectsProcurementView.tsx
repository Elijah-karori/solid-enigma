import React, { useEffect, useState, useCallback } from 'react';
import {
  FolderKanban, ShoppingCart, Plus, CheckCircle2, XCircle, Truck,
  PackageCheck, RefreshCw, ChevronDown, AlertTriangle, DollarSign,
} from 'lucide-react';
import { apiFetch } from '../api';
import { ProcurementRequest, ItemCatalog } from '../types';

// ---------- Helpers ----------
const STATUS_COLORS: Record<string, string> = {
  'Pending Finance':  'bg-amber-950 text-amber-400 border-amber-800',
  'Approved':         'bg-indigo-950 text-indigo-400 border-indigo-800',
  'Ordered':          'bg-sky-950 text-sky-400 border-sky-800',
  'Received':         'bg-emerald-950 text-emerald-400 border-emerald-800',
  'Rejected':         'bg-rose-950 text-rose-400 border-rose-800',
  'Cancelled':        'bg-slate-800 text-slate-400 border-slate-700',
  'Planning':         'bg-slate-800 text-slate-400 border-slate-700',
  'Active':           'bg-emerald-950 text-emerald-400 border-emerald-800',
  'On Hold':          'bg-amber-950 text-amber-400 border-amber-800',
  'Completed':        'bg-sky-950 text-sky-400 border-sky-800',
};

const StatusBadge = ({ status }: { status: string }) => (
  <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${STATUS_COLORS[status] || 'bg-slate-800 text-slate-400 border-slate-700'}`}>
    {status}
  </span>
);

const money = (n: number | string) =>
  'KES ' + Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });

// ---------- Types ----------
interface Project {
  project_id: string;
  project_name: string;
  type: string;
  status: string;
  location_fat: string;
  project_manager: string;
  start_date: string;
  end_date: string;
  budget: number;
  actual_spend: number;
  notes: string;
}

// ---------- Project Form ----------
const emptyProject = (): Partial<Project> => ({
  project_name: '',
  type: 'Deployment',
  status: 'Planning',
  location_fat: '',
  project_manager: '',
  start_date: '',
  end_date: '',
  budget: 0,
  notes: '',
});

const ProjectForm: React.FC<{ initial?: Partial<Project>; onDone: () => void }> = ({ initial, onDone }) => {
  const [f, setF] = useState<Partial<Project>>(initial || emptyProject());
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Project, v: string | number) => setF((p) => ({ ...p, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify(f) });
      onDone();
    } catch (err: any) {
      alert(err.message || 'Failed to save project');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-slate-400 mb-1">Project Name *</label>
          <input required value={f.project_name || ''} onChange={(e) => set('project_name', e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Type</label>
          <select value={f.type} onChange={(e) => set('type', e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500">
            {['Deployment', 'Upgrade', 'Maintenance', 'Expansion', 'Other'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Status</label>
          <select value={f.status} onChange={(e) => set('status', e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500">
            {['Planning', 'Active', 'On Hold', 'Completed', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Location / FAT</label>
          <input value={f.location_fat || ''} onChange={(e) => set('location_fat', e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500" placeholder="FAT-PLT4-01" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Project Manager</label>
          <input value={f.project_manager || ''} onChange={(e) => set('project_manager', e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Start Date</label>
          <input type="date" value={f.start_date?.slice(0, 10) || ''} onChange={(e) => set('start_date', e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">End Date</label>
          <input type="date" value={f.end_date?.slice(0, 10) || ''} onChange={(e) => set('end_date', e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Budget (KES)</label>
          <input type="number" min="0" value={f.budget || ''} onChange={(e) => set('budget', Number(e.target.value))}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-slate-400 mb-1">Notes</label>
          <textarea rows={2} value={f.notes || ''} onChange={(e) => set('notes', e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500 resize-none" />
        </div>
      </div>
      <button type="submit" disabled={saving}
        className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center justify-center space-x-2">
        {saving && <RefreshCw className="w-4 h-4 animate-spin" />}
        <span>{saving ? 'Saving…' : 'Save Project'}</span>
      </button>
    </form>
  );
};

// ---------- Procurement Form ----------
const emptyProc = (): Partial<ProcurementRequest> => ({
  item_sku: '',
  quantity: 1,
  est_unit_cost: 0,
  project_id: '',
  notes: '',
});

const ProcurementForm: React.FC<{ catalog: ItemCatalog[]; projects: Project[]; onDone: () => void }> = ({ catalog, projects, onDone }) => {
  const [f, setF] = useState<Partial<ProcurementRequest>>(emptyProc());
  const [saving, setSaving] = useState(false);
  const set = (k: keyof ProcurementRequest, v: string | number) => setF((p) => ({ ...p, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/procurement', { method: 'POST', body: JSON.stringify(f) });
      setF(emptyProc());
      onDone();
    } catch (err: any) {
      alert(err.message || 'Failed to submit procurement request');
    } finally {
      setSaving(false);
    }
  };

  const estTotal = (f.quantity || 0) * (f.est_unit_cost || 0);

  return (
    <form onSubmit={save} className="space-y-3">
      <div>
        <label className="block text-xs text-slate-400 mb-1">Item / SKU *</label>
        <select required value={f.item_sku} onChange={(e) => set('item_sku', e.target.value)}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500">
          <option value="">Select item…</option>
          {catalog.map((c) => <option key={c.sku} value={c.sku}>{c.sku} — {c.model}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Quantity</label>
          <input type="number" min="1" required value={f.quantity || 1} onChange={(e) => set('quantity', Number(e.target.value))}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Est. Unit Cost (KES)</label>
          <input type="number" min="0" value={f.est_unit_cost || ''} onChange={(e) => set('est_unit_cost', Number(e.target.value))}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500" />
        </div>
      </div>
      {estTotal > 0 && (
        <p className="text-xs text-slate-400">Estimated total: <span className="font-bold text-slate-200">{money(estTotal)}</span>
          {estTotal >= 50000 && <span className="ml-2 text-amber-400">⚠ Finance approval required</span>}
        </p>
      )}
      <div>
        <label className="block text-xs text-slate-400 mb-1">Project (optional)</label>
        <select value={f.project_id || ''} onChange={(e) => set('project_id', e.target.value)}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500">
          <option value="">General stock (no project)</option>
          {projects.map((p) => <option key={p.project_id} value={p.project_id}>{p.project_id} — {p.project_name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">Preferred Supplier</label>
        <input value={(f as any).supplier || ''} onChange={(e) => setF((p) => ({ ...p, supplier: e.target.value }))}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">Notes / reason</label>
        <textarea rows={2} value={f.notes || ''} onChange={(e) => set('notes', e.target.value)}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500 resize-none" />
      </div>
      <button type="submit" disabled={saving}
        className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center justify-center space-x-2">
        {saving && <RefreshCw className="w-4 h-4 animate-spin" />}
        <span>{saving ? 'Submitting…' : 'Send to Finance'}</span>
      </button>
    </form>
  );
};

// ---------- Order / Receive Modals ----------
const OrderModal: React.FC<{ id: string; onDone: () => void; onClose: () => void }> = ({ id, onDone, onClose }) => {
  const [supplier, setSupplier] = useState('');
  const [po, setPo] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await apiFetch(`/api/procurement/${id}/order`, { method: 'POST', body: JSON.stringify({ supplier, po_ref: po }) });
      onDone(); onClose();
    } catch (err: any) { alert(err.message); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md space-y-4">
        <h3 className="font-bold text-slate-100">Mark as Ordered — {id}</h3>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Supplier *</label>
          <input required value={supplier} onChange={(e) => setSupplier(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">PO / Order Reference</label>
          <input value={po} onChange={(e) => setPo(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500" />
        </div>
        <div className="flex space-x-3">
          <button type="button" onClick={onClose} className="flex-1 py-2 border border-slate-700 rounded-lg text-sm text-slate-400">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm text-white font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Mark Ordered'}
          </button>
        </div>
      </form>
    </div>
  );
};

const ReceiveModal: React.FC<{ proc: ProcurementRequest; onDone: () => void; onClose: () => void }> = ({ proc, onDone, onClose }) => {
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/procurement/${proc.procurement_id}/receive`, { method: 'POST' });
      onDone(); onClose();
    } catch (err: any) { alert(err.message); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md space-y-4">
        <h3 className="font-bold text-slate-100">Receive Stock — {proc.procurement_id}</h3>
        <p className="text-sm text-slate-300">
          Confirm <strong>{proc.quantity} × {proc.item_sku}</strong> have arrived. This posts a <strong>Stock In</strong> transaction
          and marks the order as Received. Serialized units should then have S/N and MAC filled in via the Serialized Inventory screen.
        </p>
        <div className="flex space-x-3">
          <button onClick={onClose} className="flex-1 py-2 border border-slate-700 rounded-lg text-sm text-slate-400">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm text-white font-semibold disabled:opacity-50 flex items-center justify-center space-x-2">
            {saving && <RefreshCw className="w-4 h-4 animate-spin" />}
            <span>{saving ? 'Receiving…' : 'Receive & Stock In'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const DecideModal: React.FC<{ id: string; action: 'Approved' | 'Rejected'; onDone: () => void; onClose: () => void }> = ({ id, action, onDone, onClose }) => {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await apiFetch(`/api/procurement/${id}/decide`, { method: 'POST', body: JSON.stringify({ action, note }) });
      onDone(); onClose();
    } catch (err: any) { alert(err.message); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md space-y-4">
        <h3 className="font-bold text-slate-100">{action === 'Approved' ? '✅ Approve' : '❌ Reject'} — {id}</h3>
        {action === 'Rejected' && (
          <div>
            <label className="block text-xs text-slate-400 mb-1">Reason *</label>
            <textarea required rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500 resize-none" />
          </div>
        )}
        <div className="flex space-x-3">
          <button type="button" onClick={onClose} className="flex-1 py-2 border border-slate-700 rounded-lg text-sm text-slate-400">Cancel</button>
          <button type="submit" disabled={saving}
            className={`flex-1 py-2 rounded-lg text-sm text-white font-semibold disabled:opacity-50 ${action === 'Approved' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}`}>
            {saving ? 'Saving…' : action}
          </button>
        </div>
      </form>
    </div>
  );
};

// ---------- Main View ----------
type ActiveModal =
  | { type: 'order'; id: string }
  | { type: 'receive'; proc: ProcurementRequest }
  | { type: 'decide'; id: string; action: 'Approved' | 'Rejected' }
  | null;

export const ProjectsProcurementView: React.FC = () => {
  const [tab, setTab] = useState<'projects' | 'procurement'>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [procurement, setProcurement] = useState<ProcurementRequest[]>([]);
  const [catalog, setCatalog] = useState<ItemCatalog[]>([]);
  const [procFilter, setProcFilter] = useState('open');
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showProcForm, setShowProcForm] = useState(false);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [pj, pr, cat] = await Promise.all([
        apiFetch('/api/projects').catch(() => []),
        apiFetch('/api/procurement').catch(() => []),
        apiFetch('/api/catalog').catch(() => []),
      ]);
      setProjects(Array.isArray(pj) ? pj : []);
      setProcurement(Array.isArray(pr) ? pr : []);
      setCatalog(Array.isArray(cat) ? cat : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filteredProc = procurement.filter((p) => {
    if (procFilter === 'open') return ['Pending Finance', 'Approved', 'Ordered'].includes(p.status);
    if (procFilter === 'all') return true;
    return p.status === procFilter;
  });

  return (
    <div className="space-y-6">
      {/* Tab switcher */}
      <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex space-x-1 bg-slate-950 rounded-lg p-1">
          <button onClick={() => setTab('projects')}
            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${tab === 'projects' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
            <FolderKanban className="w-4 h-4 inline mr-1.5" />Projects
          </button>
          <button onClick={() => setTab('procurement')}
            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${tab === 'procurement' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
            <ShoppingCart className="w-4 h-4 inline mr-1.5" />Procurement
          </button>
        </div>
        <div className="flex items-center space-x-2">
          <button onClick={fetchAll} className="p-2 text-slate-400 hover:text-slate-200 transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {tab === 'projects' && (
            <button onClick={() => setShowProjectForm((v) => !v)}
              className="flex items-center space-x-1.5 px-3 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold transition-colors">
              <Plus className="w-4 h-4" /><span>New Project</span>
            </button>
          )}
          {tab === 'procurement' && (
            <button onClick={() => setShowProcForm((v) => !v)}
              className="flex items-center space-x-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold transition-colors">
              <Plus className="w-4 h-4" /><span>Purchase Request</span>
            </button>
          )}
        </div>
      </div>

      {/* ---------- PROJECTS TAB ---------- */}
      {tab === 'projects' && (
        <>
          {showProjectForm && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="font-bold text-sm text-slate-200 mb-4 border-b border-slate-800 pb-2">New / Edit Project</h3>
              <ProjectForm onDone={() => { setShowProjectForm(false); fetchAll(); }} />
            </div>
          )}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {projects.length === 0 && !loading && (
              <p className="col-span-2 text-sm text-slate-500 text-center py-10">No projects yet.</p>
            )}
            {projects.map((p) => {
              const budget = Number(p.budget || 0);
              const spent = Number(p.actual_spend || 0);
              const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
              const over = budget > 0 && spent > budget;
              return (
                <div key={p.project_id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-mono text-xs text-slate-500">{p.project_id}</p>
                      <h4 className="font-bold text-slate-100">{p.project_name}</h4>
                      <p className="text-xs text-slate-400">{p.type} · {p.location_fat || 'no location'} · PM: {p.project_manager || '—'}</p>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                  {budget > 0 && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>Budget: <span className="text-slate-200 font-semibold">{money(budget)}</span></span>
                        <span className={over ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                          Spent: {money(spent)} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${over ? 'bg-rose-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )}
                  {p.notes && <p className="text-xs text-slate-500">{p.notes}</p>}
                  <div className="flex space-x-2 pt-1">
                    <span className="text-[11px] text-slate-500">
                      {p.start_date?.slice(0, 10)} → {p.end_date?.slice(0, 10) || 'open'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ---------- PROCUREMENT TAB ---------- */}
      {tab === 'procurement' && (
        <>
          {showProcForm && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="font-bold text-sm text-slate-200 mb-4 border-b border-slate-800 pb-2">
                Purchase Request — Finance → Approval → Order → Receive
              </h3>
              <ProcurementForm catalog={catalog} projects={projects} onDone={() => { setShowProcForm(false); fetchAll(); }} />
            </div>
          )}

          {/* Filter bar */}
          <div className="flex flex-wrap gap-2">
            {['open', 'all', 'Pending Finance', 'Approved', 'Ordered', 'Received', 'Rejected'].map((f) => (
              <button key={f} onClick={() => setProcFilter(f)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${procFilter === f ? 'bg-purple-600 border-purple-600 text-white' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>
                {f === 'open' ? 'Open (needs action)' : f === 'all' ? 'All' : f}
              </button>
            ))}
          </div>

          {/* Workflow legend */}
          <div className="flex items-center space-x-2 text-[10px] text-slate-500 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2">
            <span className="text-slate-400 font-semibold">Flow:</span>
            {['Request', '→ Finance Approval', '→ Order', '→ Receive / Stock-In', '→ Delivery Note'].map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  {['Purchase ID', 'Item / Qty', 'Project', 'Est. Total', 'Status', 'Supplier / PO', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 font-semibold uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredProc.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">No procurement records in this view.</td></tr>
                ) : filteredProc.map((pr) => (
                  <tr key={pr.procurement_id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-mono font-bold text-sky-400">{pr.procurement_id}</p>
                      <p className="text-slate-500">{pr.date_requested?.slice(0, 10)}</p>
                      <p className="text-slate-500">by {pr.requested_by}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono text-slate-200">{pr.item_sku}</p>
                      <p className="text-slate-400">× {pr.quantity}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{pr.project_id || 'General'}</td>
                    <td className="px-4 py-3 font-semibold text-slate-200">
                      {pr.est_total ? money(pr.est_total) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={pr.status} />
                      {pr.finance_by && <p className="text-[10px] text-slate-500 mt-1">Finance: {pr.finance_by}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      <p>{pr.supplier || '—'}</p>
                      {pr.po_ref && <p className="font-mono text-[10px]">{pr.po_ref}</p>}
                      {pr.notes && <p className="text-[10px] text-slate-500 max-w-[140px] truncate">{pr.notes}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col space-y-1">
                        {pr.status === 'Pending Finance' && (
                          <>
                            <button onClick={() => setActiveModal({ type: 'decide', id: pr.procurement_id, action: 'Approved' })}
                              className="flex items-center space-x-1 px-2 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-[10px] font-semibold">
                              <CheckCircle2 className="w-3 h-3" /><span>Approve</span>
                            </button>
                            <button onClick={() => setActiveModal({ type: 'decide', id: pr.procurement_id, action: 'Rejected' })}
                              className="flex items-center space-x-1 px-2 py-1 bg-rose-800 hover:bg-rose-700 text-white rounded text-[10px] font-semibold">
                              <XCircle className="w-3 h-3" /><span>Reject</span>
                            </button>
                          </>
                        )}
                        {pr.status === 'Approved' && (
                          <button onClick={() => setActiveModal({ type: 'order', id: pr.procurement_id })}
                            className="flex items-center space-x-1 px-2 py-1 bg-indigo-700 hover:bg-indigo-600 text-white rounded text-[10px] font-semibold">
                            <Truck className="w-3 h-3" /><span>Mark Ordered</span>
                          </button>
                        )}
                        {pr.status === 'Ordered' && (
                          <button onClick={() => setActiveModal({ type: 'receive', proc: pr })}
                            className="flex items-center space-x-1 px-2 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-[10px] font-semibold">
                            <PackageCheck className="w-3 h-3" /><span>Receive Stock</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---------- MODALS ---------- */}
      {activeModal?.type === 'decide' && (
        <DecideModal id={activeModal.id} action={activeModal.action} onDone={fetchAll} onClose={() => setActiveModal(null)} />
      )}
      {activeModal?.type === 'order' && (
        <OrderModal id={activeModal.id} onDone={fetchAll} onClose={() => setActiveModal(null)} />
      )}
      {activeModal?.type === 'receive' && (
        <ReceiveModal proc={activeModal.proc} onDone={fetchAll} onClose={() => setActiveModal(null)} />
      )}
    </div>
  );
};
