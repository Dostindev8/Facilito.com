'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  authRequest,
  logoutRequest,
  onSessionChange,
  refreshSession,
  switchTenantRequest,
  type Role,
  type SessionUser,
} from './api';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: SessionUser | null;
  login: (input: { email: string; password: string; recordarme: boolean; totp?: string }) => Promise<SessionUser>;
  /** Accounts are created by an admin after payment; the owner sets the password through a single-use invitation. */
  acceptInvitation: (input: { token: string; password: string; recordarme: boolean }) => Promise<SessionUser>;
  logout: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  can: (roles: readonly Role[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    const off = onSessionChange((u) => {
      setUser(u);
      setStatus(u ? 'authenticated' : 'anonymous');
    });
    refreshSession().catch(() => setStatus('anonymous'));
    return () => {
      off();
    };
  }, []);

  const login = useCallback<AuthContextValue['login']>((input) => authRequest('login', input), []);
  const acceptInvitation = useCallback<AuthContextValue['acceptInvitation']>((input) => authRequest('invitations/accept', input), []);
  const logout = useCallback(() => logoutRequest(), []);
  const switchTenant = useCallback(async (tenantId: string) => {
    await switchTenantRequest(tenantId);
  }, []);
  const can = useCallback((roles: readonly Role[]) => !!user && roles.includes(user.rol), [user]);

  const value = useMemo(
    () => ({ status, user, login, acceptInvitation, logout, switchTenant, can }),
    [status, user, login, acceptInvitation, logout, switchTenant, can],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Where a fresh session lands: platform admins go to the panel, everyone else to their business. */
export function homeFor(user: Pick<SessionUser, 'platformAdmin'>): string {
  return user.platformAdmin ? '/admin' : '/inicio';
}

export const ROLES = {
  inventoryWrite: ['owner', 'manager', 'warehouse'] as const,
  sell: ['owner', 'manager', 'cashier'] as const,
  void: ['owner', 'manager'] as const,
  admin: ['owner', 'manager'] as const,
  owner: ['owner'] as const,
  reports: ['owner', 'manager', 'accountant'] as const,
  customers: ['owner', 'manager', 'cashier'] as const,
  suppliers: ['owner', 'manager', 'warehouse'] as const,
};
