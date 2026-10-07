import React, { useEffect, useState } from 'react';
import { TechnicianRequisition } from '../types';
import { Plus, CheckCircle, XCircle, ArrowRight } from 'lucide-react';
import { apiFetch } from '../api';
import { useAuth } from '../auth';

export const RequisitionsView: React.FC = () => {
  const { can, user } = useAuth();
  const [reqs, setReqs] = useState<TechnicianRequisition[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    item_sku: '',
    quantity_requested: 1,
    reason_job_ticket: '',
    project_id: '',
  });

  const fetchReqs = () => {
    apiFetch('/api/requisitions')
      .then((data) => setReqs(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error('Error fetching requisitions:', err);
        setReqs([]);
      });
  };

  useEffect(() => {
    fetchReqs();
  }, []);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    apiFetch('/api/requisitions', {
      method: 'POST',
      body: JSON.stringify(form),
    })
      .then(() => {
        setShowModal(false);
        fetchReqs();
      })
      .catch((err) => console.error('Error creating requisition:', err));
  };

  const handleDecide = (id: string, action: string) => {
    apiFetch(`/api/requisitions/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ action, decision_note: action === 'Reject' ? (window.prompt('Reason for rejecting (the requester will see this):') || '') : '' }),
    })
      .then(() => fetchReqs())
      .catch((err) => console.error('Error deciding requisition:', err));
  };

  const handleIssue = (id: string) => {
    apiFetch(`/api/requisitions/${id}/issue`, {
      method: 'POST',
      body: JSON.stringify({ asset_ids: ['ONT-DEMO-01'] }),
    })
      .then(() => fetchReqs())
      .catch((err) => console.error('Error issuing requisition:', err));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
        <h3 className="font-bold text-xs text-slate-200">Technician Material Requests & Issue Workflow</h3>
        {can('requestMaterial') && <button
          onClick={() => setShowModal(true)}
          className="flex items-center space-x-2 bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-xs font-bold"
        >
          <Plus className="w-4 h-4" />
          <span>New Requisition</span>
        </button>}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider border-b border-slate-800">
            <tr>
              <th className="px-4 py-3">Req ID & Tech</th>
              <th className="px-4 py-3">Item SKU & Qty</th>
              <th className="px-4 py-3">Reason / Job Ticket</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {reqs.map((r) => (
              <tr key={r.requisition_id} className="hover:bg-slate-800/50">
                <td className="px-4 py-3 font-bold text-slate-100">
                  {r.requisition_id}
                  <div className="text-[10px] text-slate-400">{r.technician_name}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-mono text-sky-400">{r.item_sku}</div>
                  <div className="text-[10px] text-slate-400">Qty: {r.quantity_requested}</div>
                </td>
                <td className="px-4 py-3">{r.reason_job_ticket}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    r.approval_status === 'Issued'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : r.approval_status === 'Approved - Ready'
                      ? 'bg-sky-950 text-sky-400 border border-sky-800'
                      : 'bg-amber-950 text-amber-400 border border-amber-800'
                  }`}>
                    {r.approval_status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  {(r.approval_status === 'Pending Approval' || r.approval_status === 'Pending Finance') && r.technician_name !== user.name && can(r.approval_status === 'Pending Finance' ? 'approveFinance' : 'approveReq') && (
                    <>
                      <button
                        onClick={() => handleDecide(r.requisition_id, 'Approve')}
                        className="px-2.5 py-1 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded font-bold"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleDecide(r.requisition_id, 'Reject')}
                        className="px-2.5 py-1 bg-rose-950 text-rose-300 border border-rose-800 rounded font-bold"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {r.approval_status === 'Approved - Ready' && can('approveReq') && (
                    <button
                      onClick={() => handleIssue(r.requisition_id)}
                      className="px-3 py-1 bg-sky-600 text-white rounded font-bold inline-flex items-center space-x-1"
                    >
                      <ArrowRight className="w-3 h-3" />
                      <span>Issue Stock</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-bold text-slate-100 text-base">Create Technician Requisition</h3>
            <form onSubmit={handleCreate} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Requested SKU</label>
                <input
                  type="text"
                  required
                  value={form.item_sku}
                  onChange={(e) => setForm({ ...form, item_sku: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Reason / Ticket</label>
                <input
                  type="text"
                  value={form.reason_job_ticket}
                  onChange={(e) => setForm({ ...form, reason_job_ticket: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded font-bold"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-sky-600 text-white rounded font-bold">
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
