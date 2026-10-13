import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { AuthProvider, useAuth } from './features/auth/AuthContext';
import { CheckCircle, List, Warehouse, Truck, Package, Users, FileUp, Database , TrendingUp} from 'lucide-react';

import Login from './features/auth/Login';
import ApprovalDashboard from './features/admin/ApprovalDashboard';
import StockApprovalDashboard from './features/admin/StockApprovalDashboard';

import AuditLog from './features/admin/AuditLog';
import GodownsPage from './features/admin/GodownsPage';
import VehiclesPage from './features/admin/VehiclesPage';
import ProductsPage from './features/admin/ProductsPage';
import SalesmenPage from './features/admin/SalesmenPage';
import InventoryImport from './features/admin/InventoryImport';
import ManualStockPage from './features/admin/ManualStockPage';
import SalesDashboard from './features/admin/SalesDashboard';
import TaxSettings from "./features/admin/TaxSettings";


import './App.css';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-4">Checking session...</div>;
  if (user?.role === 'salesman') { window.location.replace('/salesman/'); return <div>Opening dashboard...</div>; }
  if (!user || user.role.toLowerCase() !== 'admin') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const navClass = ({ isActive }: { isActive: boolean }) => 
  `flex items-center gap-3 px-4 py-2 rounded ${
    isActive 
      ? "bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200 font-medium" 
      : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
  }`;

function AdminLayout({ children }: { children: React.ReactNode }) {
  const { logout, user } = useAuth();
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex flex-col">
      <header className="bg-white dark:bg-gray-800 shadow px-4 py-4 md:px-8 md:py-6 flex justify-between items-center">
        <h1 className="text-xl font-bold dark:text-white">Admin Panel</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm dark:text-gray-300">Welcome, {user?.username}</span>
          <button onClick={logout} className="text-sm bg-red-100 text-red-600 px-3 py-1 rounded hover:bg-red-200">Logout</button>
        </div>
      </header>
      <div className="flex flex-col md:flex-row flex-1">
        <aside className="w-full md:w-64 md:shrink-0 bg-white dark:bg-gray-800 shadow-sm border-r dark:border-gray-700">
          <nav className="p-4 flex flex-wrap md:block md:space-y-2">
            <NavLink to="/" className={navClass}><CheckCircle size={18} /> Unload Approvals</NavLink>
            <NavLink to="/stock-approvals" className={navClass}><Package size={18} /> Stock Approvals</NavLink>
            <NavLink to="/audit" className={navClass}><List size={18} /> Audit Log</NavLink>
            <NavLink to="/godowns" className={navClass}><Warehouse size={18} /> Godowns</NavLink>
            <NavLink to="/vehicles" className={navClass}><Truck size={18} /> Vehicles</NavLink>
            <NavLink to="/products" className={navClass}><Package size={18} /> Products</NavLink>
            <NavLink to="/salesmen" className={navClass}><Users size={18} /> Salesmen</NavLink>
            <NavLink to="/inventory/import" className={navClass}><FileUp size={18} /> Inventory PDF Import</NavLink>
            <NavLink to="/manual-stock" className={navClass}><Database size={18} /> Manual Stock Add</NavLink>
            <NavLink to="/sales-dashboard" className={navClass}><TrendingUp size={18} /> Sales Dashboard</NavLink>
            <NavLink to="/tax-settings" className={navClass}>Tax Settings</NavLink>
          </nav>
        </aside>
        <main className="flex-1 min-w-0 p-4 md:p-6 overflow-auto">
        {children}
      </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <AdminLayout>
                <Routes>
                  <Route path="/" element={<ApprovalDashboard />} />
                  <Route path="/stock-approvals" element={<StockApprovalDashboard />} />
                  <Route path="/audit" element={<AuditLog />} />
                  <Route path="/godowns" element={<GodownsPage />} />
                  <Route path="/vehicles" element={<VehiclesPage />} />
                  <Route path="/products" element={<ProductsPage />} />
                  <Route path="/salesmen" element={<SalesmenPage />} />
                  <Route path="/inventory/import" element={<InventoryImport />} />
                  <Route path="/manual-stock" element={<ManualStockPage />} />
                  <Route path="/sales-dashboard" element={<SalesDashboard />} />
                  <Route path="/tax-settings" element={<TaxSettings />} />
                  <Route path="*" element={<div>Page not found.</div>} />
                </Routes>
              </AdminLayout>
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
