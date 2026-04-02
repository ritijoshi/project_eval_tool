const mongoose = require('mongoose');

const proposalSchema = new mongoose.Schema(
    {
        student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
        payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    { timestamps: true }
);

proposalSchema.index({ student: 1, createdAt: -1 });

module.exports = mongoose.model('Proposal', proposalSchema);
