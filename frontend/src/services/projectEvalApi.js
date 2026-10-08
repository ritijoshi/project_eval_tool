import axios from 'axios';
import { API_BASE } from '../config/api';

const API_URL = `${API_BASE}/api/project-eval`;
const LB_URL = `${API_BASE}/api/project-leaderboard`;

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

/**
 * Initiates a new Project Evaluation Session (single or batch).
 * Accepts either JSON configuration or FormData with uploaded rubric/weekly files.
 */
export const startProjectEval = async ({
  courseId = '',
  sessionLabel = 'Project Evaluation',
  projectGoal = '',
  projectType = 'individual',
  mode = 'batch',
  rubricCriteria = [],
  totalMaxScore = 100,
  techRequirements = [],
  milestones = [],
  repoLinks = [],
  rubricFile = null,
  weeklyDocFile = null,
} = {}) => {
  const formData = new FormData();
  formData.append('courseId', courseId || '');
  formData.append('sessionLabel', sessionLabel || 'Project Evaluation');
  formData.append('projectGoal', projectGoal || '');
  formData.append('projectType', projectType || 'individual');
  formData.append('mode', mode || 'batch');
  formData.append('totalMaxScore', String(totalMaxScore || 100));

  formData.append(
    'rubricCriteria',
    typeof rubricCriteria === 'string' ? rubricCriteria : JSON.stringify(rubricCriteria || [])
  );
  formData.append(
    'techRequirements',
    typeof techRequirements === 'string' ? techRequirements : JSON.stringify(techRequirements || [])
  );
  formData.append(
    'milestones',
    typeof milestones === 'string' ? milestones : JSON.stringify(milestones || [])
  );
  formData.append(
    'repoLinks',
    typeof repoLinks === 'string' ? repoLinks : JSON.stringify(repoLinks || [])
  );

  if (rubricFile) {
    formData.append('rubric', rubricFile);
  }
  if (weeklyDocFile) {
    formData.append('weeklyDoc', weeklyDocFile);
  }

  const response = await axios.post(`${API_URL}/start`, formData, {
    headers: {
      ...authHeaders(),
    },
  });

  return response.data;
};

/**
 * Submits a weekly progress update for a project / team.
 */
export const submitWeeklyProgress = async ({
  sessionId,
  identifier,
  weekLabel = 'Week 1',
  fileText = '',
  weeklyDocFile = null,
  studentId = null,
}) => {
  const formData = new FormData();
  formData.append('sessionId', sessionId);
  formData.append('identifier', identifier);
  formData.append('weekLabel', weekLabel || 'Week 1');
  formData.append('fileText', fileText || '');
  if (studentId) {
    formData.append('studentId', studentId);
  }
  if (weeklyDocFile) {
    formData.append('weeklyDoc', weeklyDocFile);
  }

  const response = await axios.post(`${API_URL}/weekly-progress`, formData, {
    headers: {
      ...authHeaders(),
    },
  });

  return response.data;
};

/**
 * Lists all project evaluation sessions for a given course.
 */
export const getCourseSessions = async (courseId) => {
  const response = await axios.get(`${API_URL}/course/${courseId}/sessions`, {
    headers: authHeaders(),
  });
  return response.data;
};

/**
 * Lists generated project evaluation report archives for a course.
 */
export const getCourseReports = async (courseId) => {
  const response = await axios.get(`${API_URL}/course/${courseId}/reports`, {
    headers: authHeaders(),
  });
  return response.data;
};

/**
 * Downloads a generated Excel report file by reportId.
 */
export const downloadReport = async (reportId, fileName) => {
  const response = await axios.get(`${API_URL}/reports/${reportId}/download`, {
    headers: authHeaders(),
    responseType: 'blob',
  });
  const blob = response.data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'project_eval_report.xlsx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Deletes a saved report record and its file on disk.
 */
export const deleteReport = async (reportId) => {
  const response = await axios.delete(`${API_URL}/reports/${reportId}`, {
    headers: authHeaders(),
  });
  return response.data;
};

/**
 * Retrieves evaluation session status and all project results.
 */
export const getSessionResults = async (sessionId) => {
  const response = await axios.get(`${API_URL}/${sessionId}/results`, {
    headers: authHeaders(),
  });
  return response.data;
};

/**
 * Generates and downloads the 5-sheet Excel report for a session on-the-fly.
 */
export const exportSessionReport = async (sessionId, fileName) => {
  const response = await axios.get(`${API_URL}/${sessionId}/export`, {
    headers: authHeaders(),
    responseType: 'blob',
  });
  const blob = response.data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || `project_eval_session_${sessionId}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Deletes a session and its associated results, progress, and reports.
 */
export const deleteSession = async (sessionId) => {
  const response = await axios.delete(`${API_URL}/${sessionId}`, {
    headers: authHeaders(),
  });
  return response.data;
};

/**
 * Retrieves diagnostic evaluation data for an individual project within a session.
 */
export const getSingleProjectResult = async (sessionId, resultId) => {
  const response = await axios.get(`${API_URL}/${sessionId}/result/${resultId}`, {
    headers: authHeaders(),
  });
  return response.data;
};

/**
 * Triggers re-evaluation for a single project within a session.
 */
export const triggerSingleProjectEval = async (sessionId, resultId) => {
  const response = await axios.post(
    `${API_URL}/${sessionId}/result/${resultId}/re-eval`,
    {},
    {
      headers: authHeaders(),
    }
  );
  return response.data;
};

// ─── Leaderboard APIs ────────────────────────────────────────────────────────

/**
 * Retrieves the ranked project leaderboard and health metrics for a session.
 */
export const getProjectLeaderboard = async (sessionId) => {
  const response = await axios.get(`${LB_URL}/${sessionId}`, {
    headers: authHeaders(),
  });
  return response.data;
};

/**
 * Retrieves full granular diagnostic and evidence detail for a single project.
 */
export const getProjectDetail = async (sessionId, resultId) => {
  const response = await axios.get(`${LB_URL}/${sessionId}/project/${resultId}`, {
    headers: authHeaders(),
  });
  return response.data;
};
