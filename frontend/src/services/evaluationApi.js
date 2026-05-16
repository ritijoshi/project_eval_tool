import axios from 'axios';
import { API_BASE } from '../config/api';

// Matches the backend route mounted in server.js
const API_URL = `${API_BASE}/api/evaluations`;
const LEADERBOARD_URL = `${API_BASE}/api/leaderboard`;

/**
 * Initiates the evaluation async job.
 * @param {string} courseId 
 * @param {string} lectureTopic 
 * @param {File} transcriptFile 
 * @param {File} submissionsZip 
 */
export const startEvaluation = async (courseId, lectureTopic, transcriptFile, submissionsZip) => {
    const token = localStorage.getItem('token');

    // We must use FormData to send multipart/form-data payload with binaries
    const formData = new FormData();
    formData.append('courseId', courseId);
    formData.append('lectureTopic', lectureTopic);
    formData.append('transcript', transcriptFile);
    formData.append('submissions', submissionsZip);

    const response = await axios.post(`${API_URL}/start`, formData, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'multipart/form-data'
        }
    });

    return response.data;
};

/**
 * Polls the completed evaluation payload
 * @param {string} sessionId 
 */
export const getEvaluationResults = async (sessionId) => {
    const token = localStorage.getItem('token');

    const response = await axios.get(`${API_URL}/${sessionId}/results`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    return response.data;
};

/**
 * Fetches the ranked leaderboard for a session.
 * @param {string} sessionId 
 */
export const getLeaderboard = async (sessionId) => {
    const token = localStorage.getItem('token');
    const response = await axios.get(`${LEADERBOARD_URL}/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
};

/**
 * Forces a leaderboard recompute and live broadcast.
 * Professor-only.
 * @param {string} sessionId 
 */
export const refreshLeaderboard = async (sessionId) => {
    const token = localStorage.getItem('token');
    const response = await axios.post(`${LEADERBOARD_URL}/${sessionId}/refresh`, {}, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
};

/**
 * Fetches the full metric breakdown for a single student in the leaderboard.
 * @param {string} sessionId 
 * @param {string} evaluationId 
 */
export const getStudentLeaderboardDetail = async (sessionId, evaluationId) => {
    const token = localStorage.getItem('token');
    const response = await axios.get(`${LEADERBOARD_URL}/${sessionId}/student/${evaluationId}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
};
/**
 * Exports evaluation results for a session as an Excel file.
 * @param {string} sessionId 
 */
export const exportEvaluationReport = async (sessionId) => {
    const token = localStorage.getItem('token');
    const response = await axios.get(`${API_URL}/${sessionId}/export`, {
        headers: {
            'Authorization': `Bearer ${token}`
        },
        responseType: 'blob' // Important for file downloads
    });

    return response.data;
};
