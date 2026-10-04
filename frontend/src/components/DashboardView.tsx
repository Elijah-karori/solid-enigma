import React, { useEffect, useState } from 'react';
import { Boxes, Users, ClipboardList, TicketCheck, FolderKanban, Activity } from 'lucide-react';

export const DashboardView: React.FC = () => {
  const [stats, setStats] = useState({
    total_serialized: 0,
    in_stock: 0,
    issued: 0,
    pending_requisitions: 0,
    open_tickets: 0,
    active_projects: 0,
  });

  useEffect(() => {
    fetch('/api/dashboard', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
    })
      .then((res) => res.json())
      .then((data) => setStats(data))
      .catch((err) => console.error(err));
  }, []);

  const cards = [
    { title: 'Total Serialized Inventory', value: stats.total_serialized, icon: Boxes, color: 'text-sky-400', bg: 'bg-sky-950/50' },
    { title: 'Units In Stock', value: stats.in_stock, icon: Activity, color: 'text-emerald-400', bg: 'bg-emerald-950/50' },
    { title: 'Units Issued / Out', value: stats.issued, icon: Users, color: 'text-amber-400', bg: 'bg-amber-950/50' },
    { title: 'Pending Requisitions', value: stats.pending_requisitions, icon: ClipboardList, color: 'text-purple-400', bg: 'bg-purple-950/50' },
    { title: 'Open Tickets', value: stats.open_tickets, icon: TicketCheck, color: 'text-rose-400', bg: 'bg-rose-950/50' },
    { title: 'Active Projects', value: stats.active_projects, icon: FolderKanban, color: 'text-indigo-400', bg: 'bg-indigo-950/50' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {cards.map((c, i) => {
          const Icon = c.icon;
          return (
            <div key={i} className={`p-5 rounded-xl border border-slate-800 ${c.bg} flex items-center justify-between`}>
              <div>
                <p className="text-xs font-medium text-slate-400">{c.title}</p>
                <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
              </div>
              <div className={`p-3 rounded-lg ${c.bg} border border-slate-700/50`}>
                <Icon className={`w-6 h-6 ${c.color}`} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl">
          <h3 className="font-bold text-sm text-slate-200 mb-4">Quick Operations Overview</h3>
          <div className="space-y-3 text-xs text-slate-300">
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex justify-between items-center">
              <span>Stock In Serialized Items (S/N, MAC, Condition)</span>
              <span className="px-2 py-0.5 bg-emerald-950 text-emerald-400 rounded">Ready</span>
            </div>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex justify-between items-center">
              <span>Customer PPPoE & Hotspot Network Mapping</span>
              <span className="px-2 py-0.5 bg-sky-950 text-sky-400 rounded">Ready</span>
            </div>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex justify-between items-center">
              <span>GenieACS TR-069 Optical RX/TX Monitoring</span>
              <span className="px-2 py-0.5 bg-purple-950 text-purple-400 rounded">Connected</span>
            </div>
          </div>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl">
          <h3 className="font-bold text-sm text-slate-200 mb-4">System Status & Integrations</h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1.5 border-b border-slate-800">
              <span className="text-slate-400">PostgreSQL Database:</span>
              <span className="text-emerald-400 font-medium">Connected</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-800">
              <span className="text-slate-400">GenieACS TR-069 Server:</span>
              <span className="text-emerald-400 font-medium">Synced</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-800">
              <span className="text-slate-400">FreeRADIUS BSS Sync:</span>
              <span className="text-sky-400 font-medium">Active</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
