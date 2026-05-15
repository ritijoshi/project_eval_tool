import React, { useMemo } from 'react';
import './EvaluationStats.css';

export default function EvaluationStats({ evaluations, totalStudents, status }) {
    // Memoized derived calculations to prevent heavy math loops on re-renders
    const stats = useMemo(() => {
        if (!evaluations || evaluations.length === 0) {
            return { avg: 0, high: 0, low: 0, failures: 0, completion: 0 };
        }

        let totalScore = 0;
        let high = 0;
        let low = 10;
        let failures = 0;
        let validScores = 0;

        evaluations.forEach(ev => {
            if (ev.evaluationStatus === 'FAILED') {
                failures += 1;
            } else if (ev.score !== null && ev.score !== undefined) {
                totalScore += ev.score;
                if (ev.score > high) high = ev.score;
                if (ev.score < low) low = ev.score;
                validScores += 1;
            }
        });

        const avg = validScores > 0 ? (totalScore / validScores).toFixed(1) : 0;
        const comp = totalStudents > 0 ? Math.round((evaluations.length / totalStudents) * 100) : 0;

        // If no scores processed yet, reset low bounds logically
        if (validScores === 0) low = 0;

        return { avg, high, low, failures, completion: comp };
    }, [evaluations, totalStudents]);

    // Don't render until at least one evaluation has landed or job is loaded definitively
    if (status === 'UPLOADED' || status === 'EXTRACTING' || status === 'ANALYZING_TRANSCRIPT') {
        return null; 
    }

    return (
        <div className="evaluation-stats-grid">
            <div className="stat-card">
                <h4>Average Score</h4>
                <div className="stat-value">{stats.avg} <span>/ 10</span></div>
            </div>
            
            <div className="stat-card">
                <h4>Highest / Lowest</h4>
                <div className="stat-value">{stats.high} <span className="dim">| {stats.low}</span></div>
            </div>

            <div className="stat-card">
                <h4>Evaluation Failures</h4>
                <div className={`stat-value ${stats.failures > 0 ? 'error-text' : ''}`}>
                    {stats.failures}
                </div>
            </div>
            
            <div className="stat-card">
                <h4>Processed</h4>
                <div className="stat-value">{evaluations.length} <span>/ {totalStudents} ({stats.completion}%)</span></div>
            </div>
        </div>
    );
}
