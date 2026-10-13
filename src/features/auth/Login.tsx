import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [sessionMsg] = useState(() => new URLSearchParams(location.search).get('expired') ? 'Session expired, please log in again.' : '');

  useEffect(() => {
    if (user?.role === 'admin') navigate('/', { replace: true });
    if (user?.role === 'salesman') window.location.replace('/salesman/');
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');

    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v2'}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: username, password })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }

      if (data.user.role === 'salesman') {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_user');
        localStorage.setItem('salesman_session', JSON.stringify(data));
        window.location.assign('/salesman/');
        return;
      }
      localStorage.removeItem('salesman_session');
      login(data.token, data.user);
      navigate('/');
    } catch {
      setError('Could not reach the server. Please retry.');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-100 dark:bg-gray-900">
      <div className="ui-card bg-white dark:bg-gray-800 p-6 sm:p-8 rounded-lg shadow-md w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center dark:text-white">Sign In</h1>
        {sessionMsg && !error && <div className="bg-yellow-100 text-yellow-800 p-3 rounded mb-4 text-sm">{sessionMsg}</div>}
        {error && <div role="alert" className="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="ui-field-1" className="block text-sm font-medium mb-1 dark:text-gray-300">Username or mobile number</label>
            <input id="ui-field-1" type="text" value={username} onChange={e => setUsername(e.target.value)}
                   className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" required />
          </div>
          <div className="mb-6">
            <label htmlFor="ui-field-2" className="block text-sm font-medium mb-1 dark:text-gray-300">Password</label>
            <input id="ui-field-2" type="password" value={password} onChange={e => setPassword(e.target.value)}
                   className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" required />
          </div>
          <button disabled={busy} type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
            {busy ? 'Signing in…' : 'Log In'}
          </button>
        </form>
      </div>
    </div>
  );
}
