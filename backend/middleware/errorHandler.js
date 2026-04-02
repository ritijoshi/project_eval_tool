const notFoundHandler = (req, res, next) => {
    const error = new Error(`Route not found: ${req.originalUrl}`);
    error.statusCode = 404;
    next(error);
};

const errorHandler = (err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal server error';

    const payload = {
        message,
        requestId: req.requestId,
    };

    if (process.env.NODE_ENV !== 'production') {
        payload.stack = err.stack;
    }

    res.status(statusCode).json(payload);
};

module.exports = {
    notFoundHandler,
    errorHandler,
};