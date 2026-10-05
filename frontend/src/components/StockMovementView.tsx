import React, { useEffect, useState } from 'react';
import { ItemCatalog, SerializedInventory, InventoryTransaction } from '../types';
import { ArrowLeftRight, CheckCircle, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../api';

export const StockMovementView: React.FC = () => {
  const [catalog, setCatalog] = useState<ItemCatalog[]>([]);
  const [serializedUnits, setSerializedUnits] = useState<SerializedInventory[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [form, setForm] = useState({
    direction: 'Stock In',
    item_type: 'bulk',
    item_id: '',
    model: '',
    quantity: 1,
    user: 'Tech Alpha',
    cost_type: 'Procurement / Stock In',
    task_id: '',
    site: 'Main Store',
    notes: '',
    project_id: '',
  });

  const loadData = () => {
    apiFetch('/api/catalog')
      .then((data) => setCatalog(Array.isArray(data) ? data : []))
      .catch((err) => console.error(err));

    apiFetch('/api/inventory/serialized')
      .then((data) => setSerializedUnits(Array.isArray(data) ? data : []))
      .catch((err) => console.error(err));

    apiFetch('/api/inventory/transactions')
      .then((data) => setTransactions(Array.isArray(data) ? data : []))
      .catch((err) => console.error(err));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const res = await apiFetch('/api/inventory/movement', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setMessage({ type: 'success', text: res.message || 'Stock movement recorded successfully' });
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to record movement' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-4 self-start shadow-xl">
        <div className="flex items-center space-x-3 border-b border-slate-800 pb-3">
          <div className="p-2 bg-indigo-950 border border-indigo-800 rounded-lg text-indigo-400">
            <ArrowLeftRight className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-sm text-slate-100">Record Stock Movement</h2>
            <p className="text-xs text-slate-400">General stock in, stock out, transfers & adjustments</p>
          </div>
        </div>

        {message && (
          <div
            className={`p-3 rounded-lg text-xs flex items-center space-x-2 border ${
              message.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300'
                : 'bg-rose-950/80 border-rose-800 text-rose-300'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Direction</label>
              <select
                value={form.direction}
                onChange={(e) => setForm({ ...form, direction: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              >
                <option value="Stock In">Stock In (+)</option>
                <option value="Stock Out">Stock Out (-)</option>
                <option value="Transfer">Transfer</option>
                <option value="Adjustment">Adjustment</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Item Category</label>
              <select
                value={form.item_type}
                onChange={(e) => setForm({ ...form, item_type: e.target.value, item_id: '' })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              >
                <option value="bulk">Bulk SKU Stock</option>
                <option value="serialized">Serialized Unit (by Asset ID / S/N)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Select Item *</label>
            <select
              required
              value={form.item_id}
              onChange={(e) => {
                const selected = e.target.value;
                let modelName = '';
                if (form.item_type === 'bulk') {
                  const item = catalog.find((c) => c.sku === selected);
                  modelName = item ? item.model : '';
                } else {
                  const item = serializedUnits.find((u) => u.asset_id === selected);
                  modelName = item ? item.model : '';
                }
                setForm({ ...form, item_id: selected, model: modelName });
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
            >
              <option value="">-- Choose Item --</option>
              {form.item_type === 'bulk'
                ? catalog.map((c) => (
                    <option key={c.sku} value={c.sku}>
                      {c.sku} - {c.model}
                    </option>
                  ))
                : serializedUnits.map((u) => (
                    <option key={u.asset_id} value={u.asset_id}>
                      {u.asset_id} - {u.model} (S/N: {u.serial_number || 'N/A'}) [{u.status}]
                    </option>
                  ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                required
                value={form.quantity}
                readOnly={form.item_type === 'serialized'}
                onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 1 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 read-only:opacity-60"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Personnel / Tech</label>
              <input
                type="text"
                required
                value={form.user}
                onChange={(e) => setForm({ ...form, user: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Cost Type</label>
              <select
                value={form.cost_type}
                onChange={(e) => setForm({ ...form, cost_type: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              >
                <option value="Procurement / Stock In">Procurement / Stock In</option>
                <option value="Installation">Installation</option>
                <option value="Replacement">Replacement</option>
                <option value="Repair">Repair</option>
                <option value="Transfer">Transfer</option>
                <option value="Adjustment">Adjustment</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Location / Site Ref</label>
              <input
                type="text"
                value={form.site}
                onChange={(e) => setForm({ ...form, site: e.target.value })}
                placeholder="Main Store, Plot 14"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Task ID / Reference</label>
            <input
              type="text"
              value={form.task_id}
              onChange={(e) => setForm({ ...form, task_id: e.target.value })}
              placeholder="e.g. TASK-1002 / TCK-401"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Movement Notes</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Reason for movement..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg shadow-md transition-all disabled:opacity-50"
          >
            {loading ? 'Recording...' : 'Execute Stock Movement'}
          </button>
        </form>
      </div>

      <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <h3 className="font-bold text-sm text-slate-100">Transaction History Log</h3>
          <span className="text-xs text-slate-400">{transactions.length} Total Movements</span>
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 sticky top-0 border-b border-slate-800 uppercase font-semibold">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">Direction</th>
                <th className="p-3">SKU / Asset</th>
                <th className="p-3">Qty</th>
                <th className="p-3">Personnel</th>
                <th className="p-3">Site / Ref</th>
                <th className="p-3">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-500">
                    No transactions recorded yet.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-850 transition-colors">
                    <td className="p-3 text-slate-400">{new Date(tx.transaction_date).toLocaleDateString()}</td>
                    <td className="p-3 font-semibold">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] ${
                          tx.direction === 'Stock In'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-amber-950 text-amber-400 border border-amber-800'
                        }`}
                      >
                        {tx.direction}
                      </span>
                    </td>
                    <td className="p-3">
                      <p className="font-mono text-sky-400 font-bold">{tx.sku}</p>
                      <p className="text-[10px] text-slate-400">{tx.item_name}</p>
                    </td>
                    <td className="p-3 font-bold text-slate-100">{tx.quantity}</td>
                    <td className="p-3">{tx.requested_by}</td>
                    <td className="p-3 text-slate-400">{tx.site_reference || '—'}</td>
                    <td className="p-3 text-emerald-400 font-semibold">
                      KES {tx.total_cost ? tx.total_cost.toLocaleString() : '0'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
