import React, { createContext, useContext } from 'react';
import { User } from './types';

interface AuthState {
  user: User;
  permissions: Record<string, boolean>;
  /** True when the signed-in role holds ANY of the listed permissions. */
  can: (...perms: string[]) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export const AuthProvider: React.FC<{ user: User; permissions: Record<string, boolean>; children: React.ReactNode }> = ({
  user,
  permissions,
  children,
}) => {
  const can = (...perms: string[]) => perms.some((p) => permissions[p] === true);
  return <Ctx.Provider value={{ user, permissions, can }}>{children}</Ctx.Provider>;
};

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
