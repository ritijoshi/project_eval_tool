import React, { useState, useEffect, useCallback } from 'react';
import {
  Trophy,
  Award,
  TrendingUp,
  ShieldCheck,
  ShieldAlert,
  Users,
  ChevronRight,
  RotateCcw,
  Loader2,
  ExternalLink,
  Github,
} from 'lucide-react';
import { getProjectLeaderboard } from '../../services/projectEvalApi';
import ProjectHealthBadge from './ProjectHealthBadge';

export const ProjectLeaderboard = ({
  sessionId,
  leaderboard: propLeaderboard,
  healthBreakdown: propHealthBreakdown,
  totalEvaluated: propTotalEvaluated,
  sessionLabel = 'Project Evaluation',
  loading: propLoading = false,
  onSelectProject,
  onRefresh,
}) => {
  const [internalLeaderboard, setInternalLeaderboard] = useState([]);
  const [internalHealthBreakdown, setInternalHealthBreakdown] = useState(null);
  const [internalTotal, setInternalTotal] = useState(0);
  const [internalLoading, setInternalLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchLeaderboard = useCallback(async () => {
    if (!sessionId) return;
    setInternalLoading(true);
    setError(null);
    try {
      const data = await getProjectLeaderboard(sessionId);
      if (data && data.success) {
        setInternalLeaderboard(Array.isArray(data.leaderboard) ? data.leaderboard : []);
        setInternalHealthBreakdown(data.healthBreakdown || null);
        setInternalTotal(data.totalEvaluated || 0);
      }
    } catch (err) {
      console.error('Failed to fetch project leaderboard:', err);
      setError(err.response?.data?.message || err.message || 'Failed to load leaderboard.');
    } finally {
      setInternalLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    // If props are passed, use them; otherwise fetch using sessionId
    if (propLeaderboard) {
      setInternalLeaderboard(propLeaderboard);
      if (propHealthBreakdown) setInternalHealthBreakdown(propHealthBreakdown);
      if (typeof propTotalEvaluated === 'number') setInternalTotal(propTotalEvaluated);
    } else if (sessionId) {
      fetchLeaderboard();
    }
  }, [propLeaderboard, propHealthBreakdown, propTotalEvaluated, sessionId, fetchLeaderboard]);

  const activeLeaderboard = propLeaderboard || internalLeaderboard;
  const activeTotal = typeof propTotalEvaluated === 'number' ? propTotalEvaluated : internalTotal;
  const activeHealth = propHealthBreakdown || internalHealthBreakdown;
  const isLoading = propLoading || internalLoading;

  // Compute aggregate statistics
  const scores = activeLeaderboard
    .map((e) => e.overallScore)
    .filter((s) => typeof s === 'number' && Number.isFinite(s));

  const avgScore = scores.length
    ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
    : 0;
  const highScore = scores.length ? Math.max(...scores) : 0;

  const handleReload = () => {
    if (onRefresh) {
      onRefresh();
    } else if (sessionId) {
      fetchLeaderboard();
    }
  };

  if (isLoading) {
    return (
      <div
        style={{
          borderRadius: 14,
          background: 'rgba(15,23,42,0.85)',
          border: '1px solid rgba(99,102,241,0.2)',
          padding: '3rem 1.5rem',
          textAlign: 'center',
          color: '#94a3b8',
        }}
      >
        <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto 12px', color: '#818cf8' }} />
        <p style={{ margin: 0, fontSize: '0.9rem', color: '#cbd5e1' }}>Loading ranked project leaderboard…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          borderRadius: 14,
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)',
          padding: '1.5rem',
          textAlign: 'center',
          color: '#f87171',
        }}
      >
        <p style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>{error}</p>
        <button
          type="button"
          onClick={handleReload}
          className="btn-secondary"
          style={{ fontSize: '0.78rem', padding: '4px 12px' }}
        >
          <RotateCcw size={12} /> Retry
        </button>
      </div>
    );
  }

  if (!activeLeaderboard || activeLeaderboard.length === 0) {
    return (
      <div
        style={{
          borderRadius: 14,
          background: 'rgba(15,23,42,0.85)',
          border: '1px solid rgba(99,102,241,0.2)',
          padding: '3rem 1.5rem',
          textAlign: 'center',
          color: '#64748b',
        }}
      >
        <Trophy size={36} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
        <p style={{ margin: '0 0 4px', fontSize: '0.92rem', color: '#94a3b8' }}>
          No ranked projects available.
        </p>
        <p style={{ margin: 0, fontSize: '0.78rem' }}>
          Once project evaluations complete, rankings, percentiles, and badges will appear here.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      {/* ─── Metric Cards ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
        }}
      >
        {/* Total Evaluated */}
        <div
          style={{
            padding: '1rem',
            borderRadius: 12,
            background: 'rgba(15,23,42,0.85)',
            border: '1px solid rgba(99,102,241,0.2)',
          }}
        >
          <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 500 }}>
            EVALUATED PROJECTS
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span style={{ color: '#f8fafc', fontSize: '1.4rem', fontWeight: 700 }}>
              {activeTotal || activeLeaderboard.length}
            </span>
            <span style={{ color: '#64748b', fontSize: '0.75rem' }}>ranked</span>
          </div>
        </div>

        {/* Average Score */}
        <div
          style={{
            padding: '1rem',
            borderRadius: 12,
            background: 'rgba(15,23,42,0.85)',
            border: '1px solid rgba(99,102,241,0.2)',
          }}
        >
          <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 500 }}>
            AVERAGE SCORE
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span style={{ color: '#818cf8', fontSize: '1.4rem', fontWeight: 700 }}>
              {avgScore}
            </span>
            <span style={{ color: '#64748b', fontSize: '0.75rem' }}>/ 100</span>
          </div>
        </div>

        {/* Highest Score */}
        <div
          style={{
            padding: '1rem',
            borderRadius: 12,
            background: 'rgba(15,23,42,0.85)',
            border: '1px solid rgba(99,102,241,0.2)',
          }}
        >
          <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 500 }}>
            HIGHEST SCORE
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span style={{ color: '#4ade80', fontSize: '1.4rem', fontWeight: 700 }}>
              {highScore}
            </span>
            <span style={{ color: '#64748b', fontSize: '0.75rem' }}>/ 100</span>
          </div>
        </div>

        {/* Health Breakdown */}
        {activeHealth && (
          <div
            style={{
              padding: '1rem',
              borderRadius: 12,
              background: 'rgba(15,23,42,0.85)',
              border: '1px solid rgba(99,102,241,0.2)',
            }}
          >
            <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 500 }}>
              PROJECT HEALTH
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <span style={{ color: '#4ade80', fontSize: '0.82rem', fontWeight: 600 }}>
                {activeHealth.onTrack || 0} On Track
              </span>
              <span style={{ color: '#fbbf24', fontSize: '0.82rem', fontWeight: 600 }}>
                {activeHealth.atRisk || 0} At Risk
              </span>
              <span style={{ color: '#f87171', fontSize: '0.82rem', fontWeight: 600 }}>
                {activeHealth.behind || 0} Behind
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ─── Leaderboard Table ─────────────────────────────────────────────────── */}
      <div
        style={{
          borderRadius: 14,
          background: 'rgba(15,23,42,0.9)',
          border: '1px solid rgba(99,102,241,0.2)',
          overflow: 'hidden',
        }}
        className="shadow-xl"
      >
        {/* Header */}
        <div
          style={{
            padding: '1rem 1.25rem',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(168,85,247,0.08))',
            borderBottom: '1px solid rgba(99,102,241,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Trophy size={18} style={{ color: '#fde047' }} />
            <h4 style={{ margin: 0, color: '#f8fafc', fontSize: '0.98rem', fontWeight: 700 }}>
              Project Leaderboard — {sessionLabel}
            </h4>
          </div>

          <button
            type="button"
            onClick={handleReload}
            className="btn-secondary"
            style={{ fontSize: '0.74rem', padding: '3px 10px' }}
          >
            <RotateCcw size={11} /> Refresh
          </button>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', color: '#cbd5e1' }}>
            <thead>
              <tr
                style={{
                  background: 'rgba(30,41,59,0.7)',
                  borderBottom: '1px solid rgba(99,102,241,0.2)',
                  color: '#94a3b8',
                  fontSize: '0.74rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  textAlign: 'left',
                }}
              >
                <th style={{ padding: '0.75rem 1rem', width: 60 }}>Rank</th>
                <th style={{ padding: '0.75rem 1rem' }}>Team / Student</th>
                <th style={{ padding: '0.75rem 1rem' }}>Repository</th>
                <th style={{ padding: '0.75rem 1rem' }}>Overall Score</th>
                <th style={{ padding: '0.75rem 1rem' }}>Percentile</th>
                <th style={{ padding: '0.75rem 1rem' }}>Health</th>
                <th style={{ padding: '0.75rem 1rem' }}>Badges</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {activeLeaderboard.map((entry, idx) => {
                const rank = entry.rank || idx + 1;
                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;

                return (
                  <tr
                    key={entry.resultId || idx}
                    onClick={() => onSelectProject && onSelectProject(entry)}
                    style={{
                      borderBottom: '1px solid rgba(99,102,241,0.1)',
                      background: idx % 2 === 0 ? 'transparent' : 'rgba(30,41,59,0.3)',
                      cursor: onSelectProject ? 'pointer' : 'default',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(99,102,241,0.08)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(30,41,59,0.3)';
                    }}
                  >
                    {/* Rank */}
                    <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#f8fafc' }}>
                      {medal ? (
                        <span style={{ fontSize: '1.1rem' }}>{medal}</span>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>#{rank}</span>
                      )}
                    </td>

                    {/* Team Name / Identifier */}
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <div style={{ fontWeight: 600, color: '#f1f5f9' }}>
                        {entry.teamName || entry.identifier || 'Project'}
                      </div>
                      {entry.identifier && (
                        <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                          ID: {entry.identifier}
                        </div>
                      )}
                    </td>

                    {/* Repo Link */}
                    <td style={{ padding: '0.85rem 1rem' }} onClick={(e) => e.stopPropagation()}>
                      {entry.repoUrl ? (
                        <a
                          href={entry.repoUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            color: '#818cf8',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            textDecoration: 'none',
                            fontSize: '0.76rem',
                          }}
                        >
                          <Github size={13} />
                          <span>{entry.repoName || 'Repo'}</span>
                          <ExternalLink size={11} style={{ opacity: 0.7 }} />
                        </a>
                      ) : (
                        <span style={{ color: '#64748b' }}>—</span>
                      )}
                    </td>

                    {/* Overall Score */}
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                        <span style={{ color: '#4ade80', fontWeight: 700, fontSize: '0.95rem' }}>
                          {entry.overallScore ?? 0}
                        </span>
                        <span style={{ color: '#64748b', fontSize: '0.72rem' }}>
                          /{entry.maxScore || 100}
                        </span>
                        {entry.gradeLabel && (
                          <span
                            style={{
                              marginLeft: 6,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: 'rgba(99,102,241,0.14)',
                              color: '#c084fc',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                            }}
                          >
                            {entry.gradeLabel}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Percentile */}
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 12,
                          background: 'rgba(99,102,241,0.1)',
                          border: '1px solid rgba(99,102,241,0.25)',
                          color: '#a5b4fc',
                          fontSize: '0.74rem',
                          fontWeight: 600,
                        }}
                      >
                        {entry.percentile ?? 100}%
                      </span>
                    </td>

                    {/* Health Status */}
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <ProjectHealthBadge healthStatus={entry.healthStatus} size="xs" />
                    </td>

                    {/* Badges */}
                    <td style={{ padding: '0.85rem 1rem' }}>
                      {Array.isArray(entry.badges) && entry.badges.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {entry.badges.slice(0, 2).map((b, bIdx) => {
                            const label = typeof b === 'string' ? b : b?.label || 'Badge';
                            const icon = typeof b === 'object' && b?.icon ? b.icon : '🎖️';
                            return (
                              <span
                                key={bIdx}
                                style={{
                                  background: 'rgba(234,179,8,0.12)',
                                  border: '1px solid rgba(234,179,8,0.3)',
                                  color: '#fde047',
                                  borderRadius: 10,
                                  padding: '1px 6px',
                                  fontSize: '0.68rem',
                                  whiteSpace: 'nowrap',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 3,
                                }}
                              >
                                <span>{icon}</span> {label}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <span style={{ color: '#64748b', fontSize: '0.75rem' }}>—</span>
                      )}
                    </td>

                    {/* Detail Action */}
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onSelectProject) onSelectProject(entry);
                        }}
                        style={{
                          background: 'rgba(99,102,241,0.15)',
                          border: '1px solid rgba(99,102,241,0.3)',
                          color: '#818cf8',
                          borderRadius: 8,
                          padding: '3px 8px',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 2,
                        }}
                      >
                        Inspect <ChevronRight size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ProjectLeaderboard;
