import { useState, useCallback } from 'react';
import { getAssignmentStudentDetail } from '../../services/assignmentEvalApi';

// Medal icons for top 3
const medalIcon = (rank) => {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return null;
};

const pctColor = (pct) => {
  if (pct >= 80) return '#4ade80';
  if (pct >= 50) return '#fbbf24';
  return '#f87171';
};

const badgeStyle = (color) => {
  const map = {
    'badge-gold':   { background: 'rgba(234,179,8,0.15)',   border: '1px solid rgba(234,179,8,0.4)',   color: '#fde047' },
    'badge-purple': { background: 'rgba(168,85,247,0.15)',  border: '1px solid rgba(168,85,247,0.4)',  color: '#d8b4fe' },
    'badge-teal':   { background: 'rgba(20,184,166,0.15)',  border: '1px solid rgba(20,184,166,0.4)',  color: '#5eead4' },
    'badge-blue':   { background: 'rgba(59,130,246,0.15)',  border: '1px solid rgba(59,130,246,0.4)',  color: '#93c5fd' },
  };
  return map[color] || { background: 'rgba(148,163,184,0.1)', border: '1px solid #475569', color: '#94a3b8' };
};

const ExpandedDetail = ({ detail, sessionId }) => {
  if (!detail) return <tr><td colSpan={100} style={{ padding: '1rem', color: '#64748b', textAlign: 'center' }}>Loading…</td></tr>;

  const chip = (items = [], color = '#6366f1') =>
    items.length > 0 ? (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((item, i) => (
          <span
            key={i}
            style={{
              background: `${color}22`,
              border: `1px solid ${color}55`,
              color: color,
              borderRadius: 20,
              padding: '2px 10px',
              fontSize: '0.75rem',
            }}
          >
            {item}
          </span>
        ))}
      </div>
    ) : <span style={{ color: '#64748b', fontSize: '0.8rem' }}>None</span>;

  return (
    <tr>
      <td colSpan={100} style={{ padding: 0 }}>
        <div style={{
          padding: '1rem 2rem 1.25rem',
          background: 'rgba(15,23,42,0.95)',
          borderTop: '1px solid rgba(99,102,241,0.2)',
          borderBottom: '1px solid rgba(99,102,241,0.2)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
        }}>
          <div>
            <div style={{ color: '#4ade80', fontWeight: 600, fontSize: '0.75rem', marginBottom: 6, letterSpacing: '0.05em' }}>✅ STRENGTHS</div>
            {chip(detail.strengths, '#4ade80')}
          </div>
          <div>
            <div style={{ color: '#f87171', fontWeight: 600, fontSize: '0.75rem', marginBottom: 6, letterSpacing: '0.05em' }}>❌ MISTAKES</div>
            {chip(detail.mistakes, '#f87171')}
          </div>
          <div>
            <div style={{ color: '#fbbf24', fontWeight: 600, fontSize: '0.75rem', marginBottom: 6, letterSpacing: '0.05em' }}>📚 MISSING CONCEPTS</div>
            {chip(detail.missingConcepts, '#fbbf24')}
          </div>
          <div>
            <div style={{ color: '#818cf8', fontWeight: 600, fontSize: '0.75rem', marginBottom: 6, letterSpacing: '0.05em' }}>💡 IMPROVEMENT SUGGESTIONS</div>
            {(detail.improvementSuggestions || []).length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {detail.improvementSuggestions.map((s, i) => (
                  <li key={i} style={{ color: '#cbd5e1', fontSize: '0.8rem', marginBottom: 3 }}>{s}</li>
                ))}
              </ul>
            ) : <span style={{ color: '#64748b', fontSize: '0.8rem' }}>None</span>}
          </div>
          {detail.overallFeedback && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ color: '#94a3b8', fontWeight: 600, fontSize: '0.75rem', marginBottom: 6, letterSpacing: '0.05em' }}>💬 DETAILED FEEDBACK</div>
              <p style={{ color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.6, margin: 0 }}>{detail.overallFeedback}</p>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
};

const AssignmentLeaderboard = ({ sessionId, leaderboard = [], rubricCriteria = [], totalEvaluated = 0, totalStudents = 0, assignmentTitle = '' }) => {
  const [expandedRow, setExpandedRow] = useState(null);
  const [detailCache, setDetailCache] = useState({});
  const [loadingDetail, setLoadingDetail] = useState(null);

  const toggleRow = useCallback(async (entry) => {
    const key = String(entry.resultId);
    if (expandedRow === key) {
      setExpandedRow(null);
      return;
    }
    setExpandedRow(key);
    if (!detailCache[key]) {
      setLoadingDetail(key);
      try {
        const data = await getAssignmentStudentDetail(sessionId, entry.resultId);
        setDetailCache((prev) => ({ ...prev, [key]: data.detail }));
      } catch {
        setDetailCache((prev) => ({ ...prev, [key]: null }));
      } finally {
        setLoadingDetail(null);
      }
    }
  }, [expandedRow, detailCache, sessionId]);

  if (!leaderboard || leaderboard.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: '#64748b', padding: '2rem 0' }}>
        No ranked results yet. Leaderboard will appear once evaluation completes.
      </div>
    );
  }

  return (
    <div style={{
      borderRadius: 14,
      background: 'rgba(15,23,42,0.9)',
      border: '1px solid rgba(99,102,241,0.2)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '1rem 1.5rem',
        background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(168,85,247,0.1))',
        borderBottom: '1px solid rgba(99,102,241,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <h3 style={{ margin: 0, color: '#e2e8f0', fontWeight: 700, fontSize: '1.05rem' }}>
            🏆 Assignment Leaderboard{assignmentTitle ? ` — ${assignmentTitle}` : ''}
          </h3>
          <p style={{ margin: '2px 0 0', color: '#94a3b8', fontSize: '0.8rem' }}>
            {totalEvaluated} evaluated · {totalStudents} total · Click a row to expand student analysis
          </p>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem', color: '#cbd5e1' }}>
          <thead>
            <tr style={{ background: 'rgba(15,23,42,0.6)' }}>
              <th style={thStyle}>Rank</th>
              <th style={thStyle}>Student</th>
              <th style={thStyle}>Overall Score</th>
              <th style={thStyle}>Percentile</th>
              {rubricCriteria.map((c) => (
                <th key={c.title} style={{ ...thStyle, whiteSpace: 'nowrap' }}>{c.title}</th>
              ))}
              <th style={thStyle}>Badges</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((entry) => {
              const key = String(entry.resultId);
              const isExpanded = expandedRow === key;
              const pct = entry.maxScore > 0 ? Math.round((entry.overallScore / entry.maxScore) * 100) : 0;
              const medal = medalIcon(entry.rank);

              return [
                <tr
                  key={key}
                  onClick={() => toggleRow(entry)}
                  style={{
                    cursor: 'pointer',
                    borderBottom: '1px solid rgba(30,41,59,0.8)',
                    background: isExpanded ? 'rgba(99,102,241,0.08)' : 'transparent',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = 'rgba(99,102,241,0.04)'; }}
                  onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}
                >
                  {/* Rank */}
                  <td style={{ padding: '0.65rem 1rem', textAlign: 'center', fontWeight: 700, fontSize: '1rem' }}>
                    {medal
                      ? <span title={`Rank ${entry.rank}`}>{medal}</span>
                      : <span style={{ color: '#64748b' }}>#{entry.rank}</span>
                    }
                  </td>

                  {/* Student */}
                  <td style={{ padding: '0.65rem 1rem' }}>
                    <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{entry.studentName}</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{entry.rollNumber}</div>
                  </td>

                  {/* Overall Score */}
                  <td style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                    <span style={{ fontWeight: 700, color: pctColor(pct) }}>
                      {entry.overallScore ?? '—'}/{entry.maxScore ?? '?'}
                    </span>
                    {entry.gradeLabel && (
                      <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{entry.gradeLabel}</div>
                    )}
                  </td>

                  {/* Percentile */}
                  <td style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                    <div style={{ fontWeight: 600, color: pctColor(entry.percentile) }}>
                      {entry.percentile}%
                    </div>
                    <div style={{
                      height: 4, borderRadius: 2,
                      background: 'rgba(255,255,255,0.08)',
                      marginTop: 4,
                      position: 'relative',
                    }}>
                      <div style={{
                        height: '100%', borderRadius: 2,
                        width: `${entry.percentile}%`,
                        background: pctColor(entry.percentile),
                        transition: 'width 0.4s',
                      }} />
                    </div>
                  </td>

                  {/* Per-criterion rubric scores */}
                  {rubricCriteria.map((c) => {
                    const score = entry.rubricScores?.[c.title];
                    return (
                      <td key={c.title} style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                        {score != null ? (
                          <span style={{
                            fontWeight: 600,
                            color: c.maxScore > 0
                              ? pctColor((score / c.maxScore) * 100)
                              : '#cbd5e1',
                          }}>
                            {score}
                            {c.maxScore ? `/${c.maxScore}` : ''}
                          </span>
                        ) : '—'}
                      </td>
                    );
                  })}

                  {/* Badges */}
                  <td style={{ padding: '0.65rem 1rem' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(entry.badges || []).map((badge, i) => (
                        <span
                          key={i}
                          style={{
                            ...badgeStyle(badge.color),
                            borderRadius: 20,
                            padding: '2px 8px',
                            fontSize: '0.71rem',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                        >
                          {badge.icon} {badge.label}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>,

                // Expanded student analysis (lazy-loaded)
                isExpanded && (
                  <ExpandedDetail
                    key={`${key}-detail`}
                    detail={loadingDetail === key ? null : detailCache[key]}
                    sessionId={sessionId}
                  />
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const thStyle = {
  borderBottom: '1px solid rgba(99,102,241,0.2)',
  padding: '0.6rem 1rem',
  textAlign: 'left',
  color: '#94a3b8',
  fontWeight: 600,
  fontSize: '0.75rem',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
};

export default AssignmentLeaderboard;
