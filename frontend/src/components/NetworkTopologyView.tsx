import React, { useEffect, useState } from 'react';
import { OLT, Splitter, Enclosure, AccessPoint, Customer } from '../types';
import { Network, GitCommit, Layers, Cpu, ArrowRight, UserCheck } from 'lucide-react';

interface Props {
  onOpenGenieACSModal: (serial: string) => void;
}

export const NetworkTopologyView: React.FC<Props> = ({ onOpenGenieACSModal }) => {
  const [viewMode, setViewMode] = useState<'physical' | 'customer_path'>('physical');
  const [topology, setTopology] = useState<{
    olts: OLT[];
    splitters: Splitter[];
    enclosures: Enclosure[];
    aps: AccessPoint[];
    customers: Customer[];
  }>({ olts: [], splitters: [], enclosures: [], aps: [], customers: [] });

  const [selectedAccount, setSelectedAccount] = useState<string>('');

  useEffect(() => {
    fetch('/api/topology', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
    })
      .then((res) => res.json())
      .then((data) => {
        setTopology(data);
        if (data.customers && data.customers.length > 0) {
          setSelectedAccount(data.customers[0].account_number);
        }
      });
  }, []);

  const selectedCust = topology.customers.find((c) => c.account_number === selectedAccount);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="flex space-x-2">
          <button
            onClick={() => setViewMode('physical')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              viewMode === 'physical' ? 'bg-sky-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Physical Fiber Hierarchy</span>
          </button>
          <button
            onClick={() => setViewMode('customer_path')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              viewMode === 'customer_path' ? 'bg-sky-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-slate-200'
            }`}
          >
            <GitCommit className="w-4 h-4" />
            <span>Customer Path Tracer</span>
          </button>
        </div>
      </div>

      {viewMode === 'physical' && (
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-6">
          <h3 className="font-bold text-sm text-slate-200 flex items-center space-x-2">
            <Network className="w-4 h-4 text-sky-400" />
            <span>End-to-End FTTH Network Architecture (OLT → PON → Splitter → FAT → ONU)</span>
          </h3>

          <div className="space-y-4">
            {topology.olts.length > 0 ? (
              topology.olts.map((olt) => (
                <div key={olt.id} className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                    <div className="flex items-center space-x-2">
                      <div className="p-1.5 bg-sky-950 text-sky-400 rounded">
                        <Cpu className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="font-bold text-slate-100 text-xs">{olt.name} ({olt.id})</span>
                        <p className="text-[10px] text-slate-400">{olt.ip_address} • {olt.vendor} {olt.model}</p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] rounded font-bold">
                      {olt.status}
                    </span>
                  </div>

                  <div className="pl-6 border-l-2 border-slate-800 space-y-3 pt-2">
                    {topology.splitters.map((spl) => (
                      <div key={spl.id} className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg space-y-2">
                        <div className="flex justify-between text-xs">
                          <span className="font-bold text-amber-400">Splitter: {spl.id} ({spl.ratio})</span>
                          <span className="text-slate-400 text-[10px]">Location: {spl.location}</span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-4 border-l border-slate-700">
                          {topology.enclosures.map((fat) => (
                            <div key={fat.id} className="p-2.5 bg-slate-950 rounded border border-slate-800 space-y-1 text-xs">
                              <div className="flex justify-between">
                                <span className="font-bold text-sky-300">FAT / Enclosure: {fat.id}</span>
                                <span className="text-slate-400 text-[10px]">{fat.capacity_ports} Ports</span>
                              </div>
                              <p className="text-[10px] text-slate-400">Plot: {fat.location_plot}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-400">
                Default OLT & PON Port mapped in system database.
              </div>
            )}
          </div>
        </div>
      )}

      {viewMode === 'customer_path' && (
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-6">
          <div className="flex items-center space-x-3">
            <label className="text-xs font-bold text-slate-300">Select Customer Account:</label>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-slate-200"
            >
              {topology.customers.map((c) => (
                <option key={c.id} value={c.account_number}>
                  {c.name} ({c.account_number}) - {c.plot_number}
                </option>
              ))}
            </select>
          </div>

          {selectedCust ? (
            <div className="p-6 bg-slate-950 border border-slate-800 rounded-xl space-y-6">
              <h4 className="font-bold text-slate-200 text-sm">Customer Optical Link Path Mapping</h4>

              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg text-center w-full md:w-48">
                  <UserCheck className="w-6 h-6 text-sky-400 mx-auto mb-1" />
                  <p className="font-bold text-xs text-slate-100">{selectedCust.name}</p>
                  <p className="text-[10px] text-slate-400">{selectedCust.plot_number}</p>
                </div>

                <ArrowRight className="w-5 h-5 text-slate-500 hidden md:block" />

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg text-center w-full md:w-48">
                  <Cpu className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
                  <p className="font-bold text-xs text-slate-100">ONT Serial</p>
                  <p className="text-[10px] font-mono text-emerald-400">{selectedCust.assigned_onu_serial || 'N/A'}</p>
                  {selectedCust.assigned_onu_serial && (
                    <button
                      onClick={() => onOpenGenieACSModal(selectedCust.assigned_onu_serial)}
                      className="mt-2 text-[10px] px-2 py-0.5 bg-purple-950 text-purple-300 rounded border border-purple-800"
                    >
                      GenieACS Live
                    </button>
                  )}
                </div>

                <ArrowRight className="w-5 h-5 text-slate-500 hidden md:block" />

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg text-center w-full md:w-48">
                  <Layers className="w-6 h-6 text-amber-400 mx-auto mb-1" />
                  <p className="font-bold text-xs text-slate-100">Enclosure / Splitter</p>
                  <p className="text-[10px] text-slate-400">{selectedCust.linked_enclosure_id || 'FAT-01'} / {selectedCust.linked_splitter_id || 'SPL-1:8'}</p>
                </div>

                <ArrowRight className="w-5 h-5 text-slate-500 hidden md:block" />

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg text-center w-full md:w-48">
                  <Network className="w-6 h-6 text-purple-400 mx-auto mb-1" />
                  <p className="font-bold text-xs text-slate-100">Core OLT PON Port</p>
                  <p className="text-[10px] text-slate-400">OLT-01/PON-1</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">Please select a customer to trace their network path.</p>
          )}
        </div>
      )}
    </div>
  );
};
