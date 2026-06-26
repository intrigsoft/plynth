import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionUser } from '@plynth/shared';

export const DEMO_USERS: SessionUser[] = [
  { name: 'Sarah Chen', email: 'sarah@northwind.io', initials: 'SC', color: 'linear-gradient(135deg,#3a5bff,#7e93ff)' },
  { name: 'Mark Rivera', email: 'mark@northwind.io', initials: 'MR', color: '#0e9488' },
  { name: 'Lena Ortiz', email: 'lena@northwind.io', initials: 'LO', color: '#b45309' },
];

const KEY = 'plynth.session';

function load(): SessionUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

interface AuthCtx {
  session: SessionUser | null;
  /** Returns an error string, or null on success. */
  login: (email: string, password: string) => string | null;
  loginAs: (u: SessionUser) => void;
  signOut: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionUser | null>(load);

  const start = useCallback((u: SessionUser) => {
    localStorage.setItem(KEY, JSON.stringify(u));
    setSession(u);
  }, []);

  const login = useCallback(
    (email: string, password: string): string | null => {
      const e = email.trim().toLowerCase();
      if (!e) return 'Enter your email address.';
      const u = DEMO_USERS.find((x) => x.email.toLowerCase() === e);
      if (!u) return 'No account for that email — try a demo account below.';
      if (!password) return 'Enter your password.';
      start(u);
      return null;
    },
    [start],
  );

  const signOut = useCallback(() => {
    localStorage.removeItem(KEY);
    setSession(null);
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({ session, login, loginAs: start, signOut }),
    [session, login, start, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

export function firstName(u: SessionUser): string {
  return u.name.split(' ')[0];
}
