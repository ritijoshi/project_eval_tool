const mongoose = require('mongoose');
const axios = require('axios');
const { getAiServiceUrl } = require('./services');

const DEFAULT_LOCAL_URI = 'mongodb://127.0.0.1:27017/virtual-classroom';

let dbState = {
    connected: false,
    host: null,
    lastError: null,
};

const getMongoUri = () => {
    const configured = (process.env.MONGO_URI || '').trim();
    if (configured) return configured;
    console.warn('MONGO_URI not set, using local fallback MongoDB at 127.0.0.1:27017/virtual-classroom');
    return DEFAULT_LOCAL_URI;
};

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(getMongoUri(), {
            serverSelectionTimeoutMS: 15000,
        });
        console.log(`MongoDB Connected: ${conn.connection.host}`);
        dbState = {
            connected: true,
            host: conn.connection.host,
            lastError: null,
        };
        return conn;
    } catch (error) {
        console.error(`MongoDB Connection Error: ${error.message}`);
        console.log('Server will continue running without DB connection.');
        dbState = {
            connected: false,
            host: null,
            lastError: error.message,
        };
        return null;
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
