import { useState } from 'react';
import { BASE_URL } from '../data/apiClient';

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
        const res = await fetch(`${BASE_URL}/salesman/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile, password })
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('salesman_session', JSON.stringify(data));
            onLogin();
        } else {
            setError('Invalid mobile number or password.');
        }
    } catch {
        setError('Could not reach the server. Please retry.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <div className="ui-card w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-6 border border-gray-100 dark:border-gray-800">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-blue-600 dark:text-blue-400">Salesman App</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to start your day</p>
        </div>
        
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="ui-field-1" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mobile Number</label>
            <input id="ui-field-1"
              type="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-950 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
            />
          </div>
          <div>
            <label htmlFor="ui-field-2" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input id="ui-field-2"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-950 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
            />
          </div>
          
          {error && <p role="alert" className="text-red-500 text-sm font-medium">{error}</p>}
          
          <button 
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors active:opacity-90"
          >
            Login
          </button>
        </form>
      </div>
    </div>
  );
}
