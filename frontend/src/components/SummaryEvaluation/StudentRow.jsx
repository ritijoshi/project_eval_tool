import React from 'react';
import { getScoreColor } from '../../utils/statusHelpers';
import './StudentRow.css';

// React.memo used explicitly so that when one student finishes their evaluation and pushes 
// to the table array, the other 179 rows do NOT re-render.
export const StudentRow = React.memo(({ ev }) => {

    if (ev.evaluationStatus === 'FAILED') {
        return (
            <tr className="student-row failed-row">
                <td><strong>{ev.studentName}</strong></td>
                <td>{ev.rollNumber}</td>
                <td colSpan="3" className="error-text">
                    ⚠️ Evaluation Error: {ev.errorMessage || 'Internal Pipeline Failure'}
                </td>
                <td>
                    <span className="badge badge-error">Failed</span>
                </td>
            </tr>
        );
    }

    const { similarity = 0, coverage = 0, completeness = 0 } = ev.metrics || {};
    const scoreColor = getScoreColor(ev.score);

    return (
        <tr className="student-row">
            <td><strong>{ev.studentName}</strong></td>
            <td>{ev.rollNumber}</td>
            
            <td>
                <span className="score-badge" style={{ backgroundColor: scoreColor }}>
                    {ev.score}
                </span>
            </td>

            {/* Visual Explainability Indicators */}
            <td className="metrics-cell">
                <div className="metric-bar" title={`Similarity: ${Math.round(similarity * 100)}%`}>
                    <span className="label">Sim</span>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${similarity * 100}%`, background: '#6366f1' }}></div></div>
                </div>
                <div className="metric-bar" title={`Coverage: ${Math.round(coverage * 100)}%`}>
                    <span className="label">Cov</span>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${coverage * 100}%`, background: '#8b5cf6' }}></div></div>
                </div>
                <div className="metric-bar" title={`Completeness: ${Math.round(completeness * 100)}%`}>
                    <span className="label">Len</span>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${completeness * 100}%`, background: '#3b82f6' }}></div></div>
                </div>
            </td>

            <td className="feedback-cell">
                <p>{ev.feedback}</p>
            </td>

            <td>
                <span className="badge badge-success">Evaluated</span>
            </td>
        </tr>
    );
});

export default StudentRow;
