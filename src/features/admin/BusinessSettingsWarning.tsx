import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../auth/useApi';

export default function BusinessSettingsWarning() {
  const fetchApi = useApi();
  const [fallback, setFallback] = useState('');
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetchApi(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v2'}/settings/business`);
        if (!response.ok) return;
        const data = await response.json();
        if (active) setFallback(data.businessName ? '' : data.fallbackBusinessName);
      } catch { /* The settings page provides loading and save errors. */ }
    };
    void load();
    window.addEventListener('business-settings-updated', load);
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('business-settings-updated', load); window.removeEventListener('focus', load); };
  }, [fetchApi]);
  return fallback ? <p role="alert" className="mb-4 p-3 rounded bg-amber-50 text-amber-800">Business name is not set. Bills use “{fallback}”. <Link to="/business-settings" className="underline font-medium">Open Business Settings</Link></p> : null;
}
