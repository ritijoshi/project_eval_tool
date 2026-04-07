const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { registerLoginEvent } = require('../services/progressService');

const ensureDbConnected = () => mongoose.connection.readyState === 1;

const generateToken = (user) => {
    return jwt.sign(
        { userId: user._id.toString(), role: user.role },
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRES_IN || '30d',
        }
    );
};

const registerForRole = (role) => async (req, res) => {
    const { name, email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!name || !normalizedEmail || !password) {
        return res.status(400).json({ message: 'name, email, and password are required' });
    }

    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const userExists = await User.findOne({ email: normalizedEmail });
        if (userExists) return res.status(400).json({ message: 'User already exists' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await User.create({
            name,
            email: normalizedEmail,
            password: hashedPassword,
            role,
            enrolledCourses: [],
            createdCourses: [],
        });

        return res.status(201).json({
            _id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role,
            token: generateToken(user),
        });
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(400).json({ message: 'Email already in use' });
        }
        return res.status(500).json({ message: error.message || 'Registration failed' });
    }
};

const loginForRole = (role) => async (req, res) => {
    const { email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail || !password) {
        return res.status(400).json({ message: 'email and password are required' });
    }

    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const user = await User.findOne({ email: normalizedEmail }).select('+password');

        if (!user || user.role !== role) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        if (role === 'student') {
            registerLoginEvent(user._id).catch((error) => {
                console.warn('Failed to register student login event:', error.message);
            });
        }

        return res.json({
            _id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role,
            token: generateToken(user),
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Login failed' });
    }
};

const resetPasswordForRole = (role) => async (req, res) => {
    const { email, newPassword } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail || !newPassword) {
        return res.status(400).json({ message: 'email and newPassword are required' });
    }

    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const user = await User.findOne({ email: normalizedEmail, role }).select('+password');
        if (!user) {
            return res.status(404).json({ message: 'User not found in system.' });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        return res.status(200).json({ message: 'Password reset successfully!' });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Password reset failed' });
    }
};

module.exports = {
    registerStudent: registerForRole('student'),
    registerProfessor: registerForRole('professor'),
    loginStudent: loginForRole('student'),
    loginProfessor: loginForRole('professor'),
    resetStudentPassword: resetPasswordForRole('student'),
    resetProfessorPassword: resetPasswordForRole('professor'),
};
