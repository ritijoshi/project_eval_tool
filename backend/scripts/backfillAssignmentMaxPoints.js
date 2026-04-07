const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Assignment = require('../models/Assignment');

dotenv.config();

const DEFAULT_MAX_POINTS = Number(process.env.DEFAULT_ASSIGNMENT_MAX_POINTS || 100);

const run = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('Missing MONGO_URI in environment.');
    process.exitCode = 1;
    return;
  }

  if (!Number.isFinite(DEFAULT_MAX_POINTS) || DEFAULT_MAX_POINTS <= 0) {
    console.error('DEFAULT_ASSIGNMENT_MAX_POINTS must be a positive number if provided.');
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(mongoUri);

  try {
    const filter = {
      $or: [
        { maxPoints: { $exists: false } },
        { maxPoints: null },
        { maxPoints: { $lte: 0 } },
        { maxPoints: { $type: 'string' } },
      ],
    };

    const update = { $set: { maxPoints: DEFAULT_MAX_POINTS } };

    const result = await Assignment.updateMany(filter, update);

    const modified = result.modifiedCount ?? result.nModified ?? 0;
    const matched = result.matchedCount ?? result.n ?? 0;

    console.log(
      `Backfill complete. matched=${matched} modified=${modified} defaultMaxPoints=${DEFAULT_MAX_POINTS}`
    );
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exitCode = 1;
});
