import React, { useState, useEffect } from 'react';
import UploadPanel from '../components/SummaryEvaluation/UploadPanel';
import ProgressTracker from '../components/SummaryEvaluation/ProgressTracker';
import EvaluationStats from '../components/SummaryEvaluation/EvaluationStats';
import ResultsTable from '../components/SummaryEvaluation/ResultsTable';
import Leaderboard from '../components/SummaryEvaluation/Leaderboard';
import { useEvaluationSocket } from '../hooks/useEvaluationSocket';
import { startEvaluation, getEvaluationResults } from '../services/evaluationApi';
import './SummaryEvaluation.css';

export default function SummaryEvaluation() {
    const [sessionId, setSessionId] = useState(() => localStorage.getItem('evalSessionId') || null);
    const [evaluations, setEvaluations] = useState([]);
    const [sessionMetadata, setSessionMetadata] = useState(null);
    const [globalError, setGlobalError] = useState(null);
    const [isFetchingFinal, setIsFetchingFinal] = useState(false);
    const [viewMode, setViewMode] = useState('table'); // 'table' | 'leaderboard'

    // 1. Transient Socket Telemetry hook
    const socket = useEvaluationSocket(sessionId);

    // 2. Session Persistence / Recovery
    useEffect(() => {
        if (sessionId) {
            localStorage.setItem('evalSessionId', sessionId);
        } else {
            localStorage.removeItem('evalSessionId');
        }
    }, [sessionId]);

    // 3. Final Auth Data Fetching
    useEffect(() => {
        const fetchFinalData = async () => {
            if (isFetchingFinal) return;
            if (socket.isCompleted && sessionId) {
                setIsFetchingFinal(true);
                try {
                    const result = await getEvaluationResults(sessionId);
                    if (result && result.evaluations) {
                        setEvaluations(result.evaluations);
                    }
                } catch (err) {
                    setGlobalError('Failed to load final results from server.');
                } finally {
                    setIsFetchingFinal(false);
                }

            }

        }

        fetchFinalData();
    }, [socket.isCompleted, sessionId]);

    // Auto-switch to leaderboard tab when evaluation completes
    useEffect(() => {
        if (socket.isCompleted) {
            setViewMode('leaderboard');
        }
    }, [socket.isCompleted]);

    // Dynamic array for Stats: Combine the REST backup with Transient websocket rows
    const displayEvaluations = socket.isCompleted && evaluations.length > 0
        ? evaluations
        : socket.recentResults;

    const handleStartJob = async (lectureTopic, transcript, zip) => {
        setGlobalError(null);
        setEvaluations([]);
        setSessionMetadata({ topic: lectureTopic });
        setViewMode('table');

        try {
            // Hardcoded strictly to 'all' as requested since it's a general feature
            const response = await startEvaluation(null, lectureTopic, transcript, zip);;
            setSessionId(response.sessionId);
        } catch (err) {
            setGlobalError(err.response?.data?.message || err.message || 'Failed to start AI Pipeline');
        }
    };

    const handleClearSession = () => {
        if (socket.status === 'EXTRACTING' || socket.status === 'EVALUATING' || socket.status === 'ANALYZING_TRANSCRIPT') {
            const warning = window.confirm("A job is currently running. If you clear the session, the pipeline will continue in the background but you will lose live updates until you reload the history. Proceed?");
            if (!warning) return;
        }
        setSessionId(null);
        setEvaluations([]);
        setGlobalError(null);
        setViewMode('table');
    };

    return (
        <div className="summary-evaluation-container">
            <div className="header-row">
                <div>
                    <h2>AI Batch Summary Evaluator</h2>
                    <p className="subtitle">Upload student summaries &amp; lecture transcripts for automated AI grading.</p>
                </div>
                {sessionId && (
                    <button className="btn-secondary danger-hover" onClick={handleClearSession}>
                        Clear Active Session
                    </button>
                )}
            </div>

            {globalError && (
                <div className="global-error-boundary">
                    ⚠️ {globalError}
                </div>
            )}

            {!sessionId ? (
                <UploadPanel onStartEvaluation={handleStartJob} />
            ) : (
                <div className="pipeline-dashboard">
                    <ProgressTracker
                        progress={socket.progress}
                        status={socket.status}
                        processedStudents={socket.processedStudents}
                        totalStudents={socket.totalStudents}
                        error={socket.error}
                    />

                    {socket.status !== 'FAILED' && (
                        <>
                            <EvaluationStats
                                evaluations={displayEvaluations}
                                totalStudents={socket.totalStudents}
                                status={socket.status}
                            />

                            {/* View mode toggle */}
                            <div className="eval-view-toggle">
                                <button
                                    className={`eval-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
                                    onClick={() => setViewMode('table')}
                                >
                                    📋 Results Table
                                </button>
                                <button
                                    className={`eval-toggle-btn ${viewMode === 'leaderboard' ? 'active' : ''}`}
                                    onClick={() => setViewMode('leaderboard')}
                                >
                                    🏆 Leaderboard
                                </button>
                            </div>

                            {viewMode === 'table' ? (
                                <ResultsTable
                                    evaluations={displayEvaluations}
                                    status={socket.status}
                                    sessionMetadata={sessionMetadata}
                                />
                            ) : (
                                <Leaderboard
                                    sessionId={sessionId}
                                    evaluations={displayEvaluations}
                                    status={socket.status}
                                />
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
