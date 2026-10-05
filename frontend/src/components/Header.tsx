import React from 'react';
import { Search, Bell, QrCode } from 'lucide-react';

interface HeaderProps {
  title: string;
  userName?: string;
  onScanBarcode?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ title, userName, onScanBarcode }) => {
  return (
    <header className="h-16 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center space-x-4">
        <h2 className="text-lg font-bold text-slate-100">{title}</h2>
        <span className="flex items-center space-x-1 px-2.5 py-1 bg-emerald-950 border border-emerald-800 text-emerald-400 text-xs rounded-full">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>GenieACS REST Active</span>
        </span>
      </div>

      <div className="flex items-center space-x-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search S/N, MAC, Account, Plot..."
            className="bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 w-64"
            onKeyDown={(e) => { if (e.key === 'Enter' && onScanBarcode) onScanBarcode(); }}
          />
        </div>

        {onScanBarcode && (
          <button
            onClick={onScanBarcode}
            title="Barcode / QR Lookup"
            className="p-2 text-slate-400 hover:text-sky-400 bg-slate-950 rounded-lg border border-slate-800 transition-colors"
          >
            <QrCode className="w-4 h-4" />
          </button>
        )}

        <button className="p-2 text-slate-400 hover:text-slate-200 bg-slate-950 rounded-lg border border-slate-800">
          <Bell className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
