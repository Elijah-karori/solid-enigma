import { CatalogItemSchema } from "../schemas";
import React, { useEffect, useState } from 'react';
import { ItemCatalog } from '../types';
import { Plus, Edit2, Boxes, Search } from 'lucide-react';
import { apiFetch } from '../api';

export const CatalogView: React.FC = () => {
  const [catalog, setCatalog] = useState<ItemCatalog[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<ItemCatalog | null>(null);

  const [form, setForm] = useState({
    sku: '',
    asset_type: 'ONT',
    manufacturer: '',
    model: '',
    access_tech: 'GPON',
    unit_cost: 0,
    description: '',
    reorder_level: 3,
    tracking_type: 'SERIALIZED',
    project_scope: 'Shared',
  });

  const fetchCatalog = () => {
    apiFetch('/api/catalog')
      .then((data) => setCatalog(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Catalog fetch error:', err));
  };

  useEffect(() => {
    fetchCatalog();
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    apiFetch('/api/catalog', {
      method: 'POST',
      body: JSON.stringify(editingItem || form),
    })
      .then(() => {
        setShowModal(false);
        setEditingItem(null);
        fetchCatalog();
      })
      .catch((err) => alert(err.message || 'Error saving catalog item'));
  };

  const filtered = catalog.filter((c) =>
    `${c.sku} ${c.model} ${c.manufacturer} ${c.description}`.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-sky-950 border border-sky-800 rounded-lg text-sky-400">
            <Boxes className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-sm text-slate-100">Item Catalog Master</h2>
            <p className="text-xs text-slate-400">Manage SKUs, unit costs, tracking types, and reorder levels</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Filter catalog..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 w-48"
            />
          </div>
          <button
            onClick={() => {
              setEditingItem(null);
              setShowModal(true);
            }}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg text-xs transition-all shadow-md shadow-sky-600/30"
          >
            <Plus className="w-4 h-4" />
            <span>Add Catalog Item</span>
          </button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase font-semibold">
            <tr>
              <th className="p-3">SKU</th>
              <th className="p-3">Model / Description</th>
              <th className="p-3">Type</th>
              <th className="p-3">Manufacturer</th>
              <th className="p-3">Tech</th>
              <th className="p-3">Unit Cost (KES)</th>
              <th className="p-3">Reorder Level</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-slate-500">
                  No catalog items found.
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr key={item.sku} className="hover:bg-slate-850 transition-colors">
                  <td className="p-3 font-mono text-sky-400 font-bold">{item.sku}</td>
                  <td className="p-3">
                    <p className="font-semibold text-slate-100">{item.model}</p>
                    <p className="text-[10px] text-slate-400">{item.description}</p>
                  </td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 bg-slate-950 border border-slate-700 text-slate-300 rounded text-[10px]">
                      {item.asset_type} ({item.tracking_type || 'SERIALIZED'})
                    </span>
                  </td>
                  <td className="p-3">{item.manufacturer || '—'}</td>
                  <td className="p-3">{item.access_tech}</td>
                  <td className="p-3 font-semibold text-emerald-400">
                    KES {item.unit_cost ? item.unit_cost.toLocaleString() : '0'}
                  </td>
                  <td className="p-3 font-semibold text-amber-400">{item.reorder_level}</td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => {
                        setEditingItem(item);
                        setShowModal(true);
                      }}
                      className="p-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
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
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-base text-slate-100 border-b border-slate-800 pb-2">
              {editingItem ? `Edit SKU: ${editingItem.sku}` : 'Add New Item to Catalog'}
            </h3>
            <form onSubmit={handleSave} className="space-y-3 text-xs">
              {!editingItem && (
                <div>
                  <label className="block text-slate-400 mb-1">SKU *</label>
                  <input
                    type="text"
                    required
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    placeholder="e.g. SKU-ONT-HG8145V5"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Item Model *</label>
                  <input
                    type="text"
                    required
                    value={editingItem ? editingItem.model : form.model}
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, model: e.target.value })
                        : setForm({ ...form, model: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Asset Category</label>
                  <select
                    value={editingItem ? editingItem.asset_type : form.asset_type}
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, asset_type: e.target.value })
                        : setForm({ ...form, asset_type: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                  >
                    <option value="ONT">ONT / ONU</option>
                    <option value="RTR">Wireless Router</option>
                    <option value="NET">Enterprise Router</option>
                    <option value="FAT">FAT Box / Splitter</option>
                    <option value="BULK">Bulk Cable / Consumable</option>
                    <option value="NONSER">Non-Serialized Tool</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Manufacturer</label>
                  <input
                    type="text"
                    value={editingItem ? editingItem.manufacturer : form.manufacturer}
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, manufacturer: e.target.value })
                        : setForm({ ...form, manufacturer: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Unit Cost (KES)</label>
                  <input
                    type="number"
                    min="0"
                    value={editingItem ? editingItem.unit_cost : form.unit_cost}
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, unit_cost: parseFloat(e.target.value) || 0 })
                        : setForm({ ...form, unit_cost: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Reorder Level</label>
                  <input
                    type="number"
                    min="0"
                    value={editingItem ? editingItem.reorder_level : form.reorder_level}
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, reorder_level: parseInt(e.target.value) || 0 })
                        : setForm({ ...form, reorder_level: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Tracking Method</label>
                  <select
                    value={editingItem ? editingItem.tracking_type : form.tracking_type}
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, tracking_type: e.target.value })
                        : setForm({ ...form, tracking_type: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                  >
                    <option value="SERIALIZED">SERIALIZED (Track per S/N & MAC)</option>
                    <option value="BULK">BULK (Track by Quantity)</option>
                    <option value="NONSER">NONSER (Non-serialized Counted)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Description / Spec Notes</label>
                <textarea
                  rows={2}
                  value={editingItem ? editingItem.description : form.description}
                  onChange={(e) =>
                    editingItem
                      ? setEditingItem({ ...editingItem, description: e.target.value })
                      : setForm({ ...form, description: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-semibold"
                >
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
