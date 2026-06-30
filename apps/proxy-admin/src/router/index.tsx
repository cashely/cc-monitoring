import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { authLoader, publicLoader } from './guard';
import MainLayout from '../layouts/MainLayout';
import Login from '../pages/Login';
import Dashboard from '../pages/Dashboard';
import UserManagement from '../pages/UserManagement';
import SupplierManagement from '../pages/SupplierManagement';
import LogManagement from '../pages/LogManagement';
import SystemSettings from '../pages/SystemSettings';

const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
    loader: publicLoader,
  },
  {
    path: '/',
    element: <MainLayout />,
    loader: authLoader,
    children: [
      {
        path: '',
        element: <Dashboard />,
      },
      {
        path: 'dashboard',
        element: <Dashboard />,
      },
      {
        path: 'user',
        element: <UserManagement />,
      },
      {
        path: 'supplier',
        element: <SupplierManagement />,
      },
      {
        path: 'log',
        element: <LogManagement />,
      },
      {
        path: 'system',
        element: <SystemSettings />,
      },
    ],
  },
]);

export default function Router() {
  return <RouterProvider router={router} />;
}