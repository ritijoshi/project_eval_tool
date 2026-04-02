const getAiServiceUrl = () => {
    const value = String(process.env.AI_SERVICE_URL || 'http://localhost:8000').trim();
    return value.endsWith('/') ? value.slice(0, -1) : value;
};

const getAllowedOrigins = () => {
    const configured = String(process.env.CORS_ORIGINS || '').trim();
    if (!configured) {
        return ['http://localhost:5173'];
    }

    return configured
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
};

module.exports = {
    getAiServiceUrl,
    getAllowedOrigins,
};