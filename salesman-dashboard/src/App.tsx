import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Home, Map as MapIcon, Package, FileText, ShoppingCart } from 'lucide-react';
import clsx from 'clsx';
import { fetchActiveWorkDay } from './data/mockApi';
import { request, session } from './data/apiClient';
import { refreshData } from './data/realApi';
import LoginPage from './features/Login';
const unified = import.meta.env.BASE_URL === '/salesman/';

// Pages
import HomePage from './features/Home';
import RoutePage from './features/RouteList';
import StockPage from './features/VehicleStock';
import SummaryPage from './features/SummaryTabs';
import LoadStockPage from './features/LoadStock';
import UnloadPage from './features/Unload';
import InvoicePrintPage from './features/InvoicePrint';
import StockRequestsPage from './features/StockRequests';

// Direct Sell Pages
import CustomerSelectPage from './features/direct-sell/CustomerSelect';
import CustomerAddPage from './features/direct-sell/CustomerAdd';
import DirectSaleEntryPage from './features/direct-sell/SaleEntry';
import CustomerDetail from './features/customers/CustomerDetail';


function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const tabs = [
    { name: 'Home', path: '/', icon: Home },
    { name: 'Route', path: '/route', icon: MapIcon },
    { name: 'Sell', path: '/sell', icon: ShoppingCart },
    { name: 'Stock', path: '/stock', icon: Package },
    { name: 'Summary', path: '/summary', icon: FileText },
  ];

  // Hide nav on print screen
  if (location.pathname.startsWith('/print')) return null;

  return (
    <nav aria-label="Main navigation" className="ui-bottom-nav fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 pb-safe print:hidden z-50">
      <div className="flex justify-around items-center h-16">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = location.pathname.startsWith(tab.path) && (tab.path !== '/' || location.pathname === '/');
          return (
            <button
              key={tab.name}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => navigate(tab.path)}
              className={clsx(
                "flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors",
                isActive ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400"
              )}
            >
              <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-xs font-semibold">{tab.name}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function Layout({ children, onLogout }: { children: React.ReactNode, onLogout: () => void }) {
  const location = useLocation();
  const isPrint = location.pathname.startsWith('/print');

  return (
    <div className={`ui-shell min-h-screen bg-gray-50 dark:bg-gray-950 ${!isPrint ? 'ui-sales-shell' : ''}`}>
      {!isPrint && !location.pathname.startsWith('/sell') && (
        <header className="ui-header bg-white dark:bg-gray-900 shadow-sm px-4 py-3 flex justify-between items-center print:hidden">
          <h1 className="text-lg font-bold">Salesman Dashboard</h1>
          <div className="flex items-center space-x-2">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
            <span className="text-sm font-bold text-gray-600 dark:text-gray-300 mr-2">Online</span><button onClick={onLogout} className="text-sm text-gray-600 dark:text-gray-400 font-medium hover:text-gray-900 border-l border-gray-300 pl-3">Logout</button>
          </div>
        </header>
      )}
      <main className={isPrint || location.pathname.startsWith('/sell') ? '' : 'p-4'}>{children}</main>
      <BottomNav />
    </div>
  );
}

function App() {
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState('');
  const logout = () => {
    void request('/logout', {}).catch(() => {});
    localStorage.removeItem('salesman_session'); setIsAuthenticated(false); setError('');
  };
  const initialize = async () => {
    setLoading(true); setError('');
    try {
      if (!session()?.token) { setIsAuthenticated(false); return; }
      const verified = await request('/session');
      if (verified.user.role !== 'salesman') { setIsAuthenticated(false); return; }
      setIsAuthenticated(true);
      await fetchActiveWorkDay();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load data.'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    void initialize();
    const expired = () => { setIsAuthenticated(false); setError(''); };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  useEffect(() => {
    if (!isAuthenticated) return;
    const refresh = () => { void refreshData().catch(e => setError(e.message)); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [isAuthenticated]);
  if (loading) return <div className="p-6">Loading your inventory...</div>;
  if (!isAuthenticated) {
    if (unified) { window.location.replace('/login'); return <div>Opening sign in...</div>; }
    return <LoginPage onLogin={() => void initialize()} />;
  }
  if (error) return <div className="p-6 space-y-4"><p role="alert">{error}</p><button onClick={() => void initialize()}>Retry</button><button onClick={logout}>Logout</button></div>;

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Layout onLogout={logout}><HomePage /></Layout>} />
        <Route path="/route" element={<Layout onLogout={logout}><RoutePage /></Layout>} />
        
        {/* Direct Sell Flow */}
        <Route path="/sell" element={<Layout onLogout={logout}><CustomerSelectPage /></Layout>} />
        <Route path="/sell/new-customer" element={<Layout onLogout={logout}><CustomerAddPage /></Layout>} />
        <Route path="/sell/:customerId" element={<Layout onLogout={logout}><DirectSaleEntryPage /></Layout>} />
        <Route path="/customer/:customerId" element={<Layout onLogout={logout}><CustomerDetail /></Layout>} />
        
        {/* Fallback for old route-based sales */}
        <Route path="/sale/:outletId" element={<Navigate to="/sell/walk-in" replace />} />

        <Route path="/stock" element={<Layout onLogout={logout}><StockPage /></Layout>} />
        <Route path="/summary" element={<Layout onLogout={logout}><SummaryPage /></Layout>} />
        <Route path="/admin" element={<div className="p-6">Page not found.</div>} />
        <Route path="/load-stock" element={<Layout onLogout={logout}><LoadStockPage /></Layout>} />
        <Route path="/stock-requests" element={<Layout onLogout={logout}><StockRequestsPage /></Layout>} />
        <Route path="/unload" element={<Layout onLogout={logout}><UnloadPage /></Layout>} />
        <Route path="/print/:invoiceId" element={<Layout onLogout={logout}><InvoicePrintPage /></Layout>} />
        
        <Route path="*" element={<div className="p-6">Page not found.</div>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
