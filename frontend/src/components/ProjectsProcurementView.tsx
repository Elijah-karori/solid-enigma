import React, { useEffect, useState } from 'react';
import { FolderKanban, ShoppingCart } from 'lucide-react';

export const ProjectsProcurementView: React.FC = () => {
  const [projects, setProjects] = useState<any[]>([]);
  const [procurement, setProcurement] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/projects', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
    })
      .then((res) => res.json())
      .then((data) => setProjects(data || []));

    fetch('/api/procurement', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
    })
      .then((res) => res.json())
      .then((data) => setProcurement(data || []));
  }, []);

  return (
    <div className="space-y-6">
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
        <h3 className="font-bold text-xs text-slate-200 flex items-center space-x-2">
          <FolderKanban className="w-4 h-4 text-sky-400" />
          <span>ISP Network Expansion Projects</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {projects.map((p) => (
            <div key={p.project_id} className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
              <div className="flex justify-between font-bold text-slate-100">
                <span>{p.project_name} ({p.project_id})</span>
                <span className="text-sky-400">{p.status}</span>
              </div>
              <p className="text-[10px] text-slate-400">Target Location / FAT: {p.location_fat}</p>
              <div className="flex justify-between text-[11px] pt-2 border-t border-slate-800">
                <span className="text-slate-400">Budget: KES {p.budget}</span>
                <span className="text-emerald-400">Spent: KES {p.actual_spend}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
        <h3 className="font-bold text-xs text-slate-200 flex items-center space-x-2">
          <ShoppingCart className="w-4 h-4 text-purple-400" />
          <span>Procurement & Material Stock In Requisitions</span>
        </h3>
        <div className="bg-slate-950 rounded-lg border border-slate-800 overflow-hidden text-xs">
          <table className="w-full text-left">
            <thead className="bg-slate-900 text-slate-400 uppercase border-b border-slate-800">
              <tr>
                <th className="px-4 py-2">Proc ID</th>
                <th className="px-4 py-2">SKU & Qty</th>
                <th className="px-4 py-2">Est Total (KES)</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {procurement.map((pr) => (
                <tr key={pr.procurement_id}>
                  <td className="px-4 py-2 font-mono text-sky-400">{pr.procurement_id}</td>
                  <td className="px-4 py-2">{pr.item_sku} (x{pr.quantity})</td>
                  <td className="px-4 py-2 font-mono">{pr.est_total}</td>
                  <td className="px-4 py-2 text-purple-400">{pr.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
