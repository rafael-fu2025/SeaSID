import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearAuthToken, setAuthToken } from '@/api';

const AuthContext = createContext(null);
const IS_TEST = import.meta.env.MODE === 'test';
const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED !== 'false';
const FALLBACK_AUTH = {
  user: null,
  loading: false,
  isAuthenticated: false,
  login: async () => { throw new Error('AuthProvider is not mounted'); },
  logout: () => {},
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(IS_TEST || !AUTH_ENABLED ? {
    subject: 'test', username: 'test', role: 'admin', site_keys: ['*'],
  } : null);
  const [loading, setLoading] = useState(!IS_TEST && AUTH_ENABLED);

  useEffect(() => {
    if (IS_TEST || !AUTH_ENABLED) return undefined;
    const token = window.localStorage.getItem('seasid.authToken');
    if (!token) {
      setLoading(false);
      return undefined;
    }
    api.me()
      .then(setUser)
      .catch(() => { clearAuthToken(); setUser(null); })
      .finally(() => setLoading(false));
    return undefined;
  }, []);

  useEffect(() => {
    const handleExpired = () => setUser(null);
    window.addEventListener('seasid:auth-expired', handleExpired);
    return () => window.removeEventListener('seasid:auth-expired', handleExpired);
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    isAuthenticated: Boolean(user),
    async login(username, password) {
      const result = await api.login(username, password);
      setAuthToken(result.access_token);
      setUser(result.user);
      return result.user;
    },
    logout() {
      clearAuthToken();
      setUser(null);
    },
  }), [loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  return context || FALLBACK_AUTH;
}

export function AuthGate({ children, fallback }) {
  const { loading, isAuthenticated } = useAuth();
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Checking session...</div>;
  }
  return isAuthenticated ? children : fallback;
}
