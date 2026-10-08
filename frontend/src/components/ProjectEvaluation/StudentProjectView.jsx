import React from 'react';
import {
  Github,
  ExternalLink,
  RefreshCw,
  Plus,
  Award,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  HelpCircle,
  Clock,
  Sparkles,
  ListTodo,
  FileText,
  Code2,
  ShieldCheck,
  Check,
  Loader2,
  BookOpen,
  Terminal,
  Activity,
  Layers,
} from 'lucide-react';
import ProjectHealthBadge from './ProjectHealthBadge';

/**
 * Normalizes values to an array of non-empty strings.
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
 * Returns grade color based on score or grade label.
 */
const getGradeColor = (score, max = 100, gradeLabel = '') => {
  const g = String(gradeLabel || '').toUpperCase();
  if (g.startsWith('A')) return '#4ade80';
  if (g.startsWith('B')) return '#60a5fa';
  if (g.startsWith('C')) return '#fbbf24';
  if (g.startsWith('D') || g.startsWith('F')) return '#f87171';

  const pct = max > 0 ? (Number(score || 0) / Number(max)) * 100 : 0;
  if (pct >= 85) return '#4ade80';
  if (pct >= 70) return '#60a5fa';
  if (pct >= 55) return '#fbbf24';
  return '#f87171';
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
 * StudentProjectView
 * Student-facing comprehensive project evaluation dashboard.
 */
export const StudentProjectView = ({
  project = null,
  loading = false,
  error = null,
  onSubmitWeeklyProgress = null,
  onRefresh = null,
}) => {
  // Normalize criterion scores safely
  let criteriaList = [];
  if (project?.criterionScores) {
    if (Array.isArray(project.criterionScores)) {
      criteriaList = project.criterionScores.map((c, idx) => ({
        id: c?._id || `crit-${idx}`,
        name: c?.name || c?.criterion || `Criterion ${idx + 1}`,
        score: typeof c?.score === 'number' ? c.score : Number(c?.score) || 0,
        maxScore: typeof c?.maxScore === 'number' ? c.maxScore : (Number(c?.maxScore) || null),
        feedback: c?.feedback || c?.comment || '',
      }));
    } else if (typeof project.criterionScores === 'object') {
      criteriaList = Object.entries(project.criterionScores).map(([name, val], idx) => ({
        id: `crit-obj-${idx}`,
        name,
        score: typeof val === 'number' ? val : (Number(val?.score) || 0),
        maxScore: typeof val?.maxScore === 'number' ? val.maxScore : null,
        feedback: typeof val === 'object' ? (val?.feedback || val?.comment || '') : '',
      }));
    }
  }

  // Normalize badges safely
  let badgeList = [];
  if (project?.badges) {
    if (Array.isArray(project.badges)) {
      badgeList = project.badges.map((b, idx) => {
        if (typeof b === 'string') {
          return { id: `badge-${idx}`, label: b, color: '#818cf8', icon: null };
        }
        return {
          id: b?._id || `badge-${idx}`,
          label: b?.label || b?.name || 'Achievement Badge',
          icon: b?.icon || null,
          color: b?.color || '#818cf8',
          description: b?.description || '',
        };
      });
    }
  }

  // Defensive list extractions
  const strengths = ensureArray(project?.strengths);
  const missingRequirements = ensureArray(project?.missingRequirements);
  const missingConcepts = ensureArray(project?.missingConcepts);
  const nextWeekTasks = ensureArray(project?.nextWeekTasks);

  // Technical diagnostic pillar metrics if available
  const codeQuality = project?.codeQuality;
  const architecture = project?.architecture;
  const testing = project?.testing;
  const documentation = project?.documentation;
  const techCompliance = project?.techCompliance;

  const hasDiagnostics = Boolean(
    (codeQuality && Object.keys(codeQuality).length > 0) ||
    (architecture && Object.keys(architecture).length > 0) ||
    (testing && Object.keys(testing).length > 0) ||
    (documentation && Object.keys(documentation).length > 0) ||
    (techCompliance && Object.keys(techCompliance).length > 0)
  );

  // ─── 1. Loading State ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.85)',
          borderRadius: 16,
          border: '1px solid rgba(99, 102, 241, 0.25)',
          padding: '3rem 2rem',
          textAlign: 'center',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 320,
        }}
      >
        <Loader2 className="animate-spin" size={42} style={{ color: '#818cf8', marginBottom: '1rem' }} />
        <h3 style={{ color: '#f8fafc', fontSize: '1.2rem', fontWeight: 600, margin: '0 0 0.5rem 0' }}>
          Loading Project Evaluation
        </h3>
        <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: 0, maxWidth: 440 }}>
          Retrieving real-time evaluation scores, automated code analysis, and continuous progress metrics...
        </p>
      </div>
    );
  }

  // ─── 2. Error State ────────────────────────────────────────────────────────
  if (error) {
    return (
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.85)',
          borderRadius: 16,
          border: '1px solid rgba(239, 68, 68, 0.35)',
          padding: '2.5rem 2rem',
          textAlign: 'center',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1rem auto',
            color: '#f87171',
          }}
        >
          <AlertOctagon size={26} />
        </div>
        <h3 style={{ color: '#f8fafc', fontSize: '1.15rem', fontWeight: 600, margin: '0 0 0.5rem 0' }}>
          Unable to Load Project Evaluation
        </h3>
        <p style={{ color: '#fca5a5', fontSize: '0.88rem', margin: '0 0 1.25rem 0' }}>
          {typeof error === 'string' ? error : error?.message || 'An unexpected error occurred while fetching your evaluation.'}
        </p>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(99, 102, 241, 0.2)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              color: '#c7d2fe',
              padding: '0.55rem 1.15rem',
              borderRadius: 8,
              fontSize: '0.88rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <RefreshCw size={15} />
            <span>Try Again</span>
          </button>
        )}
      </div>
    );
  }

  // ─── 3. Empty State (No Project Provided) ──────────────────────────────────
  if (!project) {
    return (
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.85)',
          borderRadius: 16,
          border: '1px solid rgba(99, 102, 241, 0.25)',
          padding: '3rem 2rem',
          textAlign: 'center',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: 'rgba(99, 102, 241, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1rem auto',
            color: '#818cf8',
          }}
        >
          <FileText size={28} />
        </div>
        <h3 style={{ color: '#f8fafc', fontSize: '1.2rem', fontWeight: 600, margin: '0 0 0.5rem 0' }}>
          No Evaluation Record Found
        </h3>
        <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: '0 0 1.5rem 0', maxWidth: 440 }}>
          Your project evaluation hasn't been initialized or is currently pending setup by your instructor.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          {onSubmitWeeklyProgress && (
            <button
              type="button"
              onClick={onSubmitWeeklyProgress}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                border: 'none',
                color: '#fff',
                padding: '0.6rem 1.2rem',
                borderRadius: 8,
                fontSize: '0.88rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Plus size={16} />
              <span>Submit Weekly Progress</span>
            </button>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#cbd5e1',
                padding: '0.6rem 1.2rem',
                borderRadius: 8,
                fontSize: '0.88rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={15} />
              <span>Refresh Status</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── 4. Evaluation PENDING State ───────────────────────────────────────────
  if (project.evaluationStatus === 'PENDING') {
    return (
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.9)',
          borderRadius: 16,
          border: '1px solid rgba(251, 191, 36, 0.35)',
          padding: '2.5rem 2rem',
          textAlign: 'center',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: 'rgba(251, 191, 36, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.25rem auto',
            color: '#fbbf24',
          }}
        >
          <Clock className="animate-pulse" size={28} />
        </div>
        <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>
          Evaluation in Progress
        </h3>
        <p style={{ color: '#cbd5e1', fontSize: '0.92rem', margin: '0 auto 1.5rem auto', maxWidth: 480 }}>
          {project.teamName || project.identifier || 'Your project'} is currently being evaluated.
          The AI engine is analyzing commit history, code structure, test suites, and weekly claim reports.
        </p>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            background: 'rgba(251, 191, 36, 0.08)',
            border: '1px solid rgba(251, 191, 36, 0.25)',
            padding: '0.5rem 1rem',
            borderRadius: 24,
            fontSize: '0.82rem',
            color: '#fbbf24',
            marginBottom: '1.5rem',
          }}
        >
          <Loader2 className="animate-spin" size={14} />
          <span>Status: Analyzing repository artifacts...</span>
        </div>

        <div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(99, 102, 241, 0.2)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                color: '#c7d2fe',
                padding: '0.55rem 1.15rem',
                borderRadius: 8,
                fontSize: '0.88rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={15} />
              <span>Check for Completion</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── 5. Evaluation FAILED State ────────────────────────────────────────────
  if (project.evaluationStatus === 'FAILED') {
    return (
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.9)',
          borderRadius: 16,
          border: '1px solid rgba(239, 68, 68, 0.35)',
          padding: '2.5rem 2rem',
          textAlign: 'center',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.25rem auto',
            color: '#f87171',
          }}
        >
          <AlertOctagon size={28} />
        </div>
        <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>
          Evaluation Encountered an Error
        </h3>
        <p style={{ color: '#fca5a5', fontSize: '0.92rem', margin: '0 auto 1.25rem auto', maxWidth: 520 }}>
          {project.errorMessage ||
            'The automated evaluation could not complete. This can happen if the repository is private or unreachable, or if rate limits were exceeded.'}
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(99, 102, 241, 0.25)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                color: '#c7d2fe',
                padding: '0.6rem 1.2rem',
                borderRadius: 8,
                fontSize: '0.88rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={15} />
              <span>Retry / Refresh</span>
            </button>
          )}
          {onSubmitWeeklyProgress && (
            <button
              type="button"
              onClick={onSubmitWeeklyProgress}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#cbd5e1',
                padding: '0.6rem 1.2rem',
                borderRadius: 8,
                fontSize: '0.88rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Plus size={16} />
              <span>Submit Progress Update</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── 6. COMPLETED State ────────────────────────────────────────────────────
  const overallScore = typeof project.overallScore === 'number' ? project.overallScore : Number(project.overallScore) || 0;
  const maxScore = Number(project.maxScore) || 100;
  const scorePercent = maxScore > 0 ? Math.min(100, Math.max(0, Math.round((overallScore / maxScore) * 100))) : 0;
  const gradeLabel = project.gradeLabel || (scorePercent >= 90 ? 'A' : scorePercent >= 80 ? 'B' : scorePercent >= 70 ? 'C' : 'D');
  const gradeColor = getGradeColor(overallScore, maxScore, gradeLabel);
  const coveragePercent = Math.min(100, Math.max(0, Math.round(Number(project.requirementCoverage) || 0)));

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
      }}
    >
      {/* ─── Top Header Card ─────────────────────────────────────────────────── */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.92)',
          borderRadius: 16,
          border: '1px solid rgba(99, 102, 241, 0.28)',
          padding: '1.5rem',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: '0.25rem' }}>
              <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.45rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
                {project.teamName || project.identifier || 'Project Evaluation'}
              </h2>
              <ProjectHealthBadge healthStatus={project.healthStatus} size="sm" />
              {gradeLabel && (
                <span
                  style={{
                    padding: '2px 10px',
                    borderRadius: 12,
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    background: `${gradeColor}22`,
                    color: gradeColor,
                    border: `1px solid ${gradeColor}55`,
                  }}
                >
                  Grade {gradeLabel}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', color: '#94a3b8', fontSize: '0.84rem' }}>
              {project.identifier && (
                <span>
                  Identifier: <strong style={{ color: '#cbd5e1' }}>{project.identifier}</strong>
                </span>
              )}

              {project.repoUrl && (
                <a
                  href={project.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    color: '#818cf8',
                    textDecoration: 'none',
                    fontWeight: 500,
                  }}
                >
                  <Github size={14} />
                  <span>
                    {project.repoOwner && project.repoName
                      ? `${project.repoOwner}/${project.repoName}`
                      : project.repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, '')}
                  </span>
                  <ExternalLink size={12} />
                </a>
              )}

              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Clock size={13} />
                <span>Evaluated: {formatDate(project.evaluatedAt)}</span>
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                title="Refresh evaluation"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#cbd5e1',
                  padding: '0.5rem 0.9rem',
                  borderRadius: 8,
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'background 0.2s ease',
                }}
              >
                <RefreshCw size={14} />
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
                  padding: '0.5rem 1rem',
                  borderRadius: 8,
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
                }}
              >
                <Plus size={15} />
                <span>Submit Weekly Progress</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── Section 1: Overall Evaluation Metrics ───────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
        }}
      >
        {/* Score Card */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.85)',
            borderRadius: 14,
            border: '1px solid rgba(99, 102, 241, 0.22)',
            padding: '1.25rem',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>
              Overall Score
            </span>
            <Activity size={16} style={{ color: gradeColor }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '0.35rem 0' }}>
            <span
              style={{
                fontSize: '2.2rem',
                fontWeight: 800,
                color: gradeColor,
                fontFamily: 'Outfit, sans-serif',
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              {overallScore}
            </span>
            <span style={{ fontSize: '1rem', color: '#94a3b8', fontWeight: 500 }}>
              /{maxScore}
            </span>
            <span
              style={{
                marginLeft: 'auto',
                fontSize: '0.82rem',
                fontWeight: 700,
                color: gradeColor,
                background: `${gradeColor}18`,
                padding: '2px 8px',
                borderRadius: 10,
              }}
            >
              {scorePercent}%
            </span>
          </div>

          <div
            style={{
              width: '100%',
              height: 6,
              background: 'rgba(255, 255, 255, 0.08)',
              borderRadius: 3,
              overflow: 'hidden',
              marginTop: '0.5rem',
            }}
          >
            <div
              style={{
                width: `${scorePercent}%`,
                height: '100%',
                background: gradeColor,
                borderRadius: 3,
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>

        {/* Grade Card */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.85)',
            borderRadius: 14,
            border: '1px solid rgba(99, 102, 241, 0.22)',
            padding: '1.25rem',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>
              Grade
            </span>
            <Award size={16} style={{ color: gradeColor }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '0.35rem 0' }}>
            <span
              style={{
                fontSize: '2.2rem',
                fontWeight: 800,
                color: gradeColor,
                fontFamily: 'Outfit, sans-serif',
                lineHeight: 1,
              }}
            >
              {gradeLabel || '—'}
            </span>
            <span style={{ fontSize: '0.84rem', color: '#94a3b8' }}>
              Academic standing
            </span>
          </div>

          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
            Continuous weighted rubric evaluation
          </div>
        </div>

        {/* Health Status Card */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.85)',
            borderRadius: 14,
            border: '1px solid rgba(99, 102, 241, 0.22)',
            padding: '1.25rem',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>
              Project Health
            </span>
            <ShieldCheck size={16} style={{ color: '#818cf8' }} />
          </div>

          <div style={{ margin: '0.5rem 0' }}>
            <ProjectHealthBadge healthStatus={project.healthStatus} size="md" />
          </div>

          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
            Pace, commitment velocity & blocker risk
          </div>
        </div>

        {/* Requirement Coverage Card */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.85)',
            borderRadius: 14,
            border: '1px solid rgba(99, 102, 241, 0.22)',
            padding: '1.25rem',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>
              Requirement Coverage
            </span>
            <Layers size={16} style={{ color: '#60a5fa' }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '0.35rem 0' }}>
            <span
              style={{
                fontSize: '2.2rem',
                fontWeight: 800,
                color: coveragePercent >= 75 ? '#4ade80' : coveragePercent >= 50 ? '#fbbf24' : '#f87171',
                fontFamily: 'Outfit, sans-serif',
                lineHeight: 1,
              }}
            >
              {coveragePercent}%
            </span>
            <span style={{ fontSize: '0.84rem', color: '#94a3b8' }}>verified</span>
          </div>

          <div
            style={{
              width: '100%',
              height: 6,
              background: 'rgba(255, 255, 255, 0.08)',
              borderRadius: 3,
              overflow: 'hidden',
              marginTop: '0.5rem',
            }}
          >
            <div
              style={{
                width: `${coveragePercent}%`,
                height: '100%',
                background: coveragePercent >= 75 ? '#4ade80' : coveragePercent >= 50 ? '#fbbf24' : '#f87171',
                borderRadius: 3,
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>
      </div>

      {/* ─── Section 2: Criterion Scores ────────────────────────────────────── */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.88)',
          borderRadius: 16,
          border: '1px solid rgba(99, 102, 241, 0.25)',
          padding: '1.5rem',
          backdropFilter: 'blur(14px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.25rem' }}>
          <Layers size={19} style={{ color: '#818cf8' }} />
          <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.15rem', fontWeight: 700 }}>
            Rubric Criterion Scores
          </h3>
          <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: '#94a3b8' }}>
            {criteriaList.length} {criteriaList.length === 1 ? 'criterion' : 'criteria'} evaluated
          </span>
        </div>

        {criteriaList.length === 0 ? (
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: 10,
              padding: '1.5rem',
              textAlign: 'center',
              color: '#94a3b8',
              fontSize: '0.88rem',
            }}
          >
            No individual criterion breakdown scores recorded for this evaluation.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.85rem' }}>
            {criteriaList.map((crit) => {
              const max = crit.maxScore || 100;
              const pct = max > 0 ? Math.min(100, Math.max(0, Math.round((crit.score / max) * 100))) : 0;
              const cColor = getGradeColor(crit.score, max);

              return (
                <div
                  key={crit.id}
                  style={{
                    background: 'rgba(30, 41, 59, 0.5)',
                    border: '1px solid rgba(99, 102, 241, 0.15)',
                    borderRadius: 12,
                    padding: '1rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 8,
                      marginBottom: '0.5rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.92rem' }}>
                        {crit.name}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        style={{
                          fontSize: '1rem',
                          fontWeight: 700,
                          color: cColor,
                          fontFamily: 'Outfit, sans-serif',
                        }}
                      >
                        {crit.score}
                        {crit.maxScore ? (
                          <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 500 }}>
                            /{crit.maxScore}
                          </span>
                        ) : null}
                      </span>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          padding: '2px 8px',
                          borderRadius: 8,
                          background: `${cColor}18`,
                          color: cColor,
                          fontWeight: 600,
                        }}
                      >
                        {pct}%
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div
                    style={{
                      width: '100%',
                      height: 5,
                      background: 'rgba(255, 255, 255, 0.08)',
                      borderRadius: 3,
                      overflow: 'hidden',
                      marginBottom: crit.feedback ? '0.65rem' : 0,
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: cColor,
                        borderRadius: 3,
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>

                  {/* Criterion specific feedback */}
                  {crit.feedback && (
                    <p
                      style={{
                        margin: 0,
                        color: '#cbd5e1',
                        fontSize: '0.84rem',
                        lineHeight: 1.5,
                        background: 'rgba(15, 23, 42, 0.4)',
                        padding: '0.5rem 0.75rem',
                        borderRadius: 8,
                        borderLeft: `3px solid ${cColor}`,
                      }}
                    >
                      {crit.feedback}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Section 3 & 4: Strengths & Missing Requirements/Concepts ───────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '1.25rem',
        }}
      >
        {/* Strengths Card */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.88)',
            borderRadius: 16,
            border: '1px solid rgba(74, 222, 128, 0.25)',
            padding: '1.5rem',
            backdropFilter: 'blur(14px)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'rgba(74, 222, 128, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#4ade80',
              }}
            >
              <CheckCircle2 size={16} />
            </div>
            <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.05rem', fontWeight: 700 }}>
              Demonstrated Strengths
            </h3>
            <span
              style={{
                marginLeft: 'auto',
                fontSize: '0.74rem',
                padding: '2px 8px',
                borderRadius: 10,
                background: 'rgba(74, 222, 128, 0.14)',
                color: '#4ade80',
                fontWeight: 600,
              }}
            >
              {strengths.length}
            </span>
          </div>

          {strengths.length === 0 ? (
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: 10,
                padding: '1.25rem',
                textAlign: 'center',
                color: '#94a3b8',
                fontSize: '0.85rem',
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              No specific key strengths flagged yet.
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.65rem' }}>
              {strengths.map((str, i) => (
                <li
                  key={`strength-${i}`}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    background: 'rgba(74, 222, 128, 0.06)',
                    border: '1px solid rgba(74, 222, 128, 0.2)',
                    borderRadius: 10,
                    padding: '0.65rem 0.85rem',
                    color: '#dcfce7',
                    fontSize: '0.86rem',
                    lineHeight: 1.45,
                  }}
                >
                  <Sparkles size={16} style={{ color: '#4ade80', flexShrink: 0, marginTop: 2 }} />
                  <span>{str}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Missing Requirements & Missing Concepts Card */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.88)',
            borderRadius: 16,
            border: '1px solid rgba(248, 113, 113, 0.25)',
            padding: '1.5rem',
            backdropFilter: 'blur(14px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'rgba(248, 113, 113, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f87171',
              }}
            >
              <AlertTriangle size={16} />
            </div>
            <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.05rem', fontWeight: 700 }}>
              Gaps & Missing Requirements
            </h3>
            <span
              style={{
                marginLeft: 'auto',
                fontSize: '0.74rem',
                padding: '2px 8px',
                borderRadius: 10,
                background: 'rgba(248, 113, 113, 0.14)',
                color: '#f87171',
                fontWeight: 600,
              }}
            >
              {missingRequirements.length + missingConcepts.length} total
            </span>
          </div>

          {missingRequirements.length === 0 && missingConcepts.length === 0 ? (
            <div
              style={{
                background: 'rgba(74, 222, 128, 0.05)',
                border: '1px solid rgba(74, 222, 128, 0.2)',
                borderRadius: 10,
                padding: '1.25rem',
                textAlign: 'center',
                color: '#4ade80',
                fontSize: '0.85rem',
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Check size={18} />
              <span>All expected requirements and concepts have been satisfied!</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {/* Missing Requirements */}
              {missingRequirements.length > 0 && (
                <div>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      color: '#fca5a5',
                      letterSpacing: '0.05em',
                      marginBottom: '0.45rem',
                    }}
                  >
                    Missing Requirements ({missingRequirements.length})
                  </span>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.45rem' }}>
                    {missingRequirements.map((req, i) => (
                      <li
                        key={`missing-req-${i}`}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 8,
                          background: 'rgba(248, 113, 113, 0.07)',
                          border: '1px solid rgba(248, 113, 113, 0.22)',
                          borderRadius: 8,
                          padding: '0.55rem 0.75rem',
                          color: '#fecaca',
                          fontSize: '0.84rem',
                          lineHeight: 1.4,
                        }}
                      >
                        <AlertOctagon size={15} style={{ color: '#f87171', flexShrink: 0, marginTop: 2 }} />
                        <span>{req}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Missing Concepts */}
              {missingConcepts.length > 0 && (
                <div>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      color: '#fcd34d',
                      letterSpacing: '0.05em',
                      marginBottom: '0.45rem',
                    }}
                  >
                    Missing Architectural / Technical Concepts ({missingConcepts.length})
                  </span>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.45rem' }}>
                    {missingConcepts.map((conc, i) => (
                      <li
                        key={`missing-conc-${i}`}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 8,
                          background: 'rgba(251, 191, 36, 0.07)',
                          border: '1px solid rgba(251, 191, 36, 0.22)',
                          borderRadius: 8,
                          padding: '0.55rem 0.75rem',
                          color: '#fef3c7',
                          fontSize: '0.84rem',
                          lineHeight: 1.4,
                        }}
                      >
                        <HelpCircle size={15} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 2 }} />
                        <span>{conc}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Section 5: AI Feedback ─────────────────────────────────────────── */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.88)',
          borderRadius: 16,
          border: '1px solid rgba(99, 102, 241, 0.25)',
          padding: '1.5rem',
          backdropFilter: 'blur(14px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
          <Sparkles size={19} style={{ color: '#a855f7' }} />
          <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.15rem', fontWeight: 700 }}>
            Comprehensive Evaluator Feedback
          </h3>
        </div>

        {project.feedback ? (
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(168, 85, 247, 0.04) 100%)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              borderRadius: 12,
              padding: '1.25rem',
              color: '#e2e8f0',
              fontSize: '0.9rem',
              lineHeight: 1.65,
              whiteSpace: 'pre-wrap',
            }}
          >
            {project.feedback}
          </div>
        ) : (
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: 10,
              padding: '1.5rem',
              textAlign: 'center',
              color: '#94a3b8',
              fontSize: '0.88rem',
            }}
          >
            No overall textual summary feedback recorded for this project yet.
          </div>
        )}
      </div>

      {/* ─── Section 6: Next Week Recommended Tasks ─────────────────────────── */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.88)',
          borderRadius: 16,
          border: '1px solid rgba(99, 102, 241, 0.25)',
          padding: '1.5rem',
          backdropFilter: 'blur(14px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
          <ListTodo size={19} style={{ color: '#60a5fa' }} />
          <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.15rem', fontWeight: 700 }}>
            Next Week Action Items
          </h3>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '0.74rem',
              padding: '2px 8px',
              borderRadius: 10,
              background: 'rgba(96, 165, 250, 0.15)',
              color: '#60a5fa',
              fontWeight: 600,
            }}
          >
            {nextWeekTasks.length} {nextWeekTasks.length === 1 ? 'task' : 'tasks'}
          </span>
        </div>

        {nextWeekTasks.length === 0 ? (
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: 10,
              padding: '1.5rem',
              textAlign: 'center',
              color: '#94a3b8',
              fontSize: '0.88rem',
            }}
          >
            No upcoming tasks generated. Keep proceeding along your planned milestone schedule.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.65rem' }}>
            {nextWeekTasks.map((task, idx) => (
              <div
                key={`next-task-${idx}`}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(99, 102, 241, 0.18)',
                  borderRadius: 10,
                  padding: '0.75rem 1rem',
                  color: '#e2e8f0',
                  fontSize: '0.88rem',
                  lineHeight: 1.45,
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    background: 'rgba(96, 165, 250, 0.15)',
                    border: '1px solid rgba(96, 165, 250, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#60a5fa',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  {idx + 1}
                </div>
                <span>{task}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Section 7: Badges & Recognition ─────────────────────────────────── */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.88)',
          borderRadius: 16,
          border: '1px solid rgba(99, 102, 241, 0.25)',
          padding: '1.5rem',
          backdropFilter: 'blur(14px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
          <Award size={19} style={{ color: '#fbbf24' }} />
          <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.15rem', fontWeight: 700 }}>
            Badges & Milestones
          </h3>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '0.74rem',
              padding: '2px 8px',
              borderRadius: 10,
              background: 'rgba(251, 191, 36, 0.15)',
              color: '#fbbf24',
              fontWeight: 600,
            }}
          >
            {badgeList.length} earned
          </span>
        </div>

        {badgeList.length === 0 ? (
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: 10,
              padding: '1.5rem',
              textAlign: 'center',
              color: '#94a3b8',
              fontSize: '0.88rem',
            }}
          >
            No badges awarded yet. Complete milestones and test coverage to unlock achievements!
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}
          >
            {badgeList.map((b) => (
              <div
                key={b.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'rgba(251, 191, 36, 0.08)',
                  border: '1px solid rgba(251, 191, 36, 0.35)',
                  padding: '0.55rem 1rem',
                  borderRadius: 20,
                  color: '#fef3c7',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                }}
              >
                <Award size={16} style={{ color: '#fbbf24' }} />
                <span>{b.label}</span>
                {b.description && (
                  <span style={{ fontSize: '0.74rem', color: '#cbd5e1', fontWeight: 400 }}>
                    • {b.description}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Technical Diagnostics Section (If populated) ───────────────────── */}
      {hasDiagnostics && (
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.88)',
            borderRadius: 16,
            border: '1px solid rgba(99, 102, 241, 0.22)',
            padding: '1.5rem',
            backdropFilter: 'blur(14px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
            <Terminal size={19} style={{ color: '#818cf8' }} />
            <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.15rem', fontWeight: 700 }}>
              Technical Diagnostics & Compliance
            </h3>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '0.85rem',
            }}
          >
            {codeQuality && Object.keys(codeQuality).length > 0 && (
              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.45)',
                  border: '1px solid rgba(99, 102, 241, 0.15)',
                  borderRadius: 10,
                  padding: '0.85rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.4rem', color: '#c7d2fe', fontSize: '0.8rem', fontWeight: 600 }}>
                  <Code2 size={14} />
                  <span>Code Metrics</span>
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.4 }}>
                  {typeof codeQuality === 'string'
                    ? codeQuality
                    : JSON.stringify(codeQuality, null, 2)}
                </div>
              </div>
            )}

            {architecture && Object.keys(architecture).length > 0 && (
              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.45)',
                  border: '1px solid rgba(99, 102, 241, 0.15)',
                  borderRadius: 10,
                  padding: '0.85rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.4rem', color: '#c7d2fe', fontSize: '0.8rem', fontWeight: 600 }}>
                  <Layers size={14} />
                  <span>Architecture</span>
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.4 }}>
                  {typeof architecture === 'string'
                    ? architecture
                    : JSON.stringify(architecture, null, 2)}
                </div>
              </div>
            )}

            {testing && Object.keys(testing).length > 0 && (
              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.45)',
                  border: '1px solid rgba(99, 102, 241, 0.15)',
                  borderRadius: 10,
                  padding: '0.85rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.4rem', color: '#c7d2fe', fontSize: '0.8rem', fontWeight: 600 }}>
                  <CheckCircle2 size={14} />
                  <span>Test Coverage & Specs</span>
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.4 }}>
                  {typeof testing === 'string'
                    ? testing
                    : JSON.stringify(testing, null, 2)}
                </div>
              </div>
            )}

            {documentation && Object.keys(documentation).length > 0 && (
              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.45)',
                  border: '1px solid rgba(99, 102, 241, 0.15)',
                  borderRadius: 10,
                  padding: '0.85rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.4rem', color: '#c7d2fe', fontSize: '0.8rem', fontWeight: 600 }}>
                  <BookOpen size={14} />
                  <span>Documentation</span>
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.4 }}>
                  {typeof documentation === 'string'
                    ? documentation
                    : JSON.stringify(documentation, null, 2)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentProjectView;
