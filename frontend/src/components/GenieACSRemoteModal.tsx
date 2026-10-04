import React, { useEffect, useState } from 'react';
import { GenieACSDevice } from '../types';
import { X, RefreshCw, RotateCcw, AlertTriangle, Radio, Wifi, ShieldAlert } from 'lucide-react';
import { apiFetch } from '../api';

interface Props {
  serialNumber: string;
  onClose: () => void;
}

export const GenieACSRemoteModal: React.FC<Props> = ({ serialNumber, onClose }) => {
  const [device, setDevice] = useState<GenieACSDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchDevice = () => {
    setLoading(true);
    apiFetch(`/api/genieacs/device/${serialNumber}`)
      .then((data) => {
        setDevice(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchDevice();
  }, [serialNumber]);

  const handleAction = (action: string, reason: string) => {
    setActionMessage(`Executing ${action}...`);
    apiFetch(`/api/genieacs/device/${serialNumber}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, reason }),
    })
      .then((res) => {
        setActionMessage(res.message || 'Action executed successfully');
        fetchDevice();
      })
      .catch((err) => {
        setActionMessage(`Error: ${err.message}`);
      });
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl space-y-4">
        {/* Header */}
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <Radio className="w-5 h-5 text-purple-400 animate-pulse" />
            <div>
              <h3 className="font-bold text-slate-100 text-sm">TR-069 GenieACS Remote Management</h3>
              <p className="text-[10px] text-slate-400 font-mono">S/N: {serialNumber}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading GenieACS TR-069 operational snapshot...</div>
        ) : device ? (
          <div className="p-6 space-y-5 text-xs">
            {actionMessage && (
              <div className="p-3 bg-purple-950 border border-purple-800 text-purple-300 rounded-lg font-bold">
                {actionMessage}
              </div>
            )}

            {/* Status Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <p className="text-slate-400 text-[10px]">Online Status</p>
                <span className="inline-block mt-1 font-bold text-emerald-400">
                  {device.online_status}
                </span>
              </div>
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <p className="text-slate-400 text-[10px]">Optical RX Power</p>
                <p className={`font-bold mt-1 ${device.optical_rx_power < -25 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {device.optical_rx_power} dBm
                </p>
              </div>
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <p className="text-slate-400 text-[10px]">Optical TX Power</p>
                <p className="font-bold text-sky-400 mt-1">{device.optical_tx_power} dBm</p>
              </div>
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <p className="text-slate-400 text-[10px]">WAN IP Address</p>
                <p className="font-mono font-bold text-slate-200 mt-1">{device.ip_address}</p>
              </div>
            </div>

            {/* Details */}
            <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-2 font-mono text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-400">Manufacturer / Model:</span>
                <span className="text-slate-200">{device.manufacturer} {device.product_class}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Firmware Version:</span>
                <span className="text-slate-200">{device.firmware_version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Wi-Fi SSID / Status:</span>
                <span className="text-sky-400">{device.wifi_ssid} ({device.wifi_status})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">MAC Address:</span>
                <span className="text-slate-200">{device.mac}</span>
              </div>
            </div>

            {/* CWMP Parameter Preview */}
            <div>
              <p className="font-bold text-slate-300 mb-1 text-[11px]">Raw CWMP Tree Snapshot:</p>
              <pre className="p-3 bg-slate-950 border border-slate-800 rounded text-[10px] text-slate-400 overflow-x-auto">
                {device.raw_cwmp_params}
              </pre>
            </div>

            {/* Remote Actions */}
            <div className="border-t border-slate-800 pt-4 flex flex-wrap gap-2 justify-end">
              <button
                onClick={() => handleAction('Sync', 'On-demand sync')}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-bold inline-flex items-center space-x-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh Parameters</span>
              </button>
              <button
                onClick={() => handleAction('Reboot', 'Troubleshooting reboot')}
                className="px-3 py-1.5 bg-purple-900 hover:bg-purple-800 text-white rounded font-bold inline-flex items-center space-x-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reboot ONT</span>
              </button>
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to trigger a Factory Reset on this ONT?')) {
                    handleAction('FactoryReset', 'Admin requested reset');
                  }
                }}
                className="px-3 py-1.5 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded font-bold inline-flex items-center space-x-1"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Factory Reset</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 text-xs text-slate-400">Unable to retrieve GenieACS data.</div>
        )}
      </div>
    </div>
  );
};
