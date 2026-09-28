const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRankedLeaderboard } = require('../controllers/leaderboardController');

const baseStudent = {
  _id: 'e1',
  studentName: 'student1',
  rollNumber: 'R1',
  evaluationStatus: 'COMPLETED',
  aiEvaluation: {
    overallScore: 90,
    scoreBreakdown: [
      { name: 'Correctness', score: 10, maxScore: 10, feedback: 'Good' },
      { name: 'Completeness', score: 10, maxScore: 10, feedback: 'Good' },
      { name: 'Relevance', score: 10, maxScore: 10, feedback: 'Good' },
    ],
    fallback: false,
  },
};

test('buildRankedLeaderboard keeps valid scored results and uses fallback overall score rules', () => {
  const evaluations = [
    { ...baseStudent },
    {
      _id: 'e2',
      studentName: 'student2',
      rollNumber: 'R2',
      evaluationStatus: 'COMPLETED',
      score: 5.7,
      aiEvaluation: {
        overallScore: 57,
        scoreBreakdown: [
          { name: 'Correctness', score: 20, maxScore: 25, feedback: 'okay' },
          { name: 'Completeness', score: 10, maxScore: 25, feedback: 'okay' },
          { name: 'Relevance', score: 15, maxScore: 25, feedback: 'okay' },
          { name: 'Reference Answer Alignment', score: 12, maxScore: 25, feedback: 'okay' },
        ],
        fallback: false,
      },
    },
    {
      _id: 'e3',
      studentName: 'student3',
      rollNumber: 'R3',
      evaluationStatus: 'COMPLETED',
      score: 2.8,
      aiEvaluation: {
        overallScore: 28,
        scoreBreakdown: [
          { name: 'Correctness', score: 4, maxScore: 10, feedback: 'needs work' },
          { name: 'Completeness', score: 2, maxScore: 10, feedback: 'needs work' },
          { name: 'Relevance', score: 3, maxScore: 10, feedback: 'needs work' },
          { name: 'Technical Detail', score: 2, maxScore: 10, feedback: 'needs work' },
        ],
        fallback: false,
      },
    },
    {
      _id: 'e4',
      studentName: 'student4',
      rollNumber: 'R4',
      evaluationStatus: 'FAILED',
      score: 0,
      aiEvaluation: {
        overallScore: 0,
        fallback: false,
      },
    },
    {
      _id: 'e5',
      studentName: 'student5',
      rollNumber: 'R5',
      evaluationStatus: 'PENDING',
      score: 6,
      aiEvaluation: {
        overallScore: 60,
        fallback: false,
      },
    },
  ];

  const { ranked } = buildRankedLeaderboard(evaluations);

  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].studentName, 'student1');
  assert.equal(ranked[1].studentName, 'student2');
  assert.equal(ranked[2].studentName, 'student3');
  assert.equal(ranked[1].overallScore, 57);
  assert.ok(Array.isArray(ranked[1].scoreBreakdown));
  assert.deepEqual(ranked[1].scoreBreakdown[0], { name: 'Correctness', score: 20, maxScore: 25, feedback: 'okay' });
});

test('buildRankedLeaderboard accepts zero scores and fallback-supplied scores when they are valid', () => {
  const evaluations = [
    {
      _id: 'zero1',
      studentName: 'Zero Student',
      rollNumber: 'R0',
      evaluationStatus: 'COMPLETED',
      score: 0,
      aiEvaluation: {
        overallScore: 0,
        scoreBreakdown: [{ name: 'Correctness', score: 0, maxScore: 10, feedback: 'No attempt' }],
        fallback: false,
      },
    },
    {
      _id: 'fallback1',
      studentName: 'Fallback Student',
      rollNumber: 'RF',
      evaluationStatus: 'COMPLETE',
      score: 7.5,
      aiEvaluation: {
        overallScore: null,
        scoreBreakdown: [{ name: 'Correctness', score: 7.5, maxScore: 10, feedback: 'fallback' }],
        fallback: true,
      },
    },
  ];

  const { ranked } = buildRankedLeaderboard(evaluations);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].overallScore, 75);
  assert.equal(ranked[1].overallScore, 0);
});
