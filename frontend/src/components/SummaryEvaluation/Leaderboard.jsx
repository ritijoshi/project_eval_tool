import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useLeaderboardSocket } from '../../hooks/useLeaderboardSocket';
import {
    getLeaderboard,
    refreshLeaderboard,
    getStudentLeaderboardDetail,
} from '../../services/evaluationApi';
import './Leaderboard.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const METRIC_LABELS = {
    topicCoverage:          'Topic Coverage',
    conceptUnderstanding:   'Concept Understanding',
    technicalAccuracy:      'Technical Accuracy',
    clarityReadability:     'Clarity & Readability',
    completeness:           'Completeness',
    conciseness:            'Conciseness',
    logicalFlow:            'Logical Flow',
    keywordMatch:           'Keyword Match',
    criticalThinkingDepth:  'Critical Thinking',
    aiConfidence:           'AI Confidence',
};

const METRIC_COLORS = {
    topicCoverage:          'linear-gradient(90deg, #6366f1, #8b5cf6)',
    conceptUnderstanding:   'linear-gradient(90deg, #3b82f6, #60a5fa)',
    technicalAccuracy:      'linear-gradient(90deg, #c084fc, #e879f9)',
    clarityReadability:     'linear-gradient(90deg, #2dd4bf, #5eead4)',
    completeness:           'linear-gradient(90deg, #22c55e, #4ade80)',
    conciseness:            'linear-gradient(90deg, #f59e0b, #fbbf24)',
    logicalFlow:            'linear-gradient(90deg, #f97316, #fb923c)',
    keywordMatch:           'linear-gradient(90deg, #10b981, #34d399)',
    criticalThinkingDepth:  'linear-gradient(90deg, #ef4444, #f87171)',
    aiConfidence:           'linear-gradient(90deg, #8b5cf6, #a78bfa)',
};

const getScoreFillClass = (score) => {
    if (score === null || score === undefined) return '';
    if (score >= 8.5) return 'score-fill-excellent';
    if (score >= 7.0) return 'score-fill-good';
    if (score >= 5.5) return 'score-fill-average';
    if (score >= 4.0) return 'score-fill-below';
    return 'score-fill-poor';
};

const getRankClass = (rank) => {
    if (rank === 1) return 'gold-rank';
    if (rank === 2) return 'silver-rank';
    if (rank === 3) return 'bronze-rank';
    return 'plain-rank';
};

const getMedalEmoji = (rank) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return String(rank);
};

const fmt = (v) => (typeof v === 'number' ? v.toFixed(1) : 'N/A');

// ─── Score-bar component ───────────────────────────────────────────────────────

function ScoreBar({ score, maxScore = 10 }) {
    const pct = Math.min(100, Math.max(0, ((score ?? 0) / maxScore) * 100));
    return (
        <div className="lb-score-bar-track">
            <div
                className={`lb-score-bar-fill ${getScoreFillClass(score)}`}
                style={{ width: `${pct}%` }}
            />
        </div>
    );
}

// ─── Detail Drawer ─────────────────────────────────────────────────────────────

function DetailDrawer({ sessionId, evaluationId, colSpan }) {
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!sessionId || !evaluationId) return;
        setLoading(true);
        setError(null);
        getStudentLeaderboardDetail(sessionId, evaluationId)
            .then((res) => setDetail(res.detail || null))
            .catch((err) => setError(err.response?.data?.message || err.message || 'Failed to load details'))
            .finally(() => setLoading(false));
    }, [sessionId, evaluationId]);

    return (
        <tr className="lb-detail-row">
            <td colSpan={colSpan}>
                <div className="lb-detail-panel">
                    {loading && <div className="lb-detail-loading">⏳ Loading detailed analysis…</div>}
                    {error  && <div className="lb-detail-loading" style={{ color: '#f87171' }}>⚠️ {error}</div>}
                    {detail && !loading && (
                        <>
                            {/* Left col: metric breakdown bars */}
                            <div className="lb-detail-col">
                                <div>
                                    <div className="lb-detail-section-title">📊 Metric Breakdown</div>
                                    <div className="lb-metric-bars">
                                        {Object.entries(METRIC_LABELS).map(([key, label]) => {
                                            const m = detail.metrics?.[key];
                                            const score = m?.score ?? null;
                                            const reason = m?.reason || '';
                                            const pct = score !== null ? Math.min(100, (score / 10) * 100) : 0;
                                            return (
                                                <React.Fragment key={key}>
                                                    <div className="lb-metric-bar-row">
                                                        <span className="lb-metric-bar-label">{label}</span>
                                                        <div className="lb-metric-bar-track">
                                                            <div
                                                                className="lb-metric-bar-fill"
                                                                style={{
                                                                    width: score !== null ? `${pct}%` : '0%',
                                                                    background: METRIC_COLORS[key] || '#6366f1',
                                                                }}
                                                            />
                                                        </div>
                                                        <span className="lb-metric-bar-score">
                                                            {score !== null ? score.toFixed(1) : '—'}
                                                        </span>
                                                    </div>
                                                    {reason && (
                                                        <div className="lb-metric-bar-row lb-metric-reason" style={{ display: 'block', paddingLeft: '150px' }}>
                                                            {reason}
                                                        </div>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </div>
                                </div>

                                {detail.scoreBreakdown?.length > 0 && (
                                    <div>
                                        <div className="lb-detail-section-title">⚖️ Score Breakdown (Weighted)</div>
                                        <div className="lb-breakdown-bars">
                                            {detail.scoreBreakdown.map((item, i) => {
                                                const contribution = ((item.score ?? 0) * (item.weight ?? 0));
                                                const pct = Math.min(100, (contribution / 10) * 100);
                                                return (
                                                    <div key={`${item.metric}-${i}`} className="lb-breakdown-row">
                                                        <span className="lb-breakdown-label">{METRIC_LABELS[item.metric] || item.metric}</span>
                                                        <div className="lb-breakdown-bar-track">
                                                            <div className="lb-breakdown-bar-fill" style={{ width: `${pct}%` }} />
                                                        </div>
                                                        <span className="lb-breakdown-score-wt">
                                                            {fmt(item.score)} × {item.weight}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Right col: strengths, weaknesses, insights */}
                            <div className="lb-detail-col">
                                {detail.strengths?.length > 0 && (
                                    <div>
                                        <div className="lb-detail-section-title">✅ Strengths</div>
                                        <div className="lb-tag-list">
                                            {detail.strengths.map((s, i) => (
                                                <span key={i} className="lb-tag strength">{s}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {detail.weakAreas?.length > 0 && (
                                    <div>
                                        <div className="lb-detail-section-title">⚠️ Areas to Improve</div>
                                        <div className="lb-tag-list">
                                            {detail.weakAreas.map((w, i) => (
                                                <span key={i} className="lb-tag weakness">{w}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {detail.improvements?.length > 0 && (
                                    <div>
                                        <div className="lb-detail-section-title">💡 Suggestions</div>
                                        <div className="lb-tag-list">
                                            {detail.improvements.map((imp, i) => (
                                                <span key={i} className="lb-tag improvement">{imp}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {detail.scoreExplanation && (
                                    <div>
                                        <div className="lb-detail-section-title">🎯 Why This Score?</div>
                                        <div className="lb-score-explanation">{detail.scoreExplanation}</div>
                                    </div>
                                )}

                                {detail.summaryInsights && (
                                    <div>
                                        <div className="lb-detail-section-title">🤖 AI Summary Insights</div>
                                        <p className="lb-insights-text">{detail.summaryInsights}</p>
                                    </div>
                                )}

                                {detail.missingKeyPoints?.length > 0 && (
                                    <div>
                                        <div className="lb-detail-section-title">📌 Missing Key Points</div>
                                        <div className="lb-tag-list">
                                            {detail.missingKeyPoints.map((pt, i) => (
                                                <span key={i} className="lb-tag weakness">{pt}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </td>
        </tr>
    );
}

// ─── Podium Card ────────────────────────────────────────────────────────────────

function PodiumCard({ entry }) {
    const rankClass = ['rank-1', 'rank-2', 'rank-3'][entry.rank - 1];
    const medalClass = ['gold', 'silver', 'bronze'][entry.rank - 1];

    return (
        <div className={`lb-podium-card ${rankClass}`}>
            <div className={`lb-podium-medal ${medalClass}`}>{getMedalEmoji(entry.rank)}</div>
            <div className="lb-podium-name" title={entry.studentName}>{entry.studentName}</div>
            <div className="lb-podium-roll">{entry.rollNumber}</div>
            <div className="lb-podium-score">
                {entry.overallScore.toFixed(1)}<span> / 10</span>
            </div>
            <div className="lb-podium-percentile">Top {100 - entry.percentile + 1}%ile</div>
            {entry.badges.length > 0 && (
                <div className="lb-podium-badges">
                    {entry.badges.map((b, i) => (
                        <span key={i} className={`lb-badge ${b.color}`}>{b.icon} {b.label}</span>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Main Leaderboard Component ────────────────────────────────────────────────

export default function Leaderboard({ sessionId, evaluations, status }) {
    const [leaderboard, setLeaderboard] = useState([]);
    const [totalEvaluated, setTotalEvaluated] = useState(0);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortKey, setSortKey] = useState('rank');
    const [sortDir, setSortDir] = useState('asc');
    const [expandedId, setExpandedId] = useState(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [hasFetched, setHasFetched] = useState(false);

    // Live socket updates
    const socket = useLeaderboardSocket(sessionId);

    // On socket update, replace the leaderboard
    useEffect(() => {
        if (socket.liveLeaderboard.length > 0) {
            setLeaderboard(socket.liveLeaderboard);
            setTotalEvaluated(socket.totalEvaluated);
            setLastUpdated(socket.lastUpdated);
        }
    }, [socket.liveLeaderboard, socket.totalEvaluated, socket.lastUpdated]);

    // Initial REST fetch when session is completed or we have existing evaluations
    useEffect(() => {
        if (!sessionId || hasFetched) return;

        // Fetch if status is COMPLETED or if we have evaluations (page reload after completion)
        if (status === 'COMPLETED' || evaluations.length > 0) {
            setHasFetched(true);
            getLeaderboard(sessionId)
                .then((res) => {
                    if (res.leaderboard?.length > 0) {
                        setLeaderboard(res.leaderboard);
                        setTotalEvaluated(res.totalEvaluated ?? 0);
                        setLastUpdated(new Date());
                    }
                })
                .catch((err) => console.warn('Leaderboard initial fetch failed:', err.message));
        }
    }, [sessionId, status, evaluations.length, hasFetched]);

    // Re-fetch when evaluation completes
    useEffect(() => {
        if (status === 'COMPLETED' && sessionId) {
            getLeaderboard(sessionId)
                .then((res) => {
                    if (res.leaderboard?.length > 0) {
                        setLeaderboard(res.leaderboard);
                        setTotalEvaluated(res.totalEvaluated ?? 0);
                        setLastUpdated(new Date());
                    }
                })
                .catch(() => {});
        }
    }, [status, sessionId]);

    const handleRefresh = useCallback(async () => {
        if (!sessionId || isRefreshing) return;
        setIsRefreshing(true);
        try {
            const res = await refreshLeaderboard(sessionId);
            if (res.leaderboard?.length > 0) {
                setLeaderboard(res.leaderboard);
                setTotalEvaluated(res.totalEvaluated ?? 0);
                setLastUpdated(new Date());
            }
        } catch (err) {
            console.warn('Refresh failed:', err.message);
        } finally {
            setIsRefreshing(false);
        }
    }, [sessionId, isRefreshing]);

    const handleSort = (key) => {
        if (sortKey === key) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir(key === 'rank' ? 'asc' : 'desc');
        }
    };

    const SortArrow = ({ col }) => {
        if (sortKey !== col) return <span style={{ opacity: 0.3 }}> ↕</span>;
        return <span> {sortDir === 'asc' ? '↑' : '↓'}</span>;
    };

    // Filter + Sort
    const processed = useMemo(() => {
        let arr = [...leaderboard];

        if (searchTerm.trim()) {
            const lc = searchTerm.toLowerCase();
            arr = arr.filter(
                (e) =>
                    e.studentName.toLowerCase().includes(lc) ||
                    (e.rollNumber || '').toLowerCase().includes(lc)
            );
        }

        arr.sort((a, b) => {
            let av, bv;
            if (sortKey === 'rank') {
                av = a.rank; bv = b.rank;
            } else if (sortKey === 'overallScore') {
                av = a.overallScore ?? -1; bv = b.overallScore ?? -1;
            } else if (sortKey === 'studentName') {
                av = a.studentName; bv = b.studentName;
            } else {
                av = a.metrics?.[sortKey] ?? -1;
                bv = b.metrics?.[sortKey] ?? -1;
            }
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });

        return arr;
    }, [leaderboard, searchTerm, sortKey, sortDir]);

    const podiumEntries = useMemo(() => leaderboard.filter((e) => e.rank <= 3).slice(0, 3), [leaderboard]);

    // Stats
    const avgScore = useMemo(() => {
        if (!leaderboard.length) return 0;
        const s = leaderboard.reduce((acc, e) => acc + e.overallScore, 0);
        return (s / leaderboard.length).toFixed(1);
    }, [leaderboard]);

    const topScore = leaderboard[0]?.overallScore?.toFixed(1) ?? '—';
    const isSessionRunning = !['COMPLETED', 'FAILED'].includes(status);

    // ── Empty state while pipeline is still running or no ranked data
    if (leaderboard.length === 0) {
        return (
            <div className="lb-empty-state">
                <div className="lb-empty-icon">📊</div>
                <div className="lb-empty-title">
                    {isSessionRunning ? 'Leaderboard Generating…' : 'No Ranked Students Yet'}
                </div>
                <p className="lb-empty-desc">
                    {isSessionRunning
                        ? 'Rankings will appear automatically as evaluations complete. Live updates are active.'
                        : 'No valid, non-fallback evaluations were found for this session. Ensure the AI pipeline completed successfully.'}
                </p>
            </div>
        );
    }

    const totalCols = 9; // rank + name + score + percentile + badges + 4 metrics + action

    return (
        <div className="leaderboard-wrap">
            {/* ── Header ── */}
            <div className="lb-header">
                <div className="lb-title-group">
                    <span className="lb-crown-icon">🏆</span>
                    <div>
                        <h3 className="lb-title">Student Leaderboard</h3>
                        <p className="lb-subtitle">AI-driven rankings based on deterministic weighted scores</p>
                    </div>
                </div>
                <div className="lb-actions">
                    {(socket.isLive || isSessionRunning) && (
                        <span className="lb-live-dot">LIVE</span>
                    )}
                    <button
                        className="lb-refresh-btn"
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        title="Recompute and broadcast leaderboard"
                    >
                        <span className={isRefreshing ? 'spin' : ''}>↻</span>
                        {isRefreshing ? 'Refreshing…' : 'Refresh'}
                    </button>
                </div>
            </div>

            {/* ── Stats strip ── */}
            <div className="lb-stats-strip">
                <div className="lb-stat-card">
                    <span className="lb-stat-value">{totalEvaluated || leaderboard.length}</span>
                    <span className="lb-stat-label">Students Ranked</span>
                </div>
                <div className="lb-stat-card">
                    <span className="lb-stat-value">{topScore}</span>
                    <span className="lb-stat-label">Top Score</span>
                </div>
                <div className="lb-stat-card">
                    <span className="lb-stat-value">{avgScore}</span>
                    <span className="lb-stat-label">Session Average</span>
                </div>
                <div className="lb-stat-card">
                    <span className="lb-stat-value">
                        {lastUpdated
                            ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                            : '—'}
                    </span>
                    <span className="lb-stat-label">Last Updated</span>
                </div>
            </div>

            {/* ── Podium (top 3) ── */}
            {podiumEntries.length > 0 && (
                <div className="lb-podium-section">
                    <div className="lb-section-label">🎖 Top Performers</div>
                    <div className="lb-podium">
                        {/* Reorder visually: 2nd – 1st – 3rd */}
                        {podiumEntries.length >= 2 && <PodiumCard entry={podiumEntries[1]} />}
                        {podiumEntries.length >= 1 && <PodiumCard entry={podiumEntries[0]} />}
                        {podiumEntries.length >= 3 && <PodiumCard entry={podiumEntries[2]} />}
                    </div>
                </div>
            )}

            {/* ── Full ranked table ── */}
            <div className="lb-table-section">
                <div className="lb-toolbar">
                    <input
                        type="text"
                        className="lb-search"
                        placeholder="Search by name or roll number…"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {lastUpdated && (
                        <span className="lb-last-updated">
                            Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    )}
                </div>

                <div className="lb-table-scroll">
                    <table className="lb-table">
                        <thead>
                            <tr>
                                <th className={sortKey === 'rank' ? 'sorted' : ''} onClick={() => handleSort('rank')}>
                                    Rank<SortArrow col="rank" />
                                </th>
                                <th className={sortKey === 'studentName' ? 'sorted' : ''} onClick={() => handleSort('studentName')}>
                                    Student<SortArrow col="studentName" />
                                </th>
                                <th className={sortKey === 'overallScore' ? 'sorted' : ''} onClick={() => handleSort('overallScore')}>
                                    Score<SortArrow col="overallScore" />
                                </th>
                                <th>Percentile</th>
                                <th className={sortKey === 'topicCoverage' ? 'sorted' : ''} onClick={() => handleSort('topicCoverage')}>
                                    Coverage<SortArrow col="topicCoverage" />
                                </th>
                                <th className={sortKey === 'technicalAccuracy' ? 'sorted' : ''} onClick={() => handleSort('technicalAccuracy')}>
                                    Accuracy<SortArrow col="technicalAccuracy" />
                                </th>
                                <th className={sortKey === 'clarityReadability' ? 'sorted' : ''} onClick={() => handleSort('clarityReadability')}>
                                    Clarity<SortArrow col="clarityReadability" />
                                </th>
                                <th className={sortKey === 'criticalThinkingDepth' ? 'sorted' : ''} onClick={() => handleSort('criticalThinkingDepth')}>
                                    Critical<SortArrow col="criticalThinkingDepth" />
                                </th>
                                <th>Analysis</th>
                            </tr>
                        </thead>
                        <tbody>
                            {processed.map((entry) => {
                                const isExpanded = expandedId === entry.evaluationId;
                                return (
                                    <React.Fragment key={entry.evaluationId}>
                                        <tr>
                                            {/* Rank */}
                                            <td className="lb-rank-cell">
                                                <span className={`lb-rank-num ${getRankClass(entry.rank)}`}>
                                                    {getMedalEmoji(entry.rank)}
                                                </span>
                                            </td>

                                            {/* Name */}
                                            <td className="lb-name-cell">
                                                <div className="lb-student-name">{entry.studentName}</div>
                                                <div className="lb-student-roll">{entry.rollNumber}</div>
                                            </td>

                                            {/* Score + bar */}
                                            <td className="lb-score-cell">
                                                <div className="lb-score-val">{entry.overallScore.toFixed(1)} <small style={{ fontSize: '0.68rem', opacity: 0.6 }}>/10</small></div>
                                                <ScoreBar score={entry.overallScore} />
                                            </td>

                                            {/* Percentile */}
                                            <td>
                                                <span className="lb-percentile-chip">P{entry.percentile}</span>
                                            </td>

                                            {/* Metrics */}
                                            <td>
                                                <span className={`lb-metric-val ${entry.metrics.topicCoverage === null ? 'na' : ''}`}>
                                                    {fmt(entry.metrics.topicCoverage)}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={`lb-metric-val ${entry.metrics.technicalAccuracy === null ? 'na' : ''}`}>
                                                    {fmt(entry.metrics.technicalAccuracy)}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={`lb-metric-val ${entry.metrics.clarityReadability === null ? 'na' : ''}`}>
                                                    {fmt(entry.metrics.clarityReadability)}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={`lb-metric-val ${entry.metrics.criticalThinkingDepth === null ? 'na' : ''}`}>
                                                    {fmt(entry.metrics.criticalThinkingDepth)}
                                                </span>
                                            </td>

                                            {/* Expand */}
                                            <td>
                                                <button
                                                    className={`lb-expand-btn ${isExpanded ? 'active' : ''}`}
                                                    onClick={() => setExpandedId(isExpanded ? null : entry.evaluationId)}
                                                    title={isExpanded ? 'Collapse analysis' : 'View detailed analysis'}
                                                >
                                                    {isExpanded ? '▲ Hide' : '▼ Analyse'}
                                                </button>
                                            </td>
                                        </tr>

                                        {/* Badges row */}
                                        {entry.badges.length > 0 && (
                                            <tr style={{ background: 'transparent' }}>
                                                <td />
                                                <td colSpan={totalCols - 1} style={{ paddingTop: 0, paddingBottom: '10px' }}>
                                                    <div className="lb-badges-cell">
                                                        {entry.badges.map((b, i) => (
                                                            <span key={i} className={`lb-badge ${b.color}`}>{b.icon} {b.label}</span>
                                                        ))}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}

                                        {/* Detail drawer */}
                                        {isExpanded && (
                                            <DetailDrawer
                                                sessionId={sessionId}
                                                evaluationId={entry.evaluationId}
                                                colSpan={totalCols}
                                            />
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>

                    {processed.length === 0 && (
                        <div className="lb-empty-state" style={{ padding: '32px 24px' }}>
                            <div className="lb-empty-icon" style={{ fontSize: '1.8rem' }}>🔍</div>
                            <div className="lb-empty-title">No matches</div>
                            <p className="lb-empty-desc">No students match "{searchTerm}"</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
