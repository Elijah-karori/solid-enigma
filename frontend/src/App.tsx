import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { SerializedInventoryView } from './components/SerializedInventoryView';
import { CustomersView } from './components/CustomersView';
import { NetworkTopologyView } from './components/NetworkTopologyView';
import { RequisitionsView } from './components/RequisitionsView';
import { TicketsTasksView } from './components/TicketsTasksView';
import { ProjectsProcurementView } from './components/ProjectsProcurementView';
import { GenieACSRemoteModal } from './components/GenieACSRemoteModal';
import { LoginView } from './components/LoginView';
import { UsersView } from './components/UsersView';
import { AuditView, NotificationsView } from './components/SecurityViews';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { apiFetch, clearAuthToken, refreshSession, SessionPayload } from './api';
import { AuthProvider, useAuth } from './auth';
import { Loader2, ShieldOff } from 'lucide-react';

const TITLES: Record<string, string> = {
  dashboard: 'Operations Dashboard',
  serialized: 'Serialized Equipment Register',
  customers: 'Customer & Hotspot Subscriptions',
  topology: 'FTTH & Wireless Network Topology',
  requisitions: 'Technician Material Requests',
  'tickets-tasks': 'Customer Support & Device Swaps',
  'projects-proc': 'Projects & Procurement Engine',
  users: 'Users & Access Control',
  audit: 'Audit Trail',
  notifications: 'Email Notification Log',
};

// Which permission(s) each view needs. Mirrors the sidebar and the server's route guards.
const VIEW_PERMS: Record<string, string[]> = {
  dashboard: ['viewDashboard'],
  serialized: ['manageDevices', 'moveStock'],
  customers: ['viewNetwork'],
  topology: ['viewNetwork'],
  requisitions: ['requestMaterial', 'viewAllReqs', 'approveReq', 'approveFinance'],
  'tickets-tasks': ['viewDashboard'],
  'projects-proc': ['viewProcurement', 'manageProjects'],
  users: ['manageUsers'],
  audit: ['viewAuditAll'],
  notifications: ['viewNotifications'],
};

const Shell: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const { user, can } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [genieACSSerial, setGenieACSSerial] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);

  const allowed = can(...(VIEW_PERMS[activeTab] || []));
  const open = (s: string | null) => s && setGenieACSSerial(s);

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} userRole={user.role} userName={user.name} onLogout={onLogout} onChangePassword={() => setShowPw(true)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={TITLES[activeTab] || 'ONT Network Portal'} userName={user.name} />
        <main className="p-6 flex-1 overflow-y-auto">
          {!allowed ? (
            <div className="flex flex-col items-center justify-center text-slate-400 py-24 space-y-2">
              <ShieldOff className="w-8 h-8" />
              <p className="text-sm">Your role ({user.role}) does not have access to this view.</p>
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && <DashboardView />}
              {activeTab === 'serialized' && <SerializedInventoryView onOpenGenieACSModal={open} />}
              {activeTab === 'customers' && <CustomersView onOpenGenieACSModal={open} />}
              {activeTab === 'topology' && <NetworkTopologyView onOpenGenieACSModal={open} />}
              {activeTab === 'requisitions' && <RequisitionsView />}
              {activeTab === 'tickets-tasks' && <TicketsTasksView />}
              {activeTab === 'projects-proc' && <ProjectsProcurementView />}
              {activeTab === 'users' && <UsersView />}
              {activeTab === 'audit' && <AuditView />}
              {activeTab === 'notifications' && <NotificationsView />}
            </>
          )}
        </main>
      </div>
      {genieACSSerial && <GenieACSRemoteModal serialNumber={genieACSSerial} onClose={() => setGenieACSSerial(null)} />}
      {showPw && <ChangePasswordModal onClose={() => setShowPw(false)} />}
    </div>
  );
};

export const App: React.FC = () => {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [booting, setBooting] = useState(true);

  // On load, try to restore the session from the httpOnly refresh cookie. No auto-login, no default credentials.
  useEffect(() => {
    let alive = true;
    clearAuthToken(); // drop anything the old build left in localStorage
    refreshSession().then((s) => {
      if (alive) {
        setSession(s);
        setBooting(false);
      }
    });
    const onUnauthorized = () => setSession(null);
    window.addEventListener('unauthorized-access', onUnauthorized);
    return () => {
      alive = false;
      window.removeEventListener('unauthorized-access', onUnauthorized);
    };
  }, []);

  const logout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* the local sign-out below happens regardless */
    }
    clearAuthToken();
    setSession(null);
  };

  if (booting) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-10 h-10 text-sky-500 animate-spin" />
        <p className="text-sm text-slate-400">Loading ONT Operations Portal...</p>
      </div>
    );
  }
  if (!session) return <LoginView onLoginSuccess={setSession} />;
  return (
    <AuthProvider user={session.user} permissions={session.permissions}>
      <Shell onLogout={logout} />
    </AuthProvider>
  );
};

export default App;
