import React, { useEffect, useState, useCallback } from 'react';
import {
  UserCheck, Plus, RefreshCw, CheckCircle2, XCircle,
  Clock, PlayCircle, AlertTriangle, ChevronDown,
} from 'lucide-react';
import { apiFetch } from '../api';
import { TechnicianTask, ItemCatalog } from '../types';

// ---------- helpers ----------
const STATUS_COLORS: Record<string, string> = {
  Assigned:        'bg-indigo-950 text-indigo-400 border-indigo-800',
  'Awaiting Stock':'bg-amber-950 text-amber-400 border-amber-800',
  Ready:           'bg-sky-950 text-sky-400 border-sky-800',
  'In Progress':   'bg-purple-950 text-purple-400 border-purple-800',
  Completed:       'bg-emerald-950 text-emerald-400 border-emerald-800',
  Cancelled:       'bg-slate-800 text-slate-400 border-slate-700',
};
const PRIORITY_COLORS: Record<string, string> = {
  Critical: 'text-rose-400',
  High:     'text-amber-400',
  Normal:   'text-slate-400',
  Low:      'text-slate-500',
};

const StatusBadge = ({ status }: { status: string }) => (
  <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${STATUS_COLORS[status] || 'bg-slate-800 text-slate-400 border-slate-700'}`}>
    {status}
  </span>
);

// ---------- Task form ----------
const emptyTask = () => ({
  task_title: '',
  task_type: 'Field Work',
  assigned_personnel: '',
  priority: 'Normal',
  required_sku: '',
  required_qty: 1,
  customer_site: '',
  reference: '',
  notes: '',
  project_id: '',
});

interface TaskFormProps {
  catalog: ItemCatalog[];
  onDone: () => void;
}

const TaskForm: React.FC<TaskFormProps> = ({ catalog, onDone }) => {
  const [f, setF] = useState(emptyTask());
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string | number) => setF((p) => ({ ...p, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/tasks', { method: 'POST', body: JSON.stringify(f) });
      setF(emptyTask());
      onDone();
    } catch (err: any) {
      alert(err.message || 'Failed to create task');
    } finally {
      setSaving(false);
    }
  };

  const inp = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500';

  return (
    <form onSubmit={save} className="space-y-3">
      <div>
        <label className="block text-xs text-slate-400 mb-1">Task Title *</label>
        <input required value={f.task_title} onChange={(e) => set('task_title', e.target.value)}
          className={inp} placeholder="e.g. Replace ONT at Plot 4" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Type</label>
          <select value={f.task_type} onChange={(e) => set('task_type', e.target.value)} className={inp}>
            {['Field Work', 'Installation', 'Repair', 'Replacement', 'Survey', 'Admin', 'Other'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Priority</label>
          <select value={f.priority} onChange={(e) => set('priority', e.target.value)} className={inp}>
            {['Normal', 'High', 'Critical', 'Low'].map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">Assign to (name or email) *</label>
        <input required value={f.assigned_personnel} onChange={(e) => set('assigned_personnel', e.target.value)}
          className={inp} placeholder="Technician name" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Required SKU (optional)</label>
          <select value={f.required_sku} onChange={(e) => set('required_sku', e.target.value)} className={inp}>
            <option value="">No stock needed</option>
            {catalog.map((c) => <option key={c.sku} value={c.sku}>{c.sku} — {c.model}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Qty</label>
          <input type="number" min="1" value={f.required_qty} onChange={(e) => set('required_qty', Number(e.target.value))}
            className={inp} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Customer / Site</label>
          <input value={f.customer_site} onChange={(e) => set('customer_site', e.target.value)}
            className={inp} placeholder="Plot 14, Hotspot name…" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Ticket / Reference</label>
          <input value={f.reference} onChange={(e) => set('reference', e.target.value)}
            className={inp} placeholder="TKT-4491" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">Instructions / Notes</label>
        <textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)}
          className={`${inp} resize-none`} />
      </div>
      <button type="submit" disabled={saving}
        className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center justify-center space-x-2">
        {saving && <RefreshCw className="w-4 h-4 animate-spin" />}
        <span>{saving ? 'Creating…' : 'Assign Task'}</span>
      </button>
    </form>
  );
};

// ---------- Status update modal ----------
interface UpdateModalProps {
  task: TechnicianTask;
  newStatus: string;
  onDone: () => void;
  onClose: () => void;
}

const UpdateModal: React.FC<UpdateModalProps> = ({ task, newStatus, onDone, onClose }) => {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch(`/api/tasks/${task.task_id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus, note }),
      });
      onDone();
      onClose();
    } catch (err: any) {
      alert(err.message || 'Failed to update task');
    } finally {
      setSaving(false);
    }
  };

  const isCompletion = newStatus === 'Completed';
  const isCancellation = newStatus === 'Cancelled';

  return (
    <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md space-y-4 shadow-2xl">
        <h3 className="font-bold text-slate-100">
          {newStatus === 'In Progress' && '▶ Start Task'}
          {isCompletion && '✅ Complete Task'}
          {isCancellation && '❌ Cancel Task'}
          <span className="text-xs text-slate-400 ml-2 font-mono">{task.task_id}</span>
        </h3>
        <div>
          <p className="text-sm text-slate-300 mb-1">{task.task_title}</p>
          {task.customer_site && <p className="text-xs text-slate-500">Site: {task.customer_site}</p>}
        </div>
        {(isCompletion || isCancellation) && (
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {isCompletion ? 'Job notes / what was done *' : 'Cancellation reason *'}
            </label>
            <textarea
              required
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500 resize-none"
              placeholder={isCompletion ? 'Replaced ONT, signal verified at -20 dBm…' : 'Reason for cancellation…'}
            />
          </div>
        )}
        <div className="flex space-x-3">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 border border-slate-700 rounded-lg text-sm text-slate-400 hover:text-slate-200 transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className={`flex-1 py-2 rounded-lg text-sm text-white font-semibold disabled:opacity-50 transition-colors flex items-center justify-center space-x-2 ${
              isCompletion ? 'bg-emerald-600 hover:bg-emerald-500'
              : isCancellation ? 'bg-rose-700 hover:bg-rose-600'
              : 'bg-sky-600 hover:bg-sky-500'
            }`}>
            {saving && <RefreshCw className="w-4 h-4 animate-spin" />}
            <span>{saving ? 'Saving…' : `Mark ${newStatus}`}</span>
          </button>
        </div>
      </form>
    </div>
  );
};

// ---------- Main view ----------
type ModalState = { task: TechnicianTask; newStatus: string } | null;

const FILTERS = ['active', 'all', 'Assigned', 'Awaiting Stock', 'Ready', 'In Progress', 'Completed', 'Cancelled'] as const;

export const TasksView: React.FC = () => {
  const [tasks, setTasks] = useState<TechnicianTask[]>([]);
  const [catalog, setCatalog] = useState<ItemCatalog[]>([]);
  const [filter, setFilter] = useState<string>('active');
  const [showForm, setShowForm] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [t, c] = await Promise.all([
        apiFetch('/api/tasks').catch(() => []),
        apiFetch('/api/catalog').catch(() => []),
      ]);
      setTasks(Array.isArray(t) ? t : []);
      setCatalog(Array.isArray(c) ? c : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const ACTIVE_STATUSES = ['Assigned', 'Awaiting Stock', 'Ready', 'In Progress'];

  const filtered = tasks.filter((t) => {
    if (filter === 'active') return ACTIVE_STATUSES.includes(t.status);
    if (filter === 'all') return true;
    return t.status === filter;
  }).slice().reverse();

  const quickStart = async (task: TechnicianTask) => {
    try {
      await apiFetch(`/api/tasks/${task.task_id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'In Progress', note: '' }),
      });
      fetchAll();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Summary counts
  const counts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});
  const activeCount = ACTIVE_STATUSES.reduce((s, k) => s + (counts[k] || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-sky-950 border border-sky-800 rounded-lg text-sky-400">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-sm text-slate-100">Technician Tasks</h2>
            <p className="text-xs text-slate-400">
              {activeCount} active task{activeCount !== 1 ? 's' : ''} · {counts['Completed'] || 0} completed
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button onClick={fetchAll} className="p-2 text-slate-400 hover:text-slate-200 transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center space-x-1.5 px-3 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Assign Task</span>
          </button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(STATUS_COLORS).map(([s]) => counts[s] ? (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${filter === s ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>
            {s} <span className="ml-1 opacity-70">{counts[s]}</span>
          </button>
        ) : null)}
      </div>

      {/* Task form */}
      {showForm && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="font-bold text-sm text-slate-200 mb-4 border-b border-slate-800 pb-2">New Task Assignment</h3>
          <TaskForm catalog={catalog} onDone={() => { setShowForm(false); fetchAll(); }} />
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 text-[11px]">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-lg font-semibold border transition-colors ${filter === f ? 'bg-sky-700 border-sky-600 text-white' : 'border-slate-800 text-slate-500 hover:text-slate-300'}`}>
            {f === 'active' ? '⚡ Active' : f === 'all' ? 'All' : f}
          </button>
        ))}
      </div>

      {/* Task cards */}
      {filtered.length === 0 && !loading && (
        <div className="text-center py-12 text-slate-500">
          <UserCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No tasks in this view.</p>
        </div>
      )}

      <div className="grid gap-4">
        {filtered.map((task) => {
          const done = ['Completed', 'Cancelled'].includes(task.status);
          const canStart = task.status === 'Assigned' || task.status === 'Ready';
          const canComplete = task.status === 'In Progress';
          const awaiting = task.status === 'Awaiting Stock';

          return (
            <div key={task.task_id}
              className={`bg-slate-900 border rounded-xl p-5 space-y-3 transition-all ${done ? 'border-slate-800 opacity-70' : 'border-slate-700 shadow-md'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <p className="font-mono text-xs text-slate-500">{task.task_id}</p>
                    <StatusBadge status={task.status} />
                    <span className={`text-[10px] font-bold ${PRIORITY_COLORS[task.priority] || 'text-slate-400'}`}>
                      {task.priority !== 'Normal' ? `▲ ${task.priority}` : ''}
                    </span>
                  </div>
                  <h4 className="font-bold text-slate-100 truncate">{task.task_title}</h4>
                  <p className="text-xs text-slate-400">
                    {task.task_type} · Assigned to <span className="text-slate-200 font-semibold">{task.assigned_personnel}</span>
                    {task.created_by && ` · by ${task.created_by}`}
                  </p>
                </div>

                {/* Action buttons */}
                {!done && (
                  <div className="flex items-center space-x-2 shrink-0">
                    {awaiting && (
                      <span className="flex items-center space-x-1 text-amber-400 text-xs">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Awaiting stock</span>
                      </span>
                    )}
                    {canStart && (
                      <button onClick={() => quickStart(task)}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-sky-700 hover:bg-sky-600 text-white rounded-lg text-xs font-semibold transition-colors">
                        <PlayCircle className="w-3.5 h-3.5" />
                        <span>Start</span>
                      </button>
                    )}
                    {canComplete && (
                      <button onClick={() => setModal({ task, newStatus: 'Completed' })}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold transition-colors">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Complete</span>
                      </button>
                    )}
                    {!done && (
                      <button onClick={() => setModal({ task, newStatus: 'Cancelled' })}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-rose-900 hover:bg-rose-800 text-rose-300 rounded-lg text-xs font-semibold transition-colors">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {task.customer_site && (
                  <div>
                    <p className="text-slate-500 mb-0.5">Site</p>
                    <p className="text-slate-200">{task.customer_site}</p>
                  </div>
                )}
                {task.reference && (
                  <div>
                    <p className="text-slate-500 mb-0.5">Reference</p>
                    <p className="font-mono text-sky-400">{task.reference}</p>
                  </div>
                )}
                {task.required_sku && (
                  <div>
                    <p className="text-slate-500 mb-0.5">Stock needed</p>
                    <p className="font-mono text-slate-200">{task.required_sku} × {task.required_qty}</p>
                  </div>
                )}
                {task.created_at && (
                  <div>
                    <p className="text-slate-500 mb-0.5">Created</p>
                    <p className="text-slate-400">{new Date(task.created_at).toLocaleDateString()}</p>
                  </div>
                )}
              </div>

              {task.notes && (
                <p className="text-xs text-slate-400 border-t border-slate-800 pt-2">{task.notes}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Status update modal */}
      {modal && (
        <UpdateModal
          task={modal.task}
          newStatus={modal.newStatus}
          onDone={fetchAll}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
};
