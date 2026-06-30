import { redirect } from 'react-router-dom';
import { getUserInfo } from '../services/api';

// Auth loader for protected routes
export const authLoader = async () => {
  const token = localStorage.getItem('token');

  // No token, redirect to login
  if (!token) {
    return redirect('/login');
  }

  try {
    // Verify token by getting user info
    const response = await getUserInfo();
    if (response.code !== 0) {
      return redirect('/login');
    }

    // Return user info for route use
    return { user: response.data.user };
  } catch (error) {
    // Token invalid, redirect to login
    return redirect('/login');
  }
};

// Public route loader (already logged in, redirect to dashboard)
export const publicLoader = async () => {
  const token = localStorage.getItem('token');
  if (token) {
    return redirect('/dashboard');
  }
  return null;
};
