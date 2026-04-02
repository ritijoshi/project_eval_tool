const express = require('express');
const router = express.Router();

const {
    registerStudent,
    loginStudent,
    resetStudentPassword,
    registerProfessor,
    loginProfessor,
    resetProfessorPassword,
} = require('../controllers/authController');

// Student auth
router.post('/student/register', registerStudent);
router.post('/student/login', loginStudent);
router.post('/student/reset-password', resetStudentPassword);

// Professor auth
router.post('/professor/register', registerProfessor);
router.post('/professor/login', loginProfessor);
router.post('/professor/reset-password', resetProfessorPassword);

// Backwards-compatible endpoints (deprecated): accepts `role` in the request body
// Keeps older frontend flows working while enforcing role checks on the backend.
router.post('/register', (req, res, next) => {
    if (req.body?.role === 'professor') return registerProfessor(req, res, next);
    return registerStudent(req, res, next);
});

router.post('/login', (req, res, next) => {
    if (req.body?.role === 'professor') return loginProfessor(req, res, next);
    return loginStudent(req, res, next);
});

router.post('/reset-password', (req, res, next) => {
    if (req.body?.role === 'professor') return resetProfessorPassword(req, res, next);
    return resetStudentPassword(req, res, next);
});

module.exports = router;
