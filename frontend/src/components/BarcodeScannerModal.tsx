import React, { useState } from 'react';
import { QrCode, Search, X, CheckCircle, AlertCircle } from 'lucide-react';
import { apiFetch } from '../api';

interface BarcodeScannerModalProps {
  onClose: () => void;
  onSelectResult?: (result: any) => void;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({ onClose, onSelectResult }) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await apiFetch(`/api/lookup?q=${encodeURIComponent(query.trim())}`);
      setResult(data);
      if (onSelectResult) {
        onSelectResult(data);
      }
    } catch (err: any) {
      setError(err.message || 'No item or unit found');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 border-b border-slate-800 pb-3">
          <div className="p-2 bg-emerald-950 border border-emerald-800 rounded-lg text-emerald-400">
            <QrCode className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-base text-slate-100">Universal Barcode / QR Lookup</h3>
            <p className="text-xs text-slate-400">Scan or search by Serial Number, MAC, Asset ID or SKU</p>
          </div>
        </div>

        <form onSubmit={handleLookup} className="space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
            <input
              type="text"
              required
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter S/N, MAC address, Asset ID, or SKU..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs shadow-md transition-all disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search / Process Scanner Input'}
          </button>
        </form>

        {error && (
          <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-lg text-xs text-rose-300 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs space-y-2">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <span className="font-bold text-emerald-400 uppercase">{result.kind} FOUND</span>
              <span className="px-2 py-0.5 bg-slate-900 border border-slate-700 text-slate-300 rounded font-semibold">
                {result.status || 'Active'}
              </span>
            </div>
            {result.kind === 'unit' ? (
              <div className="space-y-1 text-slate-300">
                <p>
                  Asset ID: <span className="font-mono text-sky-400 font-bold">{result.id}</span>
                </p>
                <p>
                  Model: <span className="font-semibold text-slate-100">{result.model}</span> (SKU: {result.sku})
                </p>
                <p>
                  S/N: <span className="font-mono text-amber-400">{result.sn || 'N/A'}</span>
                </p>
                <p>
                  MAC: <span className="font-mono text-amber-400">{result.mac || 'N/A'}</span>
                </p>
                <p>
                  Location: <span className="text-slate-100">{result.location || 'Main Store'}</span>
                </p>
              </div>
            ) : (
              <div className="space-y-1 text-slate-300">
                <p>
                  SKU: <span className="font-mono text-sky-400 font-bold">{result.sku}</span>
                </p>
                <p>
                  Model: <span className="font-semibold text-slate-100">{result.model}</span>
                </p>
                <p>
                  Tracking: <span className="font-semibold text-slate-100">{result.tracking}</span>
                </p>
                <p>
                  Available Net Quantity:{' '}
                  <span className="font-bold text-emerald-400">{result.net}</span>
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
