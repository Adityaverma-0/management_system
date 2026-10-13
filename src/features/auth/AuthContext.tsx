import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface User {
  id: string;
  username: string;
  role: string;
}

interface AuthContextType {
  loading: boolean;
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let salesmanToken: string | undefined;
    try { salesmanToken = JSON.parse(localStorage.getItem('salesman_session') || 'null')?.token; } catch { /* Ignore invalid stored sessions. */ }
    const storedToken = localStorage.getItem('admin_token') || salesmanToken;
    if (!storedToken) { setLoading(false); return; }
    void fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v2'}/session`, {headers:{Authorization:`Bearer ${storedToken}`}})
      .then(async response => {
        if (!response.ok) throw new Error('Invalid session');
        const data = await response.json();
        if (!cancelled && ['admin', 'salesman'].includes(data.user.role)) {
          setToken(storedToken); setUser({...data.user,username:data.user.username || 'admin'});
        }
      }).catch(() => { if (!cancelled) { localStorage.removeItem('admin_token'); localStorage.removeItem('admin_user'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const login = useCallback((newToken: string, newUser: User) => {
    localStorage.setItem('admin_token', newToken);
    localStorage.setItem('admin_user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    const saved = localStorage.getItem('admin_token');
    if (saved) void fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v2'}/logout`, { method: 'POST', headers: { Authorization: `Bearer ${saved}` } }).catch(() => {});
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
