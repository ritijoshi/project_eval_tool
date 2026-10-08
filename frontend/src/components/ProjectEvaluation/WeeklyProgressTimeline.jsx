import React, { useState } from 'react';
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  FileText,
  Paperclip,
  ChevronDown,
  ChevronUp,
  Plus,
  RefreshCw,
  ArrowUpDown,
  Sparkles,
  Loader2,
  Check,
} from 'lucide-react';

/**
 * Normalizes input value to an array of non-empty strings.
 */
const ensureArray = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val
      .map((item) => (typeof item === 'string' ? item.trim() : JSON.stringify(item)))
      .filter(Boolean);
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      } catch {
        // Fall back to newline splitting
      }
    }
    return trimmed.split(/\r?\n/).map((s) => s.replace(/^[-*•\d.]+\s*/, '').trim()).filter(Boolean);
  }
  return [];
};

/**
 * Formats date into readable string.
 */
const formatDate = (dateVal) => {
  if (!dateVal) return '—';
  try {
    const d = new Date(dateVal);
    if (Number.isNaN(d.getTime())) return String(dateVal);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(dateVal);
  }
};

/**
 * Extracts filename from path.
 */
const getFileName = (filePath) => {
  if (!filePath) return '';
  const parts = String(filePath).split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
};

/**
 * WeeklyProgressTimeline
 * Displays continuous weekly milestone submissions and AI-verified claims.
 */
export const WeeklyProgressTimeline = ({
  weeklyProgressList = [],
  project = null,
  loading = false,
  onSubmitWeeklyProgress = null,
  onRefresh = null,
  title = 'Weekly Progress Timeline',
}) => {
  const [sortOrder, setSortOrder] = useState('desc'); // 'desc' (newest first) | 'asc' (oldest first)
  const [expandedTexts, setExpandedTexts] = useState({});

  const toggleTextExpand = (id) => {
    setExpandedTexts((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Compile timeline items defensively
  const rawList = Array.isArray(weeklyProgressList) ? weeklyProgressList : [];

  let timelineItems = [];

  if (rawList.length > 0) {
    timelineItems = rawList.map((item, idx) => {
      const parsedReport = item?.parsedReport || {};
      const workCompleted = ensureArray(parsedReport.workCompleted);
      const problemsFaced = ensureArray(parsedReport.problemsFaced);
      const plannedWork = ensureArray(parsedReport.plannedWork);
      const currentStatus = parsedReport.currentStatus || '';

      return {
        id: item?._id || `weekly-${idx}`,
        weekLabel: item?.weekLabel || `Week ${idx + 1}`,
        submittedAt: item?.submittedAt || item?.createdAt || null,
        processed: Boolean(item?.processed),
        filePath: item?.filePath || '',
        fileText: item?.fileText || '',
        currentStatus,
        workCompleted,
        problemsFaced,
        plannedWork,
        isSyntheticClaim: false,
      };
    });
  } else if (project?.weeklyClaims) {
    // Fall back to ProjectEvalResult.weeklyClaims if no standalone weeklyProgress records
    const claims = project.weeklyClaims || {};
    const workCompleted = ensureArray(claims.workCompleted);
    const problemsFaced = ensureArray(claims.problemsFaced);
    const plannedWork = ensureArray(claims.plannedWork);
    const currentStatus = claims.currentStatus || '';

    if (workCompleted.length > 0 || problemsFaced.length > 0 || plannedWork.length > 0 || currentStatus) {
      timelineItems = [
        {
          id: 'project-eval-latest-claim',
          weekLabel: 'Latest Progress Claim',
          submittedAt: project?.evaluatedAt || project?.updatedAt || null,
          processed: true,
          filePath: '',
          fileText: '',
          currentStatus,
          workCompleted,
          problemsFaced,
          plannedWork,
          isSyntheticClaim: true,
        },
      ];
    }
  }

  // Cross-reference score history if available
  const scoreHistoryMap = {};
  if (Array.isArray(project?.scoreHistory)) {
    project.scoreHistory.forEach((h) => {
      if (h?.weekLabel) {
        scoreHistoryMap[String(h.weekLabel).toLowerCase().trim()] = h.score;
      }
    });
  }

  // Sort timeline items
  const sortedItems = [...timelineItems].sort((a, b) => {
    const timeA = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
    const timeB = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
    return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
  });

  // ─── Loading State ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.85)',
          borderRadius: 16,
          border: '1px solid rgba(99, 102, 241, 0.25)',
          padding: '2.5rem 1.5rem',
          textAlign: 'center',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 220,
        }}
      >
        <Loader2 className="animate-spin" size={36} style={{ color: '#818cf8', marginBottom: '0.85rem' }} />
        <h3 style={{ color: '#f8fafc', fontSize: '1.1rem', fontWeight: 600, margin: '0 0 0.35rem 0' }}>
          Loading Weekly Progress Timeline
        </h3>
        <p style={{ color: '#94a3b8', fontSize: '0.86rem', margin: 0 }}>
          Fetching continuous progress submissions, milestone claims, and analysis logs...
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'rgba(15, 23, 42, 0.92)',
        borderRadius: 16,
        border: '1px solid rgba(99, 102, 241, 0.28)',
        padding: '1.5rem',
        backdropFilter: 'blur(16px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
      }}
    >
      {/* ─── Header ────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          paddingBottom: '0.85rem',
          borderBottom: '1px solid rgba(99, 102, 241, 0.2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'rgba(99, 102, 241, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#818cf8',
            }}
          >
            <Calendar size={18} />
          </div>
          <div>
            <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.15rem', fontWeight: 700 }}>
              {title}
            </h3>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              Continuous sprint milestones & claims tracking ({timelineItems.length} {timelineItems.length === 1 ? 'submission' : 'submissions'})
            </span>
          </div>
        </div>

        {/* Header Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {timelineItems.length > 1 && (
            <button
              type="button"
              onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
              title={`Switch to ${sortOrder === 'desc' ? 'Oldest First' : 'Newest First'}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#cbd5e1',
                padding: '0.45rem 0.8rem',
                borderRadius: 8,
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <ArrowUpDown size={13} />
              <span>{sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}</span>
            </button>
          )}

          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              title="Refresh timeline"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#cbd5e1',
                padding: '0.45rem 0.8rem',
                borderRadius: 8,
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={13} />
              <span>Refresh</span>
            </button>
          )}

          {onSubmitWeeklyProgress && (
            <button
              type="button"
              onClick={onSubmitWeeklyProgress}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                border: 'none',
                color: '#fff',
                padding: '0.48rem 0.95rem',
                borderRadius: 8,
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
              }}
            >
              <Plus size={14} />
              <span>Submit Progress</span>
            </button>
          )}
        </div>
      </div>

      {/* ─── Empty State ────────────────────────────────────────────────────── */}
      {timelineItems.length === 0 ? (
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.5)',
            borderRadius: 14,
            border: '1px dashed rgba(99, 102, 241, 0.28)',
            padding: '2.5rem 1.5rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'rgba(99, 102, 241, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#818cf8',
              marginBottom: '1rem',
            }}
          >
            <Calendar size={24} />
          </div>
          <h4 style={{ color: '#f8fafc', fontSize: '1.05rem', fontWeight: 600, margin: '0 0 0.35rem 0' }}>
            No Weekly Progress Submissions Yet
          </h4>
          <p style={{ color: '#94a3b8', fontSize: '0.86rem', maxWidth: 460, margin: '0 0 1.25rem 0', lineHeight: 1.5 }}>
            Regular weekly updates document your team's milestone velocity, stated accomplishments, and blockers.
            The AI engine automatically verifies these claims against your repository commits during evaluation.
          </p>

          {onSubmitWeeklyProgress && (
            <button
              type="button"
              onClick={onSubmitWeeklyProgress}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                border: 'none',
                color: '#fff',
                padding: '0.55rem 1.15rem',
                borderRadius: 8,
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Plus size={15} />
              <span>Submit First Weekly Report</span>
            </button>
          )}
        </div>
      ) : (
        /* ─── Timeline List ─────────────────────────────────────────────────── */
        <div
          style={{
            position: 'relative',
            paddingLeft: '1.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.75rem',
          }}
        >
          {/* Continuous Vertical Rail Line */}
          <div
            style={{
              position: 'absolute',
              top: 14,
              bottom: 14,
              left: 10,
              width: 2,
              background: 'linear-gradient(180deg, rgba(99, 102, 241, 0.45) 0%, rgba(99, 102, 241, 0.1) 100%)',
            }}
          />

          {sortedItems.map((item) => {
            const isProcessed = item.processed;
            const weekKey = String(item.weekLabel).toLowerCase().trim();
            const matchingScore = scoreHistoryMap[weekKey];
            const hasReportFile = Boolean(item.filePath);
            const hasRawText = Boolean(item.fileText && item.fileText.trim());
            const isTextExpanded = Boolean(expandedTexts[item.id]);

            return (
              <div
                key={item.id}
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.85rem',
                }}
              >
                {/* Rail Node Indicator */}
                <div
                  style={{
                    position: 'absolute',
                    top: 12,
                    left: -28,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: isProcessed ? 'rgba(74, 222, 128, 0.2)' : 'rgba(251, 191, 36, 0.2)',
                    border: `2px solid ${isProcessed ? '#4ade80' : '#fbbf24'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isProcessed ? '#4ade80' : '#fbbf24',
                    boxShadow: isProcessed ? '0 0 10px rgba(74, 222, 128, 0.35)' : '0 0 10px rgba(251, 191, 36, 0.35)',
                    zIndex: 2,
                  }}
                >
                  {isProcessed ? <Check size={12} strokeWidth={3} /> : <Clock size={12} />}
                </div>

                {/* Timeline Card */}
                <div
                  style={{
                    background: 'rgba(30, 41, 59, 0.55)',
                    border: `1px solid ${isProcessed ? 'rgba(99, 102, 241, 0.28)' : 'rgba(251, 191, 36, 0.3)'}`,
                    borderRadius: 14,
                    padding: '1.25rem',
                    backdropFilter: 'blur(12px)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                  }}
                >
                  {/* Card Header Row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 10,
                      paddingBottom: '0.75rem',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: '0.2rem' }}>
                        <h4 style={{ margin: 0, color: '#f8fafc', fontSize: '1.08rem', fontWeight: 700 }}>
                          {item.weekLabel}
                        </h4>

                        {/* Distinct Processing Status Badge */}
                        {isProcessed ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'rgba(74, 222, 128, 0.12)',
                              border: '1px solid rgba(74, 222, 128, 0.35)',
                              color: '#4ade80',
                              padding: '2px 9px',
                              borderRadius: 20,
                              fontSize: '0.72rem',
                              fontWeight: 600,
                            }}
                          >
                            <CheckCircle2 size={12} />
                            <span>Processed & Analyzed</span>
                          </span>
                        ) : (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'rgba(251, 191, 36, 0.12)',
                              border: '1px solid rgba(251, 191, 36, 0.35)',
                              color: '#fbbf24',
                              padding: '2px 9px',
                              borderRadius: 20,
                              fontSize: '0.72rem',
                              fontWeight: 600,
                            }}
                          >
                            <Clock size={12} />
                            <span>Pending AI Verification</span>
                          </span>
                        )}

                        {matchingScore !== undefined && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'rgba(99, 102, 241, 0.15)',
                              border: '1px solid rgba(99, 102, 241, 0.3)',
                              color: '#c7d2fe',
                              padding: '2px 8px',
                              borderRadius: 12,
                              fontSize: '0.72rem',
                              fontWeight: 700,
                            }}
                          >
                            Score: {matchingScore}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#94a3b8', fontSize: '0.8rem', flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Clock size={12} />
                          <span>Submitted: {formatDate(item.submittedAt)}</span>
                        </span>

                        {hasReportFile && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#c7d2fe' }}>
                            <Paperclip size={12} />
                            <span>{getFileName(item.filePath)}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Stated Current Status Pill */}
                    {item.currentStatus && (
                      <div
                        style={{
                          background: 'rgba(99, 102, 241, 0.12)',
                          border: '1px solid rgba(99, 102, 241, 0.25)',
                          borderRadius: 8,
                          padding: '0.35rem 0.75rem',
                          color: '#e0e7ff',
                          fontSize: '0.78rem',
                          fontWeight: 500,
                          maxWidth: 320,
                        }}
                      >
                        <span style={{ color: '#818cf8', fontWeight: 600, marginRight: 4 }}>Status:</span>
                        <span>{item.currentStatus}</span>
                      </div>
                    )}
                  </div>

                  {/* ─── Processed Claims Section ────────────────────────────── */}
                  {isProcessed ? (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                        gap: '0.85rem',
                      }}
                    >
                      {/* Work Completed */}
                      <div
                        style={{
                          background: 'rgba(15, 23, 42, 0.45)',
                          border: '1px solid rgba(74, 222, 128, 0.2)',
                          borderRadius: 10,
                          padding: '0.85rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.5rem', color: '#4ade80', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          <CheckCircle2 size={14} />
                          <span>Work Completed ({item.workCompleted.length})</span>
                        </div>

                        {item.workCompleted.length === 0 ? (
                          <p style={{ margin: 0, color: '#64748b', fontSize: '0.82rem', fontStyle: 'italic' }}>
                            No specific completed tasks listed.
                          </p>
                        ) : (
                          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.4rem' }}>
                            {item.workCompleted.map((w, idx) => (
                              <li
                                key={`work-${idx}`}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: 7,
                                  color: '#dcfce7',
                                  fontSize: '0.82rem',
                                  lineHeight: 1.4,
                                }}
                              >
                                <Sparkles size={13} style={{ color: '#4ade80', flexShrink: 0, marginTop: 2 }} />
                                <span>{w}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* Problems & Blockers */}
                      <div
                        style={{
                          background: 'rgba(15, 23, 42, 0.45)',
                          border: '1px solid rgba(248, 113, 113, 0.2)',
                          borderRadius: 10,
                          padding: '0.85rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.5rem', color: '#f87171', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          <AlertTriangle size={14} />
                          <span>Blockers & Impediments ({item.problemsFaced.length})</span>
                        </div>

                        {item.problemsFaced.length === 0 ? (
                          <p style={{ margin: 0, color: '#64748b', fontSize: '0.82rem', fontStyle: 'italic' }}>
                            No blockers or obstacles reported.
                          </p>
                        ) : (
                          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.4rem' }}>
                            {item.problemsFaced.map((p, idx) => (
                              <li
                                key={`problem-${idx}`}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: 7,
                                  color: '#fecaca',
                                  fontSize: '0.82rem',
                                  lineHeight: 1.4,
                                }}
                              >
                                <AlertTriangle size={13} style={{ color: '#f87171', flexShrink: 0, marginTop: 2 }} />
                                <span>{p}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* Planned Work */}
                      <div
                        style={{
                          background: 'rgba(15, 23, 42, 0.45)',
                          border: '1px solid rgba(96, 165, 250, 0.2)',
                          borderRadius: 10,
                          padding: '0.85rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.5rem', color: '#60a5fa', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          <ArrowRight size={14} />
                          <span>Next Sprint Planned Work ({item.plannedWork.length})</span>
                        </div>

                        {item.plannedWork.length === 0 ? (
                          <p style={{ margin: 0, color: '#64748b', fontSize: '0.82rem', fontStyle: 'italic' }}>
                            No planned tasks recorded.
                          </p>
                        ) : (
                          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.4rem' }}>
                            {item.plannedWork.map((pw, idx) => (
                              <li
                                key={`planned-${idx}`}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: 7,
                                  color: '#dbeafe',
                                  fontSize: '0.82rem',
                                  lineHeight: 1.4,
                                }}
                              >
                                <ArrowRight size={13} style={{ color: '#60a5fa', flexShrink: 0, marginTop: 2 }} />
                                <span>{pw}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* ─── Pending Processing Banner ──────────────────────────── */
                    <div
                      style={{
                        background: 'rgba(251, 191, 36, 0.07)',
                        border: '1px solid rgba(251, 191, 36, 0.22)',
                        borderRadius: 10,
                        padding: '0.85rem 1rem',
                        color: '#fef3c7',
                        fontSize: '0.84rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <Clock size={16} style={{ color: '#fbbf24', flexShrink: 0 }} />
                      <span>
                        This report has been uploaded and queued. The AI engine will parse completed items,
                        blockers, and next sprint tasks during the continuous evaluation cycle.
                      </span>
                    </div>
                  )}

                  {/* ─── Submitted Raw Report Text (If Available) ────────────── */}
                  {hasRawText && (
                    <div
                      style={{
                        background: 'rgba(15, 23, 42, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: 8,
                        padding: '0.65rem 0.85rem',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleTextExpand(item.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#94a3b8',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: 0,
                          width: '100%',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <FileText size={13} />
                          <span>Submitted Report Text</span>
                        </span>
                        {isTextExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>

                      {isTextExpanded && (
                        <div
                          style={{
                            marginTop: '0.5rem',
                            color: '#cbd5e1',
                            fontSize: '0.82rem',
                            lineHeight: 1.5,
                            whiteSpace: 'pre-wrap',
                            maxHeight: 240,
                            overflowY: 'auto',
                            fontFamily: 'monospace',
                            background: 'rgba(0, 0, 0, 0.2)',
                            padding: '0.5rem',
                            borderRadius: 6,
                          }}
                        >
                          {item.fileText}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WeeklyProgressTimeline;
