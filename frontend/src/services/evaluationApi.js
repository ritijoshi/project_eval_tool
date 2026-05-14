import axios from 'axios';

// Matches the backend route mounted in server.js
const API_URL = 'http://localhost:5001/api/evaluations';

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
