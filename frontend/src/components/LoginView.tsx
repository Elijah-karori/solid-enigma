import React, { useState } from 'react';
import { Lock, Mail, Server, ShieldCheck, AlertCircle, Loader2, KeyRound, CheckCircle2, ArrowLeft } from 'lucide-react';
import { apiFetch, setAuthToken } from '../api';
import { User } from '../types';

interface LoginViewProps {
  onLoginSuccess: (token: string, user: User) => void;
}

type AuthMode = 'login' | 'forgot' | 'otp';

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('admin@ont.co.ke');
  const [password, setPassword] = useState('admin123');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      if (mode === 'login') {
        const data = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });

        if (data.token) {
          setAuthToken(data.token);
          if (data.user) {
            localStorage.setItem('user', JSON.stringify(data.user));
          }
          onLoginSuccess(data.token, data.user);
        } else {
          throw new Error('Invalid server authentication response');
        }
      } else if (mode === 'forgot') {
        const data = await apiFetch('/api/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email }),
        });
        setSuccessMsg(data.message || 'OTP reset code has been sent to your email.');
        setMode('otp');
      } else if (mode === 'otp') {
        const data = await apiFetch('/api/auth/verify-otp', {
          method: 'POST',
          body: JSON.stringify({ email, otp: otpCode }),
        });

        if (data.token) {
          setAuthToken(data.token);
          if (data.user) {
            localStorage.setItem('user', JSON.stringify(data.user));
          }
          onLoginSuccess(data.token, data.user);
        } else {
          setSuccessMsg('OTP verified successfully. Please set your new password.');
          setMode('login');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Authentication operation failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8 bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 via-indigo-500 to-purple-500" />

        <div className="text-center space-y-2">
          <div className="inline-flex p-3 bg-sky-950 border border-sky-800 rounded-xl text-sky-400 mb-2">
            <Server className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">ONT Operations Portal</h2>
          <p className="text-xs text-slate-400">ISP Asset Register, Requisitions & TR-069 ACS Manager</p>
        </div>

        {error && (
          <div className="p-4 bg-rose-950/80 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Authentication Error</p>
              <p className="mt-0.5 text-rose-300/90">{error}</p>
            </div>
          </div>
        )}

        {successMsg && (
          <div className="p-4 bg-emerald-950/80 border border-emerald-800 rounded-xl text-xs text-emerald-300 flex items-start space-x-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Success</p>
              <p className="mt-0.5 text-emerald-300/90">{successMsg}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">Operator Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={mode === 'otp'}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all disabled:opacity-50"
                placeholder="admin@ont.co.ke"
              />
            </div>
          </div>

          {mode === 'login' && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>
          )}

          {mode === 'otp' && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">One-Time Password (OTP)</label>
              <div className="relative">
                <KeyRound className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                <input
                  type="text"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  required
                  maxLength={6}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-200 tracking-widest font-mono placeholder-slate-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all"
                  placeholder="123456"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Enter the 6-digit OTP sent to your registered email.</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-semibold rounded-xl shadow-lg shadow-sky-600/30 flex items-center justify-center space-x-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>
                  {mode === 'login' && 'Sign In to Portal'}
                  {mode === 'forgot' && 'Send Reset OTP'}
                  {mode === 'otp' && 'Verify OTP & Login'}
                </span>
              </>
            )}
          </button>
        </form>

        <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs">
          {mode === 'login' ? (
            <>
              <button
                type="button"
                onClick={() => { setMode('forgot'); setError(null); setSuccessMsg(null); }}
                className="text-sky-400 hover:text-sky-300 transition-colors"
              >
                Forgot Password?
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmail('admin@ont.co.ke');
                  setPassword('admin123');
                }}
                className="text-slate-400 hover:text-slate-300 transition-colors"
              >
                Use Default Admin
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => { setMode('login'); setError(null); setSuccessMsg(null); }}
              className="text-sky-400 hover:text-sky-300 flex items-center space-x-1 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Sign In</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
