const bcrypt = require('bcryptjs');
const User = require('../models/User');

const DEMO_USERS = [
  {
    name: 'Faculty Demo',
    email: 'professor@demo.com',
    password: 'Professor123!',
    role: 'professor',
  },
  {
    name: 'Student Demo',
    email: 'student@demo.com',
    password: 'Student123!',
    role: 'student',
  },
];

const ensureDemoUsers = async () => {
  try {
    const dbReady = require('mongoose').connection.readyState === 1;
    if (!dbReady) {
      return;
    }

    for (const userData of DEMO_USERS) {
      const existing = await User.findOne({ email: userData.email.toLowerCase() });
      if (existing) continue;

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(userData.password, salt);

      await User.create({
        name: userData.name,
        email: userData.email.toLowerCase(),
        password: hashedPassword,
        role: userData.role,
        enrolledCourses: [],
        createdCourses: [],
      });
    }

    console.log('Demo users ensured for local development.');
  } catch (error) {
    console.warn('Demo user seeding failed:', error.message);
  }
};

module.exports = { ensureDemoUsers, DEMO_USERS };
