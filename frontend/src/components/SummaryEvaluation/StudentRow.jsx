import React from 'react';
import { getScoreColor } from '../../utils/statusHelpers';
import './StudentRow.css';

const normalizeCriterionScore = (score, maxScore) => {
    const numericScore = Number(score ?? 0);
    const numericMax = Number(maxScore ?? 0);

    if (!Number.isFinite(numericScore)) return null;
    if (numericMax > 0) return Number(((numericScore / numericMax) * 10).toFixed(1));
    if (numericScore <= 10) return Number(numericScore.toFixed(1));
    return Number(numericScore.toFixed(1));
};

const getCriterionNames = (breakdown = []) => {
    if (Array.isArray(breakdown)) {
        return breakdown.map((criterion) => String(criterion?.name || criterion?.title || criterion?.criterion || 'Criterion')).filter(Boolean);
    }

    if (breakdown && typeof breakdown === 'object') {
        return Object.keys(breakdown);
    }

    return [];
};

const findCriterion = (breakdown, criterionName) => {
    if (!criterionName) return null;
    const normalizedName = String(criterionName).toLowerCase();

    if (Array.isArray(breakdown)) {
        return breakdown.find((item) => {
            const name = String(item?.name || item?.title || item?.criterion || '').toLowerCase();
            return name === normalizedName;
        }) || null;
    }

    if (breakdown && typeof breakdown === 'object') {
        const direct = breakdown[criterionName];
        if (direct) return direct;
        const matchedKey = Object.keys(breakdown).find((key) => String(key).toLowerCase() === normalizedName);
        return matchedKey ? breakdown[matchedKey] : null;
    }

    return null;
};

export const StudentRow = React.memo(({ ev, criterionNames = [] }) => {
    const scoreBreakdown = ev?.aiEvaluation?.scoreBreakdown || ev?.scoreBreakdown || [];
    const scoreExplanation = ev?.aiEvaluation?.scoreExplanation || ev?.scoreExplanation || '';
    const overallScore = typeof ev?.aiEvaluation?.overallScore === 'number'
        ? ev.aiEvaluation.overallScore
        : (typeof ev?.overallScore === 'number' ? ev.overallScore : ev?.score ?? null);
    const confidence = ev?.aiEvaluation?.confidence ?? ev?.confidence ?? null;
    const criteria = criterionNames.length > 0 ? criterionNames : getCriterionNames(scoreBreakdown);

    const strengthsText = (ev?.aiEvaluation?.strengths || ev?.strengths || []).filter(Boolean).join('\n') || '—';
    const weakAreasText = (ev?.aiEvaluation?.weakAreas || ev?.weakAreas || []).filter(Boolean).join('\n') || '—';
    const mistakesText = (ev?.aiEvaluation?.mistakes || ev?.mistakes || []).filter(Boolean).join('\n') || '—';
    const missingConceptsText = (ev?.aiEvaluation?.missingConcepts || ev?.missingConcepts || []).filter(Boolean).join('\n') || '—';
    const feedbackText = ev?.aiEvaluation?.overallFeedback || ev?.overallFeedback || ev?.feedback || '—';
    const scoreColor = getScoreColor(overallScore);

    if (ev?.evaluationStatus === 'FAILED') {
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

    return (
        <tr className="student-row">
            <td><strong>{ev.studentName}</strong></td>
            <td>
                <div className="score-stack" title={scoreExplanation || ''}>
                    <span className="score-badge" style={{ backgroundColor: scoreColor }}>
                        {typeof overallScore === 'number' ? overallScore.toFixed(1) : '—'}
                    </span>
                </div>
            </td>
            {criteria.map((criterion, index) => {
                const item = findCriterion(scoreBreakdown, criterion) || {};
                const normalized = normalizeCriterionScore(item.score ?? item.value, item.maxScore ?? item.max ?? 0);
                return (
                    <td key={`${ev._id || ev.studentName || 'student'}-${criterion}-${index}`} title={item.reason || item.feedback || ''}>
                        {normalized === null ? '—' : normalized.toFixed(1)}
                    </td>
                );
            })}
            <td title={confidence !== null && confidence !== undefined ? `${confidence}` : ''}>
                {confidence === null || confidence === undefined || confidence === '' ? '—' : (confidence <= 1 ? `${(confidence * 100).toFixed(0)}%` : `${Number(confidence).toFixed(0)}%`)}
            </td>
            <td className="table-multiline">{strengthsText}</td>
            <td className="table-multiline">{mistakesText}</td>
            <td className="table-multiline">{missingConceptsText}</td>
            <td className="table-multiline">{feedbackText}</td>
            <td>
                <span className="badge badge-success">{ev.evaluationStatus || 'COMPLETED'}</span>
            </td>
        </tr>
    );
});

export default StudentRow;
