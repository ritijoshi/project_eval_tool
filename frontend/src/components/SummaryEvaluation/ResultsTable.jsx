import React, { useState, useMemo } from 'react';
import StudentRow from './StudentRow';
import './ResultsTable.css';

const normalizeCriterionScore = (score, maxScore) => {
    const numericScore = Number(score ?? 0);
    const numericMax = Number(maxScore ?? 0);

    if (!Number.isFinite(numericScore)) return null;
    if (numericMax > 0) return Number(((numericScore / numericMax) * 10).toFixed(1));
    if (numericScore <= 10) return Number(numericScore.toFixed(1));
    return Number(numericScore.toFixed(1));
};

const extractBreakdownNames = (breakdown) => {
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
        return breakdown.find((item) => String(item?.name || item?.title || item?.criterion || '').toLowerCase() === normalizedName) || null;
    }

    if (breakdown && typeof breakdown === 'object') {
        const direct = breakdown[criterionName];
        if (direct) return direct;
        const matchedKey = Object.keys(breakdown).find((key) => String(key).toLowerCase() === normalizedName);
        return matchedKey ? breakdown[matchedKey] : null;
    }

    return null;
};

export default function ResultsTable({ evaluations, status, sessionMetadata }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'score', direction: 'desc' });

    const getOverallScore = (ev) => {
        const overall = ev?.aiEvaluation?.overallScore ?? ev?.overallScore ?? ev?.score;
        return typeof overall === 'number' ? overall : null;
    };

    const criterionNames = useMemo(() => {
        const names = evaluations.flatMap((ev) => extractBreakdownNames(ev?.aiEvaluation?.scoreBreakdown || ev?.scoreBreakdown || {}));
        return [...new Set(names)];
    }, [evaluations]);

    const getCriterionValue = (ev, criterionName) => {
        const breakdown = ev?.aiEvaluation?.scoreBreakdown || ev?.scoreBreakdown || {};
        const criterion = findCriterion(breakdown, criterionName);
        if (!criterion) return null;
        const score = criterion.score ?? criterion.value ?? 0;
        const maxScore = criterion.maxScore ?? criterion.max ?? 0;
        return normalizeCriterionScore(score, maxScore);
    };

    const processedEvaluations = useMemo(() => {
        let filterable = [...evaluations];

        if (searchTerm) {
            const lowerTerm = searchTerm.toLowerCase();
            filterable = filterable.filter((ev) => {
                const student = (ev.studentName || '').toLowerCase();
                const fileName = (ev.fileName || ev.file_name || '').toLowerCase();
                const rollNumber = (ev.rollNumber || ev.rollNo || '').toLowerCase();
                return student.includes(lowerTerm) || fileName.includes(lowerTerm) || rollNumber.includes(lowerTerm);
            });
        }

        filterable.sort((a, b) => {
            const aValue = sortConfig.key === 'score'
                ? getOverallScore(a)
                : sortConfig.key === 'studentName'
                    ? (a.studentName || '').toLowerCase()
                    : sortConfig.key === 'confidence'
                        ? (a.aiEvaluation?.confidence ?? a.confidence ?? null)
                        : getCriterionValue(a, sortConfig.key);

            const bValue = sortConfig.key === 'score'
                ? getOverallScore(b)
                : sortConfig.key === 'studentName'
                    ? (b.studentName || '').toLowerCase()
                    : sortConfig.key === 'confidence'
                        ? (b.aiEvaluation?.confidence ?? b.confidence ?? null)
                        : getCriterionValue(b, sortConfig.key);

            if (aValue === null || aValue === undefined) return 1;
            if (bValue === null || bValue === undefined) return -1;

            if (typeof aValue === 'string' && typeof bValue === 'string') {
                return sortConfig.direction === 'asc'
                    ? aValue.localeCompare(bValue)
                    : bValue.localeCompare(aValue);
            }

            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });

        return filterable;
    }, [evaluations, searchTerm, sortConfig]);

    const handleExportCSV = () => {
        if (!processedEvaluations || processedEvaluations.length === 0) return;

        const headers = [
            'Student Name', 'Submission', 'Overall Score (/100)', ...criterionNames, 'Confidence', 'Strengths', 'Mistakes', 'Missing Concepts', 'Feedback', 'Status'
        ];

        const csvRows = processedEvaluations.map((ev) => {
            const row = [
                ev.studentName || 'Unknown',
                ev.fileName || ev.file_name || 'N/A',
                getOverallScore(ev) ?? '—',
                ...criterionNames.map((criterionName) => {
                    const score = getCriterionValue(ev, criterionName);
                    return score === null ? '—' : score.toFixed(1);
                }),
                ev.aiEvaluation?.confidence ?? ev.confidence ?? '—',
                (ev.aiEvaluation?.strengths || ev.strengths || []).filter(Boolean).join('; '),
                (ev.aiEvaluation?.mistakes || ev.mistakes || []).filter(Boolean).join('; '),
                (ev.aiEvaluation?.missingConcepts || ev.missingConcepts || []).filter(Boolean).join('; '),
                ev.aiEvaluation?.overallFeedback || ev.overallFeedback || ev.feedback || '—',
                ev.evaluationStatus || 'COMPLETED'
            ];

            return row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',');
        });

        const blob = new Blob([[headers.join(','), ...csvRows].join('\n')], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().split('T')[0];
        link.setAttribute('href', url);
        link.setAttribute('download', `Assignment_Eval_${sessionMetadata?.topic || 'export'}_${timestamp}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
        setSortConfig({ key, direction });
    };

    if (status === 'UPLOADED' || status === 'EXTRACTING' || status === 'ANALYZING_TRANSCRIPT') {
        return (
            <div className="table-loading-state card">
                <h4>Pipeline Booting</h4>
                <p>Analyzing constraints... Standby to receive student flow.</p>
            </div>
        );
    }

    if (evaluations.length === 0 && status !== 'PENDING') {
        return (
            <div className="table-empty-state card">
                <h4>No Data</h4>
                <p>No successful evaluations have populated the session datastore yet.</p>
            </div>
        );
    }

    return (
        <div className="results-table-container card">
            <div className="table-toolbar">
                <input
                    type="text"
                    placeholder="Search by name, roll number, or file…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                />

                <button onClick={handleExportCSV} className="btn-secondary" disabled={evaluations.length === 0}>📥 Export CSV</button>
            </div>

            <div className="table-responsive">
                <table className="results-table">
                    <thead>
                        <tr>
                            <th onClick={() => handleSort('studentName')}>Student {sortConfig.key === 'studentName' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                            <th onClick={() => handleSort('score')} style={{ minWidth: '110px' }}>Overall {sortConfig.key === 'score' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                            {criterionNames.map((criterion) => (
                                <th key={criterion} onClick={() => handleSort(criterion)}>{criterion} {sortConfig.key === criterion && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                            ))}
                            <th onClick={() => handleSort('confidence')}>Confidence {sortConfig.key === 'confidence' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                            <th>Strengths</th>
                            <th>Mistakes</th>
                            <th>Missing Concepts</th>
                            <th>Feedback</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {processedEvaluations.map((ev) => (
                            <StudentRow key={ev._id || `${ev.studentName}-${ev.fileName}`} ev={ev} criterionNames={criterionNames} />
                        ))}
                    </tbody>
                </table>

                {processedEvaluations.length === 0 && (
                    <div className="table-no-matches">
                        <p>No students match the current search filters.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
