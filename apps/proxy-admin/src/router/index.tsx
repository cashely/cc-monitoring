import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from '../App';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
  },
  {
    path: '/about',
    element: <div>关于页面</div>,
  },
]);

export default function Router() {
  return <RouterProvider router={router} />;
}