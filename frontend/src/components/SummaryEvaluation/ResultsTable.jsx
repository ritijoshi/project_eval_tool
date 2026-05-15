import React, { useState, useMemo } from 'react';
import StudentRow from './StudentRow';
import './ResultsTable.css';

export default function ResultsTable({ evaluations, status, sessionMetadata }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'score', direction: 'desc' });

    const getOverallScore = (ev) => {
        const overall = ev.aiEvaluation?.overallScore;
        if (typeof overall === 'number') return overall;
        if (typeof ev.score === 'number') return ev.score;
        return null;
    };

    const getAiScore = (ev, key, fallbackScore = null) => {
        const metric = ev.aiEvaluation?.metrics?.[key];
        if (metric && typeof metric.score === 'number') return metric.score;
        if (typeof fallbackScore === 'number') return fallbackScore;
        return null;
    };

    // 1. Immutable Filtering & Sorting driven by useMemo
    const processedEvaluations = useMemo(() => {
        let filterable = [...evaluations];

        // Search filtering (name)
        if (searchTerm) {
            const lowerTerm = searchTerm.toLowerCase();
            filterable = filterable.filter(ev =>
                ev.studentName.toLowerCase().includes(lowerTerm)
            );
        }

        // Sorting
        filterable.sort((a, b) => {
            const aValue = (() => {
                switch (sortConfig.key) {
                    case 'topicCoverage':
                        return getAiScore(a, 'topicCoverage', (a.metrics?.coverage ?? null) * 10);
                    case 'clarityReadability':
                        return getAiScore(a, 'clarityReadability', (a.metrics?.clarity ?? null) * 10);
                    case 'technicalAccuracy':
                        return getAiScore(a, 'technicalAccuracy', (a.metrics?.similarity ?? null) * 10);
                    case 'completeness':
                        return getAiScore(a, 'completeness', (a.metrics?.completeness ?? null) * 10);
                    case 'logicalFlow':
                        return getAiScore(a, 'logicalFlow');
                    case 'criticalThinkingDepth':
                        return getAiScore(a, 'criticalThinkingDepth');
                    case 'aiConfidence':
                        return getAiScore(a, 'aiConfidence');
                    case 'score':
                        return getOverallScore(a);
                    default:
                        return a[sortConfig.key];
                }
            })();

            const bValue = (() => {
                switch (sortConfig.key) {
                    case 'topicCoverage':
                        return getAiScore(b, 'topicCoverage', (b.metrics?.coverage ?? null) * 10);
                    case 'clarityReadability':
                        return getAiScore(b, 'clarityReadability', (b.metrics?.clarity ?? null) * 10);
                    case 'technicalAccuracy':
                        return getAiScore(b, 'technicalAccuracy', (b.metrics?.similarity ?? null) * 10);
                    case 'completeness':
                        return getAiScore(b, 'completeness', (b.metrics?.completeness ?? null) * 10);
                    case 'logicalFlow':
                        return getAiScore(b, 'logicalFlow');
                    case 'criticalThinkingDepth':
                        return getAiScore(b, 'criticalThinkingDepth');
                    case 'aiConfidence':
                        return getAiScore(b, 'aiConfidence');
                    case 'score':
                        return getOverallScore(b);
                    default:
                        return b[sortConfig.key];
                }
            })();

            if (aValue === null || aValue === undefined) return 1;
            if (bValue === null || bValue === undefined) return -1;

            if (aValue < bValue) {
                return sortConfig.direction === 'asc' ? -1 : 1;
            }
            if (aValue > bValue) {
                return sortConfig.direction === 'asc' ? 1 : -1;
            }
            return 0;
        });

        return filterable;
    }, [evaluations, searchTerm, sortConfig]);

    // 2. Client-Side CSV Export (Server bandwidth saving)
    const handleExportCSV = () => {
        if (!processedEvaluations || processedEvaluations.length === 0) return;

        const headers = [
            'Student Name', 'Overall Score (/10)',
            'Topic Coverage', 'Concept Understanding', 'Clarity & Readability',
            'Technical Accuracy', 'Completeness', 'Conciseness',
            'Logical Flow', 'Keyword Match', 'Critical Thinking Depth',
            'AI Confidence',
            'Topic Coverage Reason', 'Concept Understanding Reason', 'Clarity Reason',
            'Accuracy Reason', 'Completeness Reason', 'Conciseness Reason',
            'Flow Reason', 'Keyword Match Reason', 'Critical Thinking Reason',
            'Confidence Reason',
            'Strengths', 'Weak Areas', 'Improvements',
            'Summary Insights', 'Missing Key Points', 'Concepts Covered',
            'Score Explanation', 'AI Fallback Used', 'Feedback', 'Status'
        ];

        // Rows processing
        const csvRows = processedEvaluations.map(ev => {
            const aiMetrics = ev.aiEvaluation?.metrics || {};
            const scoreOrNA = (value) => (typeof value === 'number' ? value.toFixed(1) : 'N/A');
            const listOrNA = (items = []) => (items.length ? items.join('\n') : 'N/A');
            const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

            const row = [
                csvEscape(ev.studentName),
                csvEscape(getOverallScore(ev) ?? 0),
                csvEscape(scoreOrNA(aiMetrics.topicCoverage?.score ?? (ev.metrics?.coverage ?? null) * 10)),
                csvEscape(scoreOrNA(aiMetrics.conceptUnderstanding?.score ?? (ev.metrics?.similarity ?? null) * 10)),
                csvEscape(scoreOrNA(aiMetrics.clarityReadability?.score ?? (ev.metrics?.clarity ?? null) * 10)),
                csvEscape(scoreOrNA(aiMetrics.technicalAccuracy?.score ?? (ev.metrics?.similarity ?? null) * 10)),
                csvEscape(scoreOrNA(aiMetrics.completeness?.score ?? (ev.metrics?.completeness ?? null) * 10)),
                csvEscape(scoreOrNA(aiMetrics.conciseness?.score)),
                csvEscape(scoreOrNA(aiMetrics.logicalFlow?.score)),
                csvEscape(scoreOrNA(aiMetrics.keywordMatch?.score ?? (ev.metrics?.coverage ?? null) * 10)),
                csvEscape(scoreOrNA(aiMetrics.criticalThinkingDepth?.score)),
                csvEscape(scoreOrNA(aiMetrics.aiConfidence?.score)),
                csvEscape(aiMetrics.topicCoverage?.reason || ''),
                csvEscape(aiMetrics.conceptUnderstanding?.reason || ''),
                csvEscape(aiMetrics.clarityReadability?.reason || ''),
                csvEscape(aiMetrics.technicalAccuracy?.reason || ''),
                csvEscape(aiMetrics.completeness?.reason || ''),
                csvEscape(aiMetrics.conciseness?.reason || ''),
                csvEscape(aiMetrics.logicalFlow?.reason || ''),
                csvEscape(aiMetrics.keywordMatch?.reason || ''),
                csvEscape(aiMetrics.criticalThinkingDepth?.reason || ''),
                csvEscape(aiMetrics.aiConfidence?.reason || ''),
                csvEscape(listOrNA(ev.aiEvaluation?.strengths || [])),
                csvEscape(listOrNA(ev.aiEvaluation?.weakAreas || [])),
                csvEscape(listOrNA(ev.aiEvaluation?.improvements || [])),
                csvEscape(ev.aiEvaluation?.summaryInsights || ''),
                csvEscape(listOrNA(ev.aiEvaluation?.missingKeyPoints || [])),
                csvEscape(listOrNA(ev.aiEvaluation?.conceptsCovered || [])),
                csvEscape(ev.aiEvaluation?.scoreExplanation || ''),
                csvEscape(ev.aiEvaluation?.fallback ? 'Yes' : 'No'),
                csvEscape(ev.feedback || ''),
                csvEscape(ev.evaluationStatus)
            ];
            return row.join(',');
        });

        const csvContent = [headers.join(','), ...csvRows].join('\n');

        // Native browser blob attachment
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);

        const timestamp = new Date().toISOString().split('T')[0];
        link.setAttribute("href", url);
        link.setAttribute("download", `Lecture_Eval_${sessionMetadata?.topic || 'export'}_${timestamp}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    // 3. UI Zero States
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
                    placeholder="Search Name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                />

                <button
                    onClick={handleExportCSV}
                    className="btn-secondary"
                    disabled={evaluations.length === 0}
                >
                    📥 Export CSV
                </button>
            </div>

            <div className="table-responsive">
                <table className="results-table">
                    <thead>
                        <tr>
                            <th onClick={() => handleSort('studentName')}>Student {sortConfig.key === 'studentName' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                            <th onClick={() => handleSort('score')} style={{ minWidth: '100px' }}>Overall {sortConfig.key === 'score' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                            <th onClick={() => handleSort('topicCoverage')}>Coverage {sortConfig.key === 'topicCoverage' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                            <th onClick={() => handleSort('clarityReadability')}>Clarity {sortConfig.key === 'clarityReadability' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                            <th onClick={() => handleSort('technicalAccuracy')}>Accuracy {sortConfig.key === 'technicalAccuracy' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                            <th onClick={() => handleSort('completeness')}>Complete {sortConfig.key === 'completeness' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                            <th onClick={() => handleSort('logicalFlow')}>Flow {sortConfig.key === 'logicalFlow' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                            <th onClick={() => handleSort('criticalThinkingDepth')}>Critical {sortConfig.key === 'criticalThinkingDepth' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                            <th onClick={() => handleSort('aiConfidence')}>Confidence {sortConfig.key === 'aiConfidence' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                            <th>Strengths</th>
                            <th>Weak Areas</th>
                            <th>Improvements</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {/* Requirement 1: Usage of deterministic _id as React key */}
                        {processedEvaluations.map(ev => (
                            <StudentRow key={ev._id} ev={ev} />
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
