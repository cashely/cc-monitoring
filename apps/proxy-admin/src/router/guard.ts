import { redirect } from 'react-router-dom';

// Auth loader for protected routes
export const authLoader = async () => {
  const token = localStorage.getItem('token');
  const user = localStorage.getItem('user');

  // No token or user, redirect to login
  if (!token || !user) {
    return redirect('/login');
  }

  // Return user info from localStorage for route use
  // Token validation handled automatically by axios interceptor on API calls
  return { user: JSON.parse(user) };
};

// Public route loader (already logged in, redirect to dashboard)
export const publicLoader = async () => {
  const token = localStorage.getItem('token');
  if (token) {
    return redirect('/dashboard');
  }
  return null;
};
