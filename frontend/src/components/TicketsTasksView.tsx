import { TicketSchema } from "../schemas";
import React, { useEffect, useState } from 'react';
import { CustomerTicket } from '../types';
import { Plus, TicketCheck, RefreshCw, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../api';

export const TicketsTasksView: React.FC = () => {
  const [tickets, setTickets] = useState<CustomerTicket[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [tForm, setTForm] = useState({
    customer_account: 'ACC-1001',
    issue_category: 'Faulty ONT / Router',
    assigned_technician: 'Tech Alpha',
    device_swapped_old_sn: 'OLD-ONT-999',
    replacement_device_new_sn: 'NEW-ONT-100',
  });

  const fetchTickets = () => {
    apiFetch('/api/tickets')
      .then((data) => setTickets(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error('Error fetching tickets:', err);
        setTickets([]);
      });
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      customer_name: tForm.customer_account,
      issue_category: tForm.issue_category,
      assigned_technician: tForm.assigned_technician,
      old_device_sn: tForm.device_swapped_old_sn,
      new_device_sn: tForm.replacement_device_new_sn,
    };
    const val = TicketSchema.safeParse(payload);
    if (!val.success) {
      alert(val.error.errors[0].message);
      return;
    }
    apiFetch('/api/tickets', {
      method: 'POST',
      body: JSON.stringify(tForm),
    })
      .then(() => {
        setShowModal(false);
        fetchTickets();
      })
      .catch((err) => console.error('Error creating ticket:', err));
  };

  const handleResolve = (ticket: CustomerTicket) => {
    apiFetch(`/api/tickets/${ticket.ticket_id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...ticket,
        ticket_status: 'Resolved',
        resolution_notes: 'Device replaced and optic signal verified.',
      }),
    })
      .then(() => fetchTickets())
      .catch((err) => console.error('Error resolving ticket:', err));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
        <h3 className="font-bold text-xs text-slate-200">Customer Support Tickets & Device Replacements</h3>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center space-x-2 bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-xs font-bold"
        >
          <Plus className="w-4 h-4" />
          <span>Log Ticket</span>
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider border-b border-slate-800">
            <tr>
              <th className="px-4 py-3">Ticket ID & Account</th>
              <th className="px-4 py-3">Category & Tech</th>
              <th className="px-4 py-3">Old S/N → Replacement S/N</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {tickets.map((t) => (
              <tr key={t.ticket_id} className="hover:bg-slate-800/50">
                <td className="px-4 py-3 font-bold text-slate-100">
                  {t.ticket_id}
                  <div className="text-[10px] text-sky-400 font-mono">{t.customer_account}</div>
                </td>
                <td className="px-4 py-3">
                  <div>{t.issue_category}</div>
                  <div className="text-[10px] text-slate-400">Assigned: {t.assigned_technician}</div>
                </td>
                <td className="px-4 py-3 font-mono text-[11px]">
                  {t.device_swapped_old_sn ? (
                    <div className="text-rose-400">Old: {t.device_swapped_old_sn}</div>
                  ) : (
                    <div className="text-slate-500">None</div>
                  )}
                  {t.replacement_device_new_sn && (
                    <div className="text-emerald-400">New: {t.replacement_device_new_sn}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    t.ticket_status === 'Resolved' || t.ticket_status === 'Closed'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : 'bg-rose-950 text-rose-400 border border-rose-800'
                  }`}>
                    {t.ticket_status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {t.ticket_status !== 'Resolved' && t.ticket_status !== 'Closed' && (
                    <button
                      onClick={() => handleResolve(t)}
                      className="px-2.5 py-1 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded font-bold text-[11px] inline-flex items-center space-x-1"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Resolve Ticket</span>
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
            <h3 className="font-bold text-slate-100 text-base">Log Customer Issue Ticket</h3>
            <form onSubmit={handleCreate} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Customer Account</label>
                <input
                  type="text"
                  required
                  value={tForm.customer_account}
                  onChange={(e) => setTForm({ ...tForm, customer_account: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Issue Category</label>
                <select
                  value={tForm.issue_category}
                  onChange={(e) => setTForm({ ...tForm, issue_category: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
                >
                  <option value="No Optical Link">No Optical Link</option>
                  <option value="Faulty ONT / Router">Faulty ONT / Router</option>
                  <option value="High Loss / Splice Needed">High Loss / Splice Needed</option>
                  <option value="Wi-Fi / Password Reset">Wi-Fi / Password Reset</option>
                  <option value="New Installation">New Installation</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Faulty Old S/N (If swapping)</label>
                <input
                  type="text"
                  placeholder="e.g. OLD-123"
                  value={tForm.device_swapped_old_sn}
                  onChange={(e) => setTForm({ ...tForm, device_swapped_old_sn: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Replacement New S/N</label>
                <input
                  type="text"
                  placeholder="e.g. NEW-456"
                  value={tForm.replacement_device_new_sn}
                  onChange={(e) => setTForm({ ...tForm, replacement_device_new_sn: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-mono"
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
                  Log Ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
