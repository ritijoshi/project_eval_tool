const mongoose = require('mongoose');
const axios = require('axios');
const { getAiServiceUrl } = require('./services');

let dbState = {
    connected: false,
    host: null,
    lastError: null,
};

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI);
        console.log(`MongoDB Connected: ${conn.connection.host}`);
        dbState = {
            connected: true,
            host: conn.connection.host,
            lastError: null,
        };
    } catch (error) {
        console.error(`MongoDB Connection Error: ${error.message}`);
        console.log('Server will continue running without DB connection.');
        dbState = {
            connected: false,
            host: null,
            lastError: error.message,
        };
    }
};

connectDB.getDbHealth = () => ({ ...dbState });

connectDB.checkAiHealth = async () => {
    const aiBase = getAiServiceUrl();
    try {
        const response = await axios.get(`${aiBase}/health`, { timeout: 2500 });
        return {
            connected: true,
            status: response?.data?.status || 'ok',
        };
    } catch (error) {
        return {
            connected: false,
            status: 'unreachable',
            lastError: error.message,
        };
    }
};

module.exports = connectDB;
