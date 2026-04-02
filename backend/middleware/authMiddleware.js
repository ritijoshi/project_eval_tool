const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');

const ensureDbConnected = () => mongoose.connection.readyState === 1;

const protect = async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
        return res.status(401).json({ message: 'Not authorized, no token' });
    }

    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId || decoded.id;
        if (!userId) {
            return res.status(401).json({ message: 'Not authorized, invalid token payload' });
        }

        const user = await User.findById(userId).select('-password');

        if (!user) {
            return res.status(401).json({ message: 'Not authorized, user not found' });
        }

        req.user = {
            _id: user._id.toString(),
            role: user.role,
        };

        return next();
    } catch (error) {
        return res.status(401).json({ message: 'Not authorized, token failed' });
    }
};

const requireRole = (role) => (req, res, next) => {
    if (req.user?.role === role) return next();
    return res.status(403).json({ message: `Not authorized as a ${role}` });
};

const isProfessor = requireRole('professor');
const isStudent = requireRole('student');

module.exports = { protect, isProfessor, isStudent, requireRole };
