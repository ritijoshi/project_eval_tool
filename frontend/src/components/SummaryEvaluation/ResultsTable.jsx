import React, { useState, useMemo } from 'react';
import StudentRow from './StudentRow';
import './ResultsTable.css';

export default function ResultsTable({ evaluations, status, sessionMetadata }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'score', direction: 'desc' });

    // 1. Immutable Filtering & Sorting driven by useMemo
    const processedEvaluations = useMemo(() => {
        let filterable = [...evaluations];

        // Search filtering (roll number or name)
        if (searchTerm) {
            const lowerTerm = searchTerm.toLowerCase();
            filterable = filterable.filter(ev =>
                ev.studentName.toLowerCase().includes(lowerTerm) ||
                ev.rollNumber.toLowerCase().includes(lowerTerm)
            );
        }

        // Sorting
        filterable.sort((a, b) => {
            if (a[sortConfig.key] < b[sortConfig.key]) {
                return sortConfig.direction === 'asc' ? -1 : 1;
            }
            if (a[sortConfig.key] > b[sortConfig.key]) {
                return sortConfig.direction === 'asc' ? 1 : -1;
            }
            return 0;
        });

        return filterable;
    }, [evaluations, searchTerm, sortConfig]);

    // 2. Client-Side CSV Export (Server bandwidth saving)
    const handleExportCSV = () => {
        if (!processedEvaluations || processedEvaluations.length === 0) return;

        // Header mapping
        const headers = [
            'Student Name', 'Roll Number', 'Score (/10)',
            'Similarity Metric', 'Coverage Metric', 'Completeness Metric',
            'Feedback', 'Status'
        ];

        // Rows processing
        const csvRows = processedEvaluations.map(ev => {
            const sim = ev.metrics?.similarity ? (ev.metrics.similarity * 100).toFixed(1) + '%' : 'N/A';
            const cov = ev.metrics?.coverage ? (ev.metrics.coverage * 100).toFixed(1) + '%' : 'N/A';
            const len = ev.metrics?.completeness ? (ev.metrics.completeness * 100).toFixed(1) + '%' : 'N/A';

            // Re-escape feedback strings which may contain commas in english grammar
            const safeFeedback = `"${(ev.feedback || '').replace(/"/g, '""')}"`;

            return [
                ev.studentName, ev.rollNumber, ev.score || 0,
                sim, cov, len, safeFeedback, ev.evaluationStatus
            ].join(',');
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
                    placeholder="Search Name or Roll Number..."
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
                            <th onClick={() => handleSort('rollNumber')}>Roll Number {sortConfig.key === 'rollNumber' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                            <th onClick={() => handleSort('score')} style={{ minWidth: '80px' }}>Score {sortConfig.key === 'score' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                            <th>Explainability Metrics</th>
                            <th>Qualitative Feedback</th>
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
