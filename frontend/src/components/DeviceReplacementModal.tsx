import { DeviceReplacementSchema } from "../schemas";
import React, { useEffect, useState } from 'react';
import { SerializedInventory, CustomerTicket } from '../types';
import { RefreshCw, CheckCircle, AlertTriangle, X } from 'lucide-react';
import { apiFetch } from '../api';

interface DeviceReplacementModalProps {
  onClose: () => void;
  onSuccess?: () => void;
}

export const DeviceReplacementModal: React.FC<DeviceReplacementModalProps> = ({ onClose, onSuccess }) => {
  const [units, setUnits] = useState<SerializedInventory[]>([]);
  const [tickets, setTickets] = useState<CustomerTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    kind: 'customer',
    entityId: '',
    role: 'ONU',
    oldAsset: '',
    newAsset: '',
    ticketId: '',
    reason: 'Optical Loss / Faulty Device Swap',
  });

  useEffect(() => {
    apiFetch('/api/inventory/serialized')
      .then((data) => setUnits(Array.isArray(data) ? data : []))
      .catch((err) => console.error(err));

    apiFetch('/api/tickets')
      .then((data) => setTickets(Array.isArray(data) ? data : []))
      .catch((err) => console.error(err));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      kind: form.kind as 'customer' | 'hotspot',
      entity_id: form.entityId,
      role: form.role as 'ONU' | 'AP',
      old_asset: form.oldAsset,
      new_asset: form.newAsset,
      ticket_id: form.ticketId,
      reason: form.reason,
    };
    const val = DeviceReplacementSchema.safeParse(payload);
    if (!val.success) {
      setError(val.error.errors[0].message);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      await apiFetch('/api/device-replacement', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Device replacement failed');
    } finally {
      setLoading(false);
    }
  };

  const inStockUnits = units.filter((u) => u.status === 'In Stock');
  const deployedUnits = units.filter((u) => u.status === 'Issued / Out' || u.status === 'In Stock');

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 border-b border-slate-800 pb-3">
          <div className="p-2 bg-amber-950 border border-amber-800 rounded-lg text-amber-400">
            <RefreshCw className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-base text-slate-100">Device Replacement Workflow</h3>
            <p className="text-xs text-slate-400">
              Replace faulty ONU / AP, mark old unit as Under Repair, and link replacement ticket
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-lg text-xs text-rose-300 flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Target Account / Site ID *</label>
              <input
                type="text"
                required
                value={form.entityId}
                onChange={(e) => setForm({ ...form, entityId: e.target.value })}
                placeholder="e.g. ACC-1001"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Device Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              >
                <option value="ONU">ONU / ONT</option>
                <option value="AP">Access Point (AP)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Faulty / Old Device S/N or Asset ID *</label>
            <input
              type="text"
              required
              value={form.oldAsset}
              onChange={(e) => setForm({ ...form, oldAsset: e.target.value })}
              placeholder="e.g. INV-ONT-0012 or S/N 48575443"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 font-mono text-slate-200"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Replacement Unit (In Stock) *</label>
            <select
              required
              value={form.newAsset}
              onChange={(e) => setForm({ ...form, newAsset: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
            >
              <option value="">-- Choose Replacement Unit --</option>
              {inStockUnits.map((u) => (
                <option key={u.asset_id} value={u.asset_id}>
                  {u.asset_id} - {u.model} (S/N: {u.serial_number || 'N/A'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Link Support Ticket (Optional)</label>
            <select
              value={form.ticketId}
              onChange={(e) => setForm({ ...form, ticketId: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
            >
              <option value="">-- No Linked Ticket --</option>
              {tickets.map((t) => (
                <option key={t.ticket_id} value={t.ticket_id}>
                  {t.ticket_id} - {t.issue_category} ({t.customer_account})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Reason / Fault Description *</label>
            <textarea
              rows={2}
              required
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-semibold disabled:opacity-50"
            >
              {loading ? 'Processing Replacement...' : 'Execute Device Replacement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
