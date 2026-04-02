const axios = require('axios');
const { getAiServiceUrl } = require('../config/services');

const AI_BASE = getAiServiceUrl();

const listCourses = async (req, res) => {
    try {
        const pythonServiceUrl = `${AI_BASE}/course/list`;
        const response = await axios.get(pythonServiceUrl);
        // Expected shape: { courses: [course_key, ...] }
        return res.status(200).json(response.data);
    } catch (error) {
        // Keep UI resilient even if Python service is offline.
        return res.status(200).json({ courses: [] });
    }
};

module.exports = { listCourses };

