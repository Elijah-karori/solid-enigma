import React from 'react';
import {
  LayoutDashboard,
  Boxes,
  Users,
  Network,
  ClipboardList,
  TicketCheck,
  FolderKanban,
  History,
  ShieldAlert,
  LogOut,
  UsersRound,
  ScrollText,
  Mail,
  KeyRound
} from 'lucide-react';
import { useAuth } from '../auth';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userRole: string;
  userName?: string;
  onLogout?: () => void;
  onChangePassword?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, userRole, userName = 'Admin Operator', onLogout, onChangePassword }) => {
  const { can } = useAuth();
  // Each entry lists the permissions that unlock it (any one is enough). The server enforces the same rules.
  const allItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, perms: ['viewDashboard'] },
    { id: 'serialized', label: 'Serialized Inventory', icon: Boxes, perms: ['manageDevices', 'moveStock'] },
    { id: 'customers', label: 'Customers & Hotspots', icon: Users, perms: ['viewNetwork'] },
    { id: 'topology', label: 'Network Topology & GIS', icon: Network, perms: ['viewNetwork'] },
    { id: 'requisitions', label: 'Material Requisitions', icon: ClipboardList, perms: ['requestMaterial', 'viewAllReqs', 'approveReq', 'approveFinance'] },
    { id: 'tickets-tasks', label: 'Tickets & Tasks', icon: TicketCheck, perms: ['viewDashboard'] },
    { id: 'projects-proc', label: 'Projects & Procurement', icon: FolderKanban, perms: ['viewProcurement', 'manageProjects'] },
    { id: 'users', label: 'Users & Access', icon: UsersRound, perms: ['manageUsers'] },
    { id: 'audit', label: 'Audit Trail', icon: ScrollText, perms: ['viewAuditAll'] },
    { id: 'notifications', label: 'Email Log', icon: Mail, perms: ['viewNotifications'] },
  ];
  const menuItems = allItems.filter((i) => can(...i.perms));

  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col justify-between min-h-screen">
      <div>
        <div className="p-5 border-b border-slate-800 flex items-center space-x-3">
          <div className="p-2 bg-sky-600 rounded-lg text-white font-bold text-xl">ONT</div>
          <div>
            <h1 className="font-bold text-slate-100 text-sm">ONT Inventory Portal</h1>
            <p className="text-xs text-sky-400 font-medium">ISP ERP & TR-069 OSS</p>
          </div>
        </div>

        <nav className="p-4 space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
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

        {onChangePassword && (
          <button
            onClick={onChangePassword}
            className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-medium text-slate-400 transition-colors"
          >
            <KeyRound className="w-4 h-4" />
            <span>Change password</span>
          </button>
        )}

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
