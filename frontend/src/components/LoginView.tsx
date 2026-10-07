import { LoginSchema, MagicLinkSchema, OTPVerifySchema, ResetPasswordSchema } from "../schemas";
import React, { useEffect, useState } from 'react';
import { Lock, Mail, Server, ShieldCheck, AlertCircle, Loader2, KeyRound, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { apiFetch, setAuthToken, SessionPayload } from '../api';

type Step = 'password' | 'otp' | 'forgot' | 'reset-otp' | 'new-password' | 'done';

interface Props {
  onLoginSuccess: (session: SessionPayload) => void;
}

const input =
  'w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all';

export const LoginView: React.FC<Props> = ({ onLoginSuccess }) => {
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const go = (s: Step, msg?: string) => {
    setStep(s);
    setError(null);
    setInfo(msg || null);
    setCode('');
  };

  const run = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const finish = (s: SessionPayload) => {
    setAuthToken(s.access_token);
    onLoginSuccess(s);
  };

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    const val = LoginSchema.safeParse({ email, password });
    if (!val.success) {
      setError(val.error.errors[0].message);
      return;
    }
    run(async () => {
      const r = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (r.status === 'otp_required') {
        setChallenge(r.challenge_token);
        setCooldown(60);
        go('otp', r.message);
      } else if (r.status === 'password_reset_required') {
        go('reset-otp', r.message);
      } else if (r.access_token) {
        finish(r);
      }
    });
  };

  const submitLoginOtp = (e: React.FormEvent) => {
    e.preventDefault();
    const val = OTPVerifySchema.safeParse({ code });
    if (!val.success) {
      setError(val.error.errors[0].message);
      return;
    }
    run(async () => {
      const r = await apiFetch('/api/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ purpose: 'login', challenge_token: challenge, code }),
      });
      finish(r);
    });
  };

  const submitForgot = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await apiFetch('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      setCooldown(60);
      go('reset-otp', r.message);
    });
  };

  const submitResetOtp = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await apiFetch('/api/auth/otp/verify', { method: 'POST', body: JSON.stringify({ purpose: 'reset', email, code }) });
      setResetToken(r.reset_token);
      go('new-password');
    });
  };

  const submitNewPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw !== newPw2) return setError('Passwords do not match.');
    run(async () => {
      await apiFetch('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ reset_token: resetToken, new_password: newPw }) });
      setPassword('');
      setNewPw('');
      setNewPw2('');
      go('done');
    });
  };

  const resend = () =>
    run(async () => {
      if (step === 'otp') {
        // re-run the password step to get a fresh code + challenge
        const r = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        if (r.challenge_token) setChallenge(r.challenge_token);
      } else {
        await apiFetch('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      }
      setCooldown(60);
      setInfo('A new code was sent.');
    });

  const Field: React.FC<{ icon: React.ReactNode; children: React.ReactNode; label: string }> = ({ icon, children, label }) => (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-slate-300">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-3 text-slate-500">{icon}</span>
        {children}
      </div>
    </div>
  );

  const Submit: React.FC<{ label: string }> = ({ label }) => (
    <button
      type="submit"
      disabled={loading}
      className="w-full py-3 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl shadow-lg shadow-sky-600/30 flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
      <span>{label}</span>
    </button>
  );

  const codeBox = (
    <Field icon={<KeyRound className="w-4 h-4" />} label="6-digit code">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        minLength={6}
        className={`${input} tracking-[0.5em] font-mono text-lg`}
        placeholder="000000"
        autoFocus
      />
    </Field>
  );

  const resendBtn = (
    <button type="button" onClick={resend} disabled={cooldown > 0 || loading} className="text-xs text-sky-400 hover:text-sky-300 disabled:text-slate-600">
      {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
    </button>
  );

  const back = (to: Step) => (
    <button type="button" onClick={() => go(to)} className="text-xs text-slate-400 hover:text-slate-200 inline-flex items-center space-x-1">
      <ArrowLeft className="w-3 h-3" />
      <span>Back</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6 bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 via-indigo-500 to-purple-500" />
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 bg-sky-950 border border-sky-800 rounded-xl text-sky-400">
            <Server className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">ONT Operations Portal</h2>
          <p className="text-xs text-slate-400">
            {step === 'password' && 'Sign in with your email and password'}
            {step === 'otp' && 'Two-step verification'}
            {step === 'forgot' && 'Forgot password / first-time setup'}
            {step === 'reset-otp' && 'Enter the code we emailed you'}
            {step === 'new-password' && 'Choose a new password'}
            {step === 'done' && 'All set'}
          </p>
        </div>

        {error && (
          <div role="alert" className="p-4 bg-rose-950/80 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            <p>{error}</p>
          </div>
        )}
        {info && !error && <div className="p-3 bg-sky-950/60 border border-sky-800 rounded-xl text-xs text-sky-200">{info}</div>}

        {step === 'password' && (
          <form onSubmit={submitPassword} className="space-y-5">
            <Field icon={<Mail className="w-4 h-4" />} label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" className={input} />
            </Field>
            <Field icon={<Lock className="w-4 h-4" />} label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" className={input} />
            </Field>
            <Submit label="Continue" />
            <div className="text-center">
              <button type="button" onClick={() => go('forgot')} className="text-xs text-sky-400 hover:text-sky-300">
                Forgot password? / First time signing in?
              </button>
            </div>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={submitLoginOtp} className="space-y-5">
            {codeBox}
            <Submit label="Verify & sign in" />
            <div className="flex justify-between">
              {back('password')}
              {resendBtn}
            </div>
          </form>
        )}

        {step === 'forgot' && (
          <form onSubmit={submitForgot} className="space-y-5">
            <p className="text-xs text-slate-400">Enter your work email. If it is registered we will send a 6-digit code to set a new password.</p>
            <Field icon={<Mail className="w-4 h-4" />} label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={input} />
            </Field>
            <Submit label="Email me a code" />
            {back('password')}
          </form>
        )}

        {step === 'reset-otp' && (
          <form onSubmit={submitResetOtp} className="space-y-5">
            {codeBox}
            <Submit label="Verify code" />
            <div className="flex justify-between">
              {back('forgot')}
              {resendBtn}
            </div>
          </form>
        )}

        {step === 'new-password' && (
          <form onSubmit={submitNewPassword} className="space-y-5">
            <Field icon={<Lock className="w-4 h-4" />} label="New password (10+ characters, with a letter and a number)">
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required minLength={10} maxLength={72} autoComplete="new-password" className={input} />
            </Field>
            <Field icon={<Lock className="w-4 h-4" />} label="Confirm new password">
              <input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} required minLength={10} maxLength={72} autoComplete="new-password" className={input} />
            </Field>
            <Submit label="Set password" />
          </form>
        )}

        {step === 'done' && (
          <div className="text-center space-y-4">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
            <p className="text-sm text-slate-300">Your password is set. Sign in with it now.</p>
            <button onClick={() => go('password')} className="w-full py-3 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl">
              Go to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
