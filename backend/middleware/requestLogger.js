const requestLogger = (req, res, next) => {
    const startedAt = Date.now();
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    res.on('finish', () => {
        const durationMs = Date.now() - startedAt;
        const entry = {
            requestId,
            method: req.method,
            path: req.originalUrl,
            statusCode: res.statusCode,
            durationMs,
        };
        console.log(JSON.stringify(entry));
    });

    next();
};

module.exports = { requestLogger };