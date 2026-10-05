import React, { useEffect, useState } from 'react';
import { DeliveryNote } from '../types';
import { FileText, Plus, CheckCircle, CreditCard } from 'lucide-react';
import { apiFetch } from '../api';

export const DeliveryNotesView: React.FC = () => {
  const [docs, setDocs] = useState<DeliveryNote[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState<DeliveryNote | null>(null);

  const [form, setForm] = useState({
    ref: '',
    type: 'Delivery note',
    project: '',
    recipient: '',
    value: 0,
  });

  const [payForm, setPayForm] = useState({
    status: 'Paid',
    ref: '',
  });

  const fetchDocs = () => {
    apiFetch('/api/delivery-notes')
      .then((data) => setDocs(Array.isArray(data) ? data : []))
      .catch((err) => console.error(err));
  };

  useEffect(() => {
    fetchDocs();
  }, []);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    apiFetch('/api/delivery-notes', {
      method: 'POST',
      body: JSON.stringify(form),
    })
      .then(() => {
        setShowModal(false);
        fetchDocs();
      })
      .catch((err) => alert(err.message || 'Error generating note'));
  };

  const handlePayUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!showPayModal) return;

    apiFetch(`/api/delivery-notes/${showPayModal.doc_no}/payment`, {
      method: 'PATCH',
      body: JSON.stringify(payForm),
    })
      .then(() => {
        setShowPayModal(null);
        fetchDocs();
      })
      .catch((err) => alert(err.message || 'Error updating payment status'));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-indigo-950 border border-indigo-800 rounded-lg text-indigo-400">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-sm text-slate-100">Delivery & Receipt Notes</h2>
            <p className="text-xs text-slate-400">Manage delivery notes, material receipts, and Finance payment tracking</p>
          </div>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg text-xs transition-all shadow-md"
        >
          <Plus className="w-4 h-4" />
          <span>Generate Note</span>
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase font-semibold">
            <tr>
              <th className="p-3">Doc No</th>
              <th className="p-3">Type</th>
              <th className="p-3">Reference / Project</th>
              <th className="p-3">Recipient</th>
              <th className="p-3">Value (KES)</th>
              <th className="p-3">Payment Status</th>
              <th className="p-3">Payment Ref</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {docs.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-slate-500">
                  No delivery or receipt notes generated yet.
                </td>
              </tr>
            ) : (
              docs.map((d) => (
                <tr key={d.doc_no} className="hover:bg-slate-850 transition-colors">
                  <td className="p-3 font-mono text-sky-400 font-bold">{d.doc_no}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 bg-slate-950 border border-slate-700 text-slate-300 rounded text-[10px]">
                      {d.type}
                    </span>
                  </td>
                  <td className="p-3">
                    <p className="font-semibold text-slate-100">{d.reference}</p>
                    <p className="text-[10px] text-slate-400">{d.project_id || 'General'}</p>
                  </td>
                  <td className="p-3">{d.recipient}</td>
                  <td className="p-3 font-semibold text-emerald-400">
                    KES {d.value_kes ? d.value_kes.toLocaleString() : '0'}
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        d.payment_status === 'Paid'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : d.payment_status === 'Pending'
                          ? 'bg-amber-950 text-amber-400 border border-amber-800'
                          : 'bg-slate-950 text-slate-400 border border-slate-800'
                      }`}
                    >
                      {d.payment_status || 'Pending'}
                    </span>
                  </td>
                  <td className="p-3 text-slate-400">
                    {d.payment_ref ? `${d.payment_ref} (${d.paid_date})` : '—'}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => {
                        setShowPayModal(d);
                        setPayForm({ status: d.payment_status || 'Paid', ref: d.payment_ref || '' });
                      }}
                      className="px-2 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-sky-400 rounded text-[11px] font-medium transition-colors inline-flex items-center space-x-1"
                    >
                      <CreditCard className="w-3 h-3" />
                      <span>Update Payment</span>
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
              Generate Delivery / Receipt Note
            </h3>
            <form onSubmit={handleCreate} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Note Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                >
                  <option value="Delivery note">Delivery note (Material Issue)</option>
                  <option value="Receipt note">Receipt note (Procurement Received)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Reference (REQ ID / PO Ref) *</label>
                <input
                  type="text"
                  required
                  value={form.ref}
                  onChange={(e) => setForm({ ...form, ref: e.target.value })}
                  placeholder="e.g. REQ-99120 / PO-4012"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Recipient Name / Customer *</label>
                <input
                  type="text"
                  required
                  value={form.recipient}
                  onChange={(e) => setForm({ ...form, recipient: e.target.value })}
                  placeholder="Tech Alpha / Plot 12 Mall"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Project ID</label>
                  <input
                    type="text"
                    value={form.project}
                    onChange={(e) => setForm({ ...form, project: e.target.value })}
                    placeholder="PRJ-101"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Total Value (KES)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold">
                  Create Note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPayModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-base text-slate-100 border-b border-slate-800 pb-2">
              Payment Status: {showPayModal.doc_no}
            </h3>
            <form onSubmit={handlePayUpdate} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Status</label>
                <select
                  value={payForm.status}
                  onChange={(e) => setPayForm({ ...payForm, status: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                >
                  <option value="Pending">Pending</option>
                  <option value="Paid">Paid</option>
                  <option value="Tracking only">Tracking only</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Payment Reference (M-Pesa / Cheque)</label>
                <input
                  type="text"
                  value={payForm.ref}
                  onChange={(e) => setPayForm({ ...payForm, ref: e.target.value })}
                  placeholder="e.g. QK81290X1"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowPayModal(null)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-sky-600 text-white rounded-lg font-semibold">
                  Save Payment Status
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
