const studentProfiles = new Map();

const MAX_INTERACTIONS = 30;

const getDefaultProfile = () => ({
    quiz_scores: {},
    weak_topics: [],
    recent_interactions: [],
    chat_history: {},
});

const getProfile = (studentId) => {
    if (!studentProfiles.has(studentId)) {
        studentProfiles.set(studentId, getDefaultProfile());
    }
    return studentProfiles.get(studentId);
};

const normalizeTopic = (topic) => String(topic || '').trim().toLowerCase();

const addInteraction = (studentId, interaction) => {
    const profile = getProfile(studentId);
    const text = String(interaction || '').trim();
    if (!text) return;

    profile.recent_interactions.push(text);
    if (profile.recent_interactions.length > MAX_INTERACTIONS) {
        profile.recent_interactions = profile.recent_interactions.slice(-MAX_INTERACTIONS);
    }
};

const addWeakTopics = (studentId, topics = []) => {
    const profile = getProfile(studentId);
    for (const rawTopic of topics) {
        const topic = normalizeTopic(rawTopic);
        if (!topic) continue;
        if (!profile.weak_topics.includes(topic)) {
            profile.weak_topics.push(topic);
        }
    }
    profile.weak_topics = profile.weak_topics.slice(-10);
};

const updateQuizScore = (studentId, topic, score) => {
    const profile = getProfile(studentId);
    const normalizedTopic = normalizeTopic(topic) || 'general';
    const numericScore = Number(score);
    if (Number.isNaN(numericScore)) return;

    const clamped = Math.max(0, Math.min(100, Math.round(numericScore)));
    profile.quiz_scores[normalizedTopic] = clamped;

    if (clamped < 70) {
        addWeakTopics(studentId, [normalizedTopic]);
    }
};

const normalizeCourseKey = (courseKey) => String(courseKey || 'general').trim().toLowerCase() || 'general';

const getChatHistory = (studentId, courseKey) => {
    const profile = getProfile(studentId);
    const key = normalizeCourseKey(courseKey);
    if (!Array.isArray(profile.chat_history[key])) {
        profile.chat_history[key] = [];
    }
    return profile.chat_history[key];
};

const appendChatMessage = (studentId, courseKey, message) => {
    const text = String(message?.text || '').trim();
    const sender = message?.sender === 'agent' ? 'agent' : 'user';
    if (!text) return;

    const history = getChatHistory(studentId, courseKey);
    history.push({
        sender,
        text,
        createdAt: new Date().toISOString(),
    });

    if (history.length > MAX_INTERACTIONS * 4) {
        const trimmed = history.slice(-(MAX_INTERACTIONS * 4));
        const profile = getProfile(studentId);
        profile.chat_history[normalizeCourseKey(courseKey)] = trimmed;
    }
};

const clearChatHistory = (studentId, courseKey) => {
    const profile = getProfile(studentId);
    profile.chat_history[normalizeCourseKey(courseKey)] = [];
};

module.exports = {
    getProfile,
    addInteraction,
    addWeakTopics,
    updateQuizScore,
    getChatHistory,
    appendChatMessage,
    clearChatHistory,
};
