import { BatchStockInSchema } from "../schemas";
import React, { useEffect, useState } from 'react';
import { ItemCatalog } from '../types';
import { Boxes, Plus, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiFetch } from '../api';

interface UnitRow {
  sn: string;
  mac: string;
  productId: string;
  condition: string;
  remarks: string;
}

export const BatchStockInView: React.FC = () => {
  const [catalog, setCatalog] = useState<ItemCatalog[]>([]);
  const [sku, setSku] = useState('');
  const [site, setSite] = useState('Main Store');
  const [notes, setNotes] = useState('');
  const [units, setUnits] = useState<UnitRow[]>([
    { sn: '', mac: '', productId: '', condition: 'New', remarks: '' },
  ]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    apiFetch('/api/catalog')
      .then((data) => {
        if (Array.isArray(data)) {
          setCatalog(data.filter((c) => c.tracking_type === 'SERIALIZED' || c.asset_type === 'ONT'));
        }
      })
      .catch((err) => console.error(err));
  }, []);

  const addRow = () => {
    setUnits([...units, { sn: '', mac: '', productId: '', condition: 'New', remarks: '' }]);
  };

  const removeRow = (index: number) => {
    setUnits(units.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: keyof UnitRow, value: string) => {
    const updated = [...units];
    updated[index][field] = value;
    setUnits(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = BatchStockInSchema.safeParse({ sku, site, notes, units });
    if (!val.success) {
      setMessage({ type: "error", text: val.error.errors[0].message });
      return;
    }
    setLoading(true);
    setMessage(null);

    const validUnits = units.filter((u) => u.sn.trim() || u.mac.trim());
    if (validUnits.length === 0) {
      setMessage({ type: 'error', text: 'Please enter at least one unit S/N or MAC' });
      setLoading(false);
      return;
    }

    try {
      const res = await apiFetch('/api/inventory/batch-stock-in', {
        method: 'POST',
        body: JSON.stringify({
          sku,
          site,
          notes,
          units: validUnits,
        }),
      });
      setMessage({ type: 'success', text: res.message || 'Batch stock in processed successfully' });
      setUnits([{ sn: '', mac: '', productId: '', condition: 'New', remarks: '' }]);
      setNotes('');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Batch stock in failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-4 shadow-xl">
        <div className="flex items-center space-x-3 border-b border-slate-800 pb-3">
          <div className="p-2 bg-emerald-950 border border-emerald-800 rounded-lg text-emerald-400">
            <Boxes className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-sm text-slate-100">Batch Stock In (Serialized Units)</h2>
            <p className="text-xs text-slate-400">Receive multiple ONTs, Routers, or FAT boxes into store in bulk</p>
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
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-400 mb-1">Select Model SKU *</label>
              <select
                required
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200"
              >
                <option value="">-- Choose Serialized SKU --</option>
                {catalog.map((c) => (
                  <option key={c.sku} value={c.sku}>
                    {c.sku} - {c.model} ({c.manufacturer})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Receiving Location / Store</label>
              <input
                type="text"
                required
                value={site}
                onChange={(e) => setSite(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200"
              />
            </div>
          </div>

          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950 p-4 space-y-3">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <span className="font-semibold text-slate-200">
                Unit Items List ({units.length} rows)
              </span>
              <button
                type="button"
                onClick={addRow}
                className="flex items-center space-x-1 text-sky-400 hover:text-sky-300 font-semibold"
              >
                <Plus className="w-4 h-4" />
                <span>Add Row</span>
              </button>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {units.map((u, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-slate-900 p-2 rounded-lg border border-slate-800">
                  <div className="col-span-3">
                    <input
                      type="text"
                      placeholder="Serial Number (S/N)"
                      value={u.sn}
                      onChange={(e) => updateRow(idx, 'sn', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 font-mono text-slate-200"
                    />
                  </div>
                  <div className="col-span-3">
                    <input
                      type="text"
                      placeholder="MAC Address"
                      value={u.mac}
                      onChange={(e) => updateRow(idx, 'mac', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 font-mono text-slate-200"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="text"
                      placeholder="Product ID"
                      value={u.productId}
                      onChange={(e) => updateRow(idx, 'productId', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 font-mono text-slate-200"
                    />
                  </div>
                  <div className="col-span-2">
                    <select
                      value={u.condition}
                      onChange={(e) => updateRow(idx, 'condition', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-slate-200"
                    >
                      <option value="New">New</option>
                      <option value="Good">Good</option>
                      <option value="Faulty">Faulty</option>
                    </select>
                  </div>
                  <div className="col-span-2 flex items-center space-x-1">
                    <input
                      type="text"
                      placeholder="Remarks"
                      value={u.remarks}
                      onChange={(e) => updateRow(idx, 'remarks', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-slate-200"
                    />
                    {units.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        className="p-1.5 text-rose-400 hover:text-rose-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Batch Delivery / PO Reference Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Supplier Huawei Delivery Note #88192"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg shadow-md transition-all disabled:opacity-50"
          >
            {loading ? 'Processing Batch Stock In...' : 'Receive Units into Inventory'}
          </button>
        </form>
      </div>
    </div>
  );
};
