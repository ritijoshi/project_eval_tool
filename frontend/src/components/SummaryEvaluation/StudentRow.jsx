import React from 'react';
import { getScoreColor } from '../../utils/statusHelpers';
import './StudentRow.css';

// React.memo used explicitly so that when one student finishes their evaluation and pushes 
// to the table array, the other 179 rows do NOT re-render.
export const StudentRow = React.memo(({ ev }) => {

    const aiMetrics = ev.aiEvaluation?.metrics || {};
    const scoreBreakdown = ev.aiEvaluation?.scoreBreakdown || [];
    const scoreExplanation = ev.aiEvaluation?.scoreExplanation || '';
    const overallScore = typeof ev.aiEvaluation?.overallScore === 'number'
        ? ev.aiEvaluation.overallScore
        : ev.score;

    const getMetric = (key, fallbackScore, fallbackReason) => {
        const metric = aiMetrics[key];
        if (metric && typeof metric.score === 'number') {
            return { score: metric.score, reason: metric.reason || '' };
        }
        if (typeof fallbackScore === 'number') {
            return { score: fallbackScore, reason: fallbackReason || 'Fallback: deterministic signal.' };
        }
        return { score: null, reason: '' };
    };

    const formatList = (items = []) => items.filter(Boolean).join('\n');

    if (ev.evaluationStatus === 'FAILED') {
        return (
            <tr className="student-row failed-row">
                <td><strong>{ev.studentName}</strong></td>
                <td colSpan="11" className="error-text">
                    ⚠️ Evaluation Error: {ev.errorMessage || 'Internal Pipeline Failure'}
                </td>
                <td>
                    <span className="badge badge-error">Failed</span>
                </td>
            </tr>
        );
    }

    const { similarity = 0, coverage = 0, completeness = 0 } = ev.metrics || {};
    const coverageMetric = getMetric('topicCoverage', coverage * 10, 'Fallback: keyword/topic overlap.');
    const clarityMetric = getMetric('clarityReadability', (ev.metrics?.clarity ?? null) * 10, 'Fallback: readability heuristic.');
    const accuracyMetric = getMetric('technicalAccuracy', similarity * 10, 'Fallback: semantic similarity.');
    const completenessMetric = getMetric('completeness', completeness * 10, 'Fallback: length completeness.');
    const flowMetric = getMetric('logicalFlow', null, '');
    const criticalMetric = getMetric('criticalThinkingDepth', null, '');
    const confidenceMetric = getMetric('aiConfidence', null, '');

    const strengthsText = formatList(ev.aiEvaluation?.strengths || []);
    const weakAreasText = formatList(ev.aiEvaluation?.weakAreas || []);
    const improvementsText = formatList(ev.aiEvaluation?.improvements || []);
    const scoreColor = getScoreColor(overallScore);
    const breakdownPalette = {
        topicCoverage: 'seg-topic',
        conceptUnderstanding: 'seg-concept',
        technicalAccuracy: 'seg-accuracy',
        completeness: 'seg-complete',
        clarityReadability: 'seg-clarity',
        logicalFlow: 'seg-flow',
        criticalThinkingDepth: 'seg-critical',
        keywordMatch: 'seg-keyword',
        conciseness: 'seg-concise',
        aiConfidence: 'seg-confidence',
    };

    return (
        <tr className="student-row">
            <td><strong>{ev.studentName}</strong></td>
            
            <td>
                <div className="score-stack" title={scoreExplanation || ''}>
                    <span className="score-badge" style={{ backgroundColor: scoreColor }}>
                        {typeof overallScore === 'number' ? overallScore.toFixed(1) : 'N/A'}
                    </span>
                    {scoreBreakdown.length > 0 && (
                        <div className="score-breakdown" aria-label="Score breakdown">
                            {scoreBreakdown.map((item, idx) => (
                                <span
                                    key={`${item.metric}-${idx}`}
                                    className={`breakdown-seg ${breakdownPalette[item.metric] || ''}`}
                                    style={{ width: `${Math.round((item.weight || 0) * 100)}%` }}
                                    title={`${item.metric}: ${item.score} x ${item.weight}`}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </td>

            <td title={coverageMetric.reason}>{coverageMetric.score !== null ? coverageMetric.score.toFixed(1) : 'N/A'}</td>
            <td title={clarityMetric.reason}>{clarityMetric.score !== null ? clarityMetric.score.toFixed(1) : 'N/A'}</td>
            <td title={accuracyMetric.reason}>{accuracyMetric.score !== null ? accuracyMetric.score.toFixed(1) : 'N/A'}</td>
            <td title={completenessMetric.reason}>{completenessMetric.score !== null ? completenessMetric.score.toFixed(1) : 'N/A'}</td>
            <td title={flowMetric.reason}>{flowMetric.score !== null ? flowMetric.score.toFixed(1) : 'N/A'}</td>
            <td title={criticalMetric.reason}>{criticalMetric.score !== null ? criticalMetric.score.toFixed(1) : 'N/A'}</td>
            <td title={confidenceMetric.reason}>{confidenceMetric.score !== null ? confidenceMetric.score.toFixed(1) : 'N/A'}</td>

            <td className="table-multiline">{strengthsText || 'N/A'}</td>
            <td className="table-multiline">{weakAreasText || 'N/A'}</td>
            <td className="table-multiline">{improvementsText || 'N/A'}</td>

            <td>
                <span className="badge badge-success">Evaluated</span>
            </td>
        </tr>
    );
});

export default StudentRow;
