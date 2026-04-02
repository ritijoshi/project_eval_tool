import axios from 'axios';

const rawBase = import.meta.env.VITE_API_URL || 'http://localhost:5000';
export const API_BASE = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;

export const apiClient = axios.create({
  baseURL: API_BASE,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});