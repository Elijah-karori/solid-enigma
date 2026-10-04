import React, { useEffect, useState } from 'react';
import { Customer, Hotspot, HotspotUser } from '../types';
import { UserPlus, Wifi, Search, Link, Cpu, MapPin } from 'lucide-react';
import { apiFetch } from '../api';

interface Props {
  onOpenGenieACSModal: (serial: string) => void;
}

export const CustomersView: React.FC<Props> = ({ onOpenGenieACSModal }) => {
  const [activeTab, setActiveTab] = useState<'customers' | 'hotspots'>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [showAddCustomer, setShowAddCustomer] = useState(false);

  const [cForm, setCForm] = useState({
    account_number: '',
    name: '',
    subscription_type: 'PPPoE' as 'PPPoE' | 'Hotspot',
    plot_number: 'Plot 45',
    location: 'Nairobi West',
    contact_person: '',
    contact_phone: '',
    assigned_onu_serial: '',
    assigned_ap_mac: '',
    linked_splitter_id: 'SPLITTER-01',
    linked_enclosure_id: 'FAT-02',
  });

  const fetchData = () => {
    apiFetch('/api/customers')
      .then((data) => setCustomers(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error('Error fetching customers:', err);
        setCustomers([]);
      });

    apiFetch('/api/hotspots')
      .then((data) => setHotspots(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error('Error fetching hotspots:', err);
        setHotspots([]);
      });
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    apiFetch('/api/customers', {
      method: 'POST',
      body: JSON.stringify(cForm),
    })
      .then(() => {
        setShowAddCustomer(false);
        fetchData();
      })
      .catch((err) => console.error('Error creating customer:', err));
  };

  return (
    <div className="space-y-4">
      <div className="flex border-b border-slate-800 space-x-4">
        <button
          onClick={() => setActiveTab('customers')}
          className={`pb-3 font-bold text-xs transition-colors border-b-2 ${
            activeTab === 'customers' ? 'border-sky-500 text-sky-400' : 'border-transparent text-slate-400'
          }`}
        >
          Customer Subscriptions (PPPoE / Hotspot)
        </button>
        <button
          onClick={() => setActiveTab('hotspots')}
          className={`pb-3 font-bold text-xs transition-colors border-b-2 ${
            activeTab === 'hotspots' ? 'border-sky-500 text-sky-400' : 'border-transparent text-slate-400'
          }`}
        >
          Hotspot Networks & Users
        </button>
      </div>

      {activeTab === 'customers' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
            <p className="text-xs text-slate-400">Total Subscribers Registered: {customers.length}</p>
            <button
              onClick={() => setShowAddCustomer(true)}
              className="flex items-center space-x-2 bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-xs font-bold"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add Customer</span>
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3">Account & Name</th>
                  <th className="px-4 py-3">Subscription Type</th>
                  <th className="px-4 py-3">Plot & Location</th>
                  <th className="px-4 py-3">Assigned ONU / AP</th>
                  <th className="px-4 py-3">Splitter / FAT Enclosure</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-800/50">
                    <td className="px-4 py-3 font-bold text-slate-100">
                      {c.name}
                      <div className="text-[10px] font-mono text-sky-400">{c.account_number}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        c.subscription_type === 'PPPoE' ? 'bg-sky-950 text-sky-400 border border-sky-800' : 'bg-purple-950 text-purple-400 border border-purple-800'
                      }`}>
                        {c.subscription_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div>{c.plot_number}</div>
                      <div className="text-[10px] text-slate-400">{c.location}</div>
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {c.assigned_onu_serial ? (
                        <div className="text-emerald-400">ONU: {c.assigned_onu_serial}</div>
                      ) : (
                        <div className="text-slate-500">Unassigned</div>
                      )}
                      {c.assigned_ap_mac && <div className="text-purple-400 text-[10px]">AP: {c.assigned_ap_mac}</div>}
                    </td>
                    <td className="px-4 py-3 text-[11px]">
                      <div>{c.linked_splitter_id || 'N/A'}</div>
                      <div className="text-slate-400 text-[10px]">FAT: {c.linked_enclosure_id || 'N/A'}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.assigned_onu_serial && (
                        <button
                          onClick={() => onOpenGenieACSModal(c.assigned_onu_serial)}
                          className="px-2 py-1 bg-purple-950 text-purple-300 hover:bg-purple-900 border border-purple-800 rounded text-[11px] inline-flex items-center space-x-1"
                        >
                          <Cpu className="w-3 h-3" />
                          <span>TR-069</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'hotspots' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {hotspots.map((h) => (
              <div key={h.id} className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-slate-100 text-sm">{h.name}</h4>
                    <p className="text-xs text-slate-400 flex items-center space-x-1 mt-1">
                      <MapPin className="w-3 h-3 text-sky-400" />
                      <span>{h.location_plot} • Contact: {h.contact_person}</span>
                    </p>
                  </div>
                  <span className="px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] rounded font-bold">
                    {h.status}
                  </span>
                </div>

                <div className="border-t border-slate-800 pt-3">
                  <p className="text-xs font-bold text-slate-300 mb-2">Connected Hotspot Users ({h.users?.length || 0})</p>
                  <div className="space-y-1">
                    {h.users && h.users.length > 0 ? (
                      h.users.map((u) => (
                        <div key={u.id} className="p-2 bg-slate-950 rounded border border-slate-800/80 flex justify-between text-xs font-mono">
                          <span className="text-slate-200">{u.username} ({u.phone})</span>
                          <span className="text-sky-400">{u.subscription_plan}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-500 italic">No active users currently assigned.</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {showAddCustomer && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-bold text-slate-100 text-base">Add New Customer</h3>
            <form onSubmit={handleCreateCustomer} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Account Number</label>
                <input
                  type="text"
                  required
                  placeholder="ACC-1001"
                  value={cForm.account_number}
                  onChange={(e) => setCForm({ ...cForm, account_number: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Customer Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="John Doe"
                  value={cForm.name}
                  onChange={(e) => setCForm({ ...cForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Subscription Type</label>
                  <select
                    value={cForm.subscription_type}
                    onChange={(e) => setCForm({ ...cForm, subscription_type: e.target.value as any })}
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
                  >
                    <option value="PPPoE">PPPoE</option>
                    <option value="Hotspot">Hotspot</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Plot Number</label>
                  <input
                    type="text"
                    value={cForm.plot_number}
                    onChange={(e) => setCForm({ ...cForm, plot_number: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Assigned ONU Serial Number</label>
                <input
                  type="text"
                  placeholder="e.g. 4857544320A1B2C3"
                  value={cForm.assigned_onu_serial}
                  onChange={(e) => setCForm({ ...cForm, assigned_onu_serial: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-mono"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddCustomer(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded font-bold"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-sky-600 text-white rounded font-bold">
                  Save Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
