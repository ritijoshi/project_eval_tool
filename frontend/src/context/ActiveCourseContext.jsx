import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../config/api';

const ActiveCourseContext = createContext(null);

const buildStorageKey = (role, suffix = '') => `activeCourse:${role || 'user'}${suffix}`;

export const ActiveCourseProvider = ({ children }) => {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeCourseId, setActiveCourseId] = useState('');
  const [role, setRole] = useState(localStorage.getItem('role') || 'user');

  const storageKey = useMemo(() => buildStorageKey(role), [role]);
  const lastKey = useMemo(() => buildStorageKey(role, ':last'), [role]);

  const persistActiveCourse = useCallback(
    (value) => {
      if (!value) return;
      localStorage.setItem(storageKey, value);
      if (value !== 'all') {
        localStorage.setItem(lastKey, value);
      }
    },
    [storageKey, lastKey]
  );

  const fetchCourses = useCallback(async () => {
    try {
      setLoading(true);
      const currentRole = localStorage.getItem('role') || 'user';
      if (currentRole !== role) {
        setRole(currentRole);
      }
      const token = localStorage.getItem('token');
      if (!token) {
        setCourses([]);
        setActiveCourseId('');
        return;
      }
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const endpoint = currentRole === 'professor' ? '/api/professor/courses' : '/api/student/courses';
      const results = await Promise.allSettled([
        axios.get(`${API_BASE}${endpoint}`, config),
        axios.get(`${API_BASE}/api/user/active-course`, config),
      ]);
      const courseRes = results[0].status === 'fulfilled' ? results[0].value : null;
      const activeRes = results[1].status === 'fulfilled' ? results[1].value : null;
      const res = courseRes || { data: { records: [] } };
      const records = Array.isArray(res.data?.records) ? res.data.records : [];
      setCourses(records);

      const stored = localStorage.getItem(storageKey);
      const backendActive = activeRes?.data?.courseId || null;
      if (stored) {
        setActiveCourseId(stored);
        return;
      }

      if (backendActive && records.some((course) => course._id === backendActive)) {
        setActiveCourseId(backendActive);
        return;
      }

      const last = localStorage.getItem(lastKey);
      if (last && records.some((course) => course._id === last)) {
        setActiveCourseId(last);
        return;
      }

      if (currentRole === 'professor') {
        setActiveCourseId('all');
        return;
      }

      if (records.length > 0) {
        setActiveCourseId(records[0]._id);
      }
    } catch (err) {
      setCourses([]);
    } finally {
      setLoading(false);
    }
  }, [role, storageKey, lastKey]);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  useEffect(() => {
    if (activeCourseId) {
      persistActiveCourse(activeCourseId);
    }
  }, [activeCourseId, persistActiveCourse]);

  useEffect(() => {
    const saveActiveCourse = async () => {
      if (!activeCourseId || activeCourseId === 'all') return;
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const config = { headers: { Authorization: `Bearer ${token}` } };
        await axios.put(`${API_BASE}/api/user/active-course`, { courseId: activeCourseId }, config);
      } catch (err) {
        // Keep UX responsive even if persistence fails.
      }
    };

    saveActiveCourse();
  }, [activeCourseId]);

  const activeCourse = useMemo(() => {
    if (!activeCourseId || activeCourseId === 'all') return null;
    return courses.find((course) => course._id === activeCourseId) || null;
  }, [courses, activeCourseId]);

  const value = useMemo(
    () => ({
      courses,
      loading,
      activeCourseId,
      setActiveCourseId,
      activeCourse,
      refreshCourses: fetchCourses,
      isAllCourses: activeCourseId === 'all',
    }),
    [courses, loading, activeCourseId, activeCourse, fetchCourses]
  );

  return <ActiveCourseContext.Provider value={value}>{children}</ActiveCourseContext.Provider>;
};

export const useActiveCourse = () => {
  const context = useContext(ActiveCourseContext);
  if (!context) {
    throw new Error('useActiveCourse must be used within ActiveCourseProvider');
  }
  return context;
};
