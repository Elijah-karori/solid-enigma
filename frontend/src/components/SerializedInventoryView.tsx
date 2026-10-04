import React, { useEffect, useState } from 'react';
import { SerializedInventory } from '../types';
import { Plus, Edit2, Cpu, Search, QrCode } from 'lucide-react';

interface Props {
  onOpenGenieACSModal: (serial: string) => void;
}

export const SerializedInventoryView: React.FC<Props> = ({ onOpenGenieACSModal }) => {
  const [inventory, setInventory] = useState<SerializedInventory[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<SerializedInventory | null>(null);

  const [formData, setFormData] = useState({
    sku: 'SKU-ONT',
    serial_number: '',
    mac: '',
    model: 'HG8145V5',
    manufacturer: 'Huawei',
    access_tech: 'GPON',
    condition: 'New',
    location: 'Main Store',
    notes: '',
  });

  const fetchInventory = () => {
    fetch('/api/inventory/serialized', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
    })
      .then((res) => res.json())
      .then((data) => setInventory(data || []))
      .catch((err) => console.error(err));
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  const handleStockIn = (e: React.FormEvent) => {
    e.preventDefault();
    fetch('/api/inventory/stock-in', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token') || ''}`
      },
      body: JSON.stringify(formData),
    })
      .then((res) => res.json())
      .then(() => {
        setShowAddModal(false);
        fetchInventory();
        setFormData({
          sku: 'SKU-ONT',
          serial_number: '',
          mac: '',
          model: 'HG8145V5',
          manufacturer: 'Huawei',
          access_tech: 'GPON',
          condition: 'New',
          location: 'Main Store',
          notes: '',
        });
      });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    fetch(`/api/inventory/serialized/${editingItem.asset_id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token') || ''}`
      },
      body: JSON.stringify(editingItem),
    })
      .then((res) => res.json())
      .then(() => {
        setEditingItem(null);
        fetchInventory();
      });
  };

  const filtered = inventory.filter((item) =>
    (item.serial_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.mac || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.model || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.asset_id || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Filter S/N, MAC, Model..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex space-x-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-2 bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Stock In Serialized Item</span>
          </button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 font-medium border-b border-slate-800 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Asset ID / SKU</th>
                <th className="px-4 py-3">S/N & MAC</th>
                <th className="px-4 py-3">Model & Tech</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Condition</th>
                <th className="px-4 py-3">Location / Custodian</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {filtered.map((item) => (
                <tr key={item.asset_id} className="hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-mono font-bold text-sky-400">
                    {item.asset_id}
                    <div className="text-[10px] text-slate-400 font-normal">{item.sku}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-100">{item.serial_number || 'N/A'}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{item.mac || 'N/A'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{item.model}</div>
                    <div className="text-[10px] text-slate-400">{item.manufacturer} • {item.access_tech}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      item.status === 'In Stock'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                        : 'bg-amber-950 text-amber-400 border border-amber-800'
                    }`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{item.condition}</td>
                  <td className="px-4 py-3">
                    <div>{item.location}</div>
                    {item.custodian && <div className="text-[10px] text-slate-400">Custodian: {item.custodian}</div>}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {item.serial_number && (
                      <button
                        onClick={() => onOpenGenieACSModal(item.serial_number)}
                        className="px-2.5 py-1 bg-purple-950 text-purple-300 hover:bg-purple-900 border border-purple-800 rounded text-[11px] font-medium inline-flex items-center space-x-1"
                      >
                        <Cpu className="w-3 h-3" />
                        <span>TR-069</span>
                      </button>
                    )}
                    <button
                      onClick={() => setEditingItem(item)}
                      className="px-2.5 py-1 bg-slate-800 text-slate-200 hover:bg-slate-700 rounded text-[11px] inline-flex items-center space-x-1"
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>Edit</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock In Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-bold text-slate-100 text-base">Stock In Serialized Item</h3>
            <form onSubmit={handleStockIn} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">SKU Family</label>
                <select
                  value={formData.sku}
                  onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
                >
                  <option value="SKU-ONT">SKU-ONT (Optical Network Terminal)</option>
                  <option value="SKU-RTR">SKU-RTR (Wireless Router)</option>
                  <option value="SKU-FAT">SKU-FAT (FAT / Enclosure Box)</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Serial Number (S/N)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 4857544320A1B2C3"
                  value={formData.serial_number}
                  onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">MAC Address</label>
                <input
                  type="text"
                  placeholder="e.g. CC:D2:81:4A:2B:11"
                  value={formData.mac}
                  onChange={(e) => setFormData({ ...formData, mac: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Manufacturer</label>
                  <input
                    type="text"
                    value={formData.manufacturer}
                    onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Model</label>
                  <input
                    type="text"
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-600 text-white rounded font-bold"
                >
                  Save Unit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-bold text-slate-100 text-base">Edit Serialized Unit ({editingItem.asset_id})</h3>
            <form onSubmit={handleUpdate} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Serial Number</label>
                <input
                  type="text"
                  value={editingItem.serial_number}
                  onChange={(e) => setEditingItem({ ...editingItem, serial_number: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">MAC Address</label>
                <input
                  type="text"
                  value={editingItem.mac}
                  onChange={(e) => setEditingItem({ ...editingItem, mac: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Status</label>
                <select
                  value={editingItem.status}
                  onChange={(e) => setEditingItem({ ...editingItem, status: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
                >
                  <option value="In Stock">In Stock</option>
                  <option value="Issued / Out">Issued / Out</option>
                  <option value="Under Repair">Under Repair</option>
                  <option value="Decommissioned">Decommissioned</option>
                </select>
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-600 text-white rounded font-bold"
                >
                  Update
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
