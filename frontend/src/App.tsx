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

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [genieACSSerial, setGenieACSSerial] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));

  // Auto login with default migration admin if token missing
  useEffect(() => {
    if (!token) {
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@ont.co.ke', password: 'admin123' }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.token) {
            localStorage.setItem('token', data.token);
            setToken(data.token);
          }
        })
        .catch((err) => console.error(err));
    }
  }, [token]);

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

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} userRole="Admin" />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={getTitle()} />
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
