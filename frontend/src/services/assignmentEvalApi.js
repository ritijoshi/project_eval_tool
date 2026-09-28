import axios from 'axios';
import { API_BASE } from '../config/api';

const API_URL = `${API_BASE}/api/assignment-eval`;

export const startAssignmentEval = async (courseId, assignmentId, sessionLabel, assignmentType, rubricFile, submissionsZip) => {
  const token = localStorage.getItem('token');
  const formData = new FormData();
  formData.append('courseId', courseId || '');
  formData.append('assignmentId', assignmentId || '');
  formData.append('sessionLabel', sessionLabel || 'Assignment Evaluation');
  formData.append('assignmentType', assignmentType || 'text');
  formData.append('rubric', rubricFile);
  formData.append('submissions', submissionsZip);

  const response = await axios.post(`${API_URL}/start`, formData, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
};

export const getAssignmentEvalResults = async (sessionId) => {
  const token = localStorage.getItem('token');
  const response = await axios.get(`${API_URL}/${sessionId}/results`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
};

export const exportAssignmentEvalReport = async (sessionId) => {
  const token = localStorage.getItem('token');
  const response = await axios.get(`${API_URL}/${sessionId}/export`, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'blob',
  });
  return response.data;
};

export const triggerSingleEval = async (submissionId, assignmentId) => {
  const token = localStorage.getItem('token');
  const response = await axios.post(`${API_URL}/${submissionId}/single`, { assignmentId }, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
};
