import axios from 'axios';
import { API_BASE } from '../config/api';

const API_URL = `${API_BASE}/api/assignment-eval`;
const LB_URL = `${API_BASE}/api/assignment-leaderboard`;

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

export const startAssignmentEval = async (courseId, assignmentId, sessionLabel, assignmentType, rubricFile, submissionsZip) => {
  const formData = new FormData();
  formData.append('courseId', courseId || '');
  formData.append('assignmentId', assignmentId || '');
  formData.append('sessionLabel', sessionLabel || 'Assignment Evaluation');
  formData.append('assignmentType', assignmentType || 'text');
  formData.append('rubric', rubricFile);
  formData.append('submissions', submissionsZip);

  const response = await axios.post(`${API_URL}/start`, formData, {
    headers: {
      ...authHeaders(),
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
};

export const getAssignmentEvalResults = async (sessionId) => {
  const response = await axios.get(`${API_URL}/${sessionId}/results`, {
    headers: authHeaders(),
  });
  return response.data;
};

export const exportAssignmentEvalReport = async (sessionId) => {
  const response = await axios.get(`${API_URL}/${sessionId}/export`, {
    headers: authHeaders(),
    responseType: 'blob',
  });
  return response.data;
};

export const triggerSingleEval = async (submissionId, assignmentId) => {
  const response = await axios.post(`${API_URL}/${submissionId}/single`, { assignmentId }, {
    headers: authHeaders(),
  });
  return response.data;
};

// Feature 1 — Course-scoped sessions
export const getSessionsForCourse = async (courseId) => {
  const response = await axios.get(`${API_URL}/course/${courseId}/sessions`, {
    headers: authHeaders(),
  });
  return response.data;
};

// Feature 3 — Report archive
export const listCourseReports = async (courseId) => {
  const response = await axios.get(`${API_URL}/course/${courseId}/reports`, {
    headers: authHeaders(),
  });
  return response.data;
};

export const downloadSavedReport = async (reportId, fileName) => {
  const response = await axios.get(`${API_URL}/reports/${reportId}/download`, {
    headers: authHeaders(),
    responseType: 'blob',
  });
  const blob = response.data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'eval_report.xlsx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Feature 4 — Assignment Leaderboard
export const getAssignmentLeaderboard = async (sessionId) => {
  const response = await axios.get(`${LB_URL}/${sessionId}`, {
    headers: authHeaders(),
  });
  return response.data;
};

export const getAssignmentStudentDetail = async (sessionId, resultId) => {
  const response = await axios.get(`${LB_URL}/${sessionId}/student/${resultId}`, {
    headers: authHeaders(),
  });
  return response.data;
};

// History management — delete
export const deleteEvalSession = async (sessionId) => {
  const response = await axios.delete(`${API_URL}/${sessionId}`, {
    headers: authHeaders(),
  });
  return response.data;
};

export const deleteSavedReport = async (reportId) => {
  const response = await axios.delete(`${API_URL}/reports/${reportId}`, {
    headers: authHeaders(),
  });
  return response.data;
};

