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
import { apiFetch, getAuthToken, setAuthToken, clearAuthToken } from './api';
import { User } from './types';
import { Loader2 } from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [genieACSSerial, setGenieACSSerial] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(getAuthToken());
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });
  const [authLoading, setAuthLoading] = useState<boolean>(true);

  // Auto login or validate initial auth session
  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      const existingToken = getAuthToken();
      if (existingToken) {
        setToken(existingToken);
        setAuthLoading(false);
        return;
      }

      // If no token exists, attempt automatic login with migration admin credentials
      try {
        const data = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'admin@ont.co.ke', password: 'admin123' }),
        });

        if (isMounted && data.token) {
          setAuthToken(data.token);
          setToken(data.token);
          if (data.user) {
            localStorage.setItem('user', JSON.stringify(data.user));
            setUser(data.user);
          }
        }
      } catch (err) {
        console.warn('Auto-login failed. Prompting user login:', err);
        clearAuthToken();
        if (isMounted) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setAuthLoading(false);
        }
      }
    };

    initAuth();

    const handleUnauthorized = () => {
      clearAuthToken();
      setToken(null);
      setUser(null);
    };

    window.addEventListener('unauthorized-access', handleUnauthorized);
    return () => {
      isMounted = false;
      window.removeEventListener('unauthorized-access', handleUnauthorized);
    };
  }, []);

  const handleLoginSuccess = (newToken: string, loggedInUser: User) => {
    setToken(newToken);
    setUser(loggedInUser);
  };

  const handleLogout = () => {
    clearAuthToken();
    setToken(null);
    setUser(null);
  };

  const getTitle = () => {
    switch (activeTab) {
      case 'dashboard': return 'Operations Dashboard';
      case 'serialized': return 'Serialized Equipment Register';
      case 'customers': return 'Customer & Hotspot Subscriptions';
      case 'topology': return 'FTTH & Wireless Network Topology';
      case 'requisitions': return 'Technician Material Requests';
      case 'tickets-tasks': return 'Customer Support & Device Swaps';
      case 'projects-proc': return 'Projects & Procurement Engine';
      default: return 'ONT Network Portal';
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-10 h-10 text-sky-500 animate-spin" />
        <p className="text-sm font-medium text-slate-400">Authenticating ONT Operations Portal...</p>
      </div>
    );
  }

  if (!token) {
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        userRole={user?.role || 'Admin'}
        userName={user?.name || 'Admin Operator'}
        onLogout={handleLogout}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={getTitle()} userName={user?.name || 'Admin Operator'} />
        <main className="p-6 flex-1 overflow-y-auto">
          {activeTab === 'dashboard' && <DashboardView />}
          {activeTab === 'serialized' && (
            <SerializedInventoryView onOpenGenieACSModal={(s) => setGenieACSSerial(s)} />
          )}
          {activeTab === 'customers' && (
            <CustomersView onOpenGenieACSModal={(s) => setGenieACSSerial(s)} />
          )}
          {activeTab === 'topology' && (
            <NetworkTopologyView onOpenGenieACSModal={(s) => setGenieACSSerial(s)} />
          )}
          {activeTab === 'requisitions' && <RequisitionsView />}
          {activeTab === 'tickets-tasks' && <TicketsTasksView />}
          {activeTab === 'projects-proc' && <ProjectsProcurementView />}
        </main>
      </div>

      {genieACSSerial && (
        <GenieACSRemoteModal
          serialNumber={genieACSSerial}
          onClose={() => setGenieACSSerial(null)}
        />
      )}
    </div>
  );
};

export default App;
