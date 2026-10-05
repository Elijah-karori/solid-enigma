import React from 'react';
import {
  LayoutDashboard,
  Boxes,
  Users,
  Network,
  ClipboardList,
  TicketCheck,
  FolderKanban,
  BookOpen,
  ArrowRightLeft,
  PackagePlus,
  FileText,
  ShieldCheck,
  UserCog,
  Settings2,
  LogOut,
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userRole: string;
  userName?: string;
  onLogout?: () => void;
}

const isAdmin = (role: string) =>
  ['Admin', 'Store Manager'].includes(role);

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, userRole, userName = 'Admin Operator', onLogout }) => {
  const coreItems = [
    { id: 'dashboard',      label: 'Dashboard',              icon: LayoutDashboard },
    { id: 'catalog',        label: 'Item Catalog',           icon: BookOpen },
    { id: 'serialized',     label: 'Serialized Inventory',   icon: Boxes },
    { id: 'movement',       label: 'Stock Movements',        icon: ArrowRightLeft },
    { id: 'stockin',        label: 'Batch Stock-In',         icon: PackagePlus },
  ];

  const workflowItems = [
    { id: 'customers',      label: 'Customers & Hotspots',   icon: Users },
    { id: 'topology',       label: 'Network Topology & GIS', icon: Network },
    { id: 'requisitions',   label: 'Material Requisitions',  icon: ClipboardList },
    { id: 'tickets-tasks',  label: 'Tickets & Tasks',        icon: TicketCheck },
    { id: 'projects-proc',  label: 'Projects & Procurement', icon: FolderKanban },
    { id: 'docs',           label: 'Delivery Notes',         icon: FileText },
  ];

  const adminItems = [
    { id: 'audit',    label: 'Audit Ledger',    icon: ShieldCheck,  adminOnly: false },
    { id: 'users',    label: 'User Admin',      icon: UserCog,      adminOnly: true  },
    { id: 'settings', label: 'Settings',        icon: Settings2,    adminOnly: true  },
  ];

  const NavItem = ({ id, label, icon: Icon }: { id: string; label: string; icon: React.ElementType }) => {
    const isActive = activeTab === id;
    return (
      <button
        key={id}
        onClick={() => setActiveTab(id)}
        className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/30'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
        }`}
      >
        <Icon className="w-5 h-5" />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col justify-between min-h-screen overflow-y-auto">
      <div>
        <div className="p-5 border-b border-slate-800 flex items-center space-x-3">
          <div className="p-2 bg-sky-600 rounded-lg text-white font-bold text-xl">ONT</div>
          <div>
            <h1 className="font-bold text-slate-100 text-sm">ONT Inventory Portal</h1>
            <p className="text-xs text-sky-400 font-medium">ISP ERP & TR-069 OSS</p>
          </div>
        </div>

        <nav className="p-4 space-y-1">
          <p className="text-[10px] uppercase tracking-widest text-slate-600 px-3 pt-1 pb-1">Inventory</p>
          {coreItems.map((item) => <NavItem key={item.id} {...item} />)}

          <p className="text-[10px] uppercase tracking-widest text-slate-600 px-3 pt-3 pb-1">Workflow</p>
          {workflowItems.map((item) => <NavItem key={item.id} {...item} />)}

          <p className="text-[10px] uppercase tracking-widest text-slate-600 px-3 pt-3 pb-1">Admin</p>
          {adminItems
            .filter((item) => !item.adminOnly || isAdmin(userRole))
            .map((item) => <NavItem key={item.id} {...item} />)}
        </nav>
      </div>

      <div className="p-4 border-t border-slate-800 space-y-3">
        <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 text-xs">
          <p className="text-slate-400">Logged in as:</p>
          <p className="font-bold text-slate-200 mt-0.5">{userName}</p>
          <span className="inline-block px-2 py-0.5 bg-sky-950 text-sky-400 rounded border border-sky-800 mt-2 text-[10px]">
            {userRole}
          </span>
        </div>

        {onLogout && (
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-slate-900 hover:bg-rose-950/50 hover:text-rose-400 border border-slate-800 rounded-lg text-xs font-medium text-slate-400 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        )}
      </div>
    </aside>
  );
};
