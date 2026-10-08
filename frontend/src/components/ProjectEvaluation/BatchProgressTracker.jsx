import React, { useEffect } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Activity,
  Layers,
  Award,
  ExternalLink,
  RotateCcw,
  Wifi,
  WifiOff,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { useProjectEvaluationSocket } from '../../hooks/useProjectEvaluationSocket';

export const BatchProgressTracker = ({
  sessionId,
  sessionLabel = 'Project Evaluation',
  onComplete,
  onRetry,
}) => {
  const {
    progress,
    status,
    processedRepos,
    totalRepos,
    latestResult,
    results,
    isCompleted,
    isFailed,
    error,
    leaderboard,
    totalEvaluated,
    isConnected,
  } = useProjectEvaluationSocket(sessionId);

  // Auto-notify parent when completion arrives with results
  useEffect(() => {
    if (isCompleted && onComplete) {
      onComplete({
        sessionId,
        status,
        results,
        leaderboard,
        totalEvaluated,
      });
    }
  }, [isCompleted, sessionId, status, results, leaderboard, totalEvaluated, onComplete]);

  const getStatusColor = (s) => {
    switch (s) {
      case 'COMPLETED':
        return { bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.35)', color: '#4ade80' };
      case 'FAILED':
        return { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)', color: '#f87171' };
      case 'ANALYZING_REPOS':
      case 'EVALUATING':
        return { bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.35)', color: '#fbbf24' };
      case 'PARSING_RUBRIC':
        return { bg: 'rgba(129,140,248,0.12)', border: 'rgba(129,140,248,0.35)', color: '#818cf8' };
      default:
        return { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.3)', color: '#94a3b8' };
    }
  };

  const getHealthBadge = (health) => {
    if (health === 'ON_TRACK') {
      return (
        <span
          style={{
            background: 'rgba(74,222,128,0.15)',
            color: '#4ade80',
            border: '1px solid rgba(74,222,128,0.35)',
            borderRadius: 12,
            padding: '2px 8px',
            fontSize: '0.72rem',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <ShieldCheck size={12} /> ON TRACK
        </span>
      );
    }
    if (health === 'AT_RISK') {
      return (
        <span
          style={{
            background: 'rgba(251,191,36,0.15)',
            color: '#fbbf24',
            border: '1px solid rgba(251,191,36,0.35)',
            borderRadius: 12,
            padding: '2px 8px',
            fontSize: '0.72rem',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <ShieldAlert size={12} /> AT RISK
        </span>
      );
    }
    return (
      <span
        style={{
          background: 'rgba(248,113,113,0.15)',
          color: '#f87171',
          border: '1px solid rgba(248,113,113,0.35)',
          borderRadius: 12,
          padding: '2px 8px',
          fontSize: '0.72rem',
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <ShieldAlert size={12} /> BEHIND
      </span>
    );
  };

  const statusStyle = getStatusColor(status);

  return (
    <div
      style={{
        borderRadius: 16,
        background: 'rgba(15,23,42,0.92)',
        border: '1px solid rgba(99,102,241,0.25)',
        padding: '1.5rem',
        backdropFilter: 'blur(12px)',
        marginBottom: '1.5rem',
      }}
      className="shadow-2xl"
    >
      {/* Top Header: Session & Status Badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '1.25rem',
          paddingBottom: '0.85rem',
          borderBottom: '1px solid rgba(99,102,241,0.15)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              padding: '0.5rem',
              borderRadius: 10,
              background: 'rgba(99,102,241,0.15)',
              color: '#818cf8',
            }}
          >
            <Activity size={20} className={!isCompleted && !isFailed ? 'animate-pulse' : ''} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h4 style={{ margin: 0, color: '#f8fafc', fontSize: '1rem', fontWeight: 600 }}>
                {sessionLabel || 'Project Evaluation Session'}
              </h4>
              <span
                style={{
                  background: statusStyle.bg,
                  border: `1px solid ${statusStyle.border}`,
                  color: statusStyle.color,
                  borderRadius: 20,
                  padding: '2px 10px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                }}
              >
                {status}
              </span>
            </div>
            <span style={{ color: '#64748b', fontSize: '0.75rem' }}>
              Session ID: <code style={{ color: '#94a3b8' }}>{sessionId}</code>
            </span>
          </div>
        </div>

        {/* Live Socket Connection Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: '0.75rem',
              color: isConnected ? '#4ade80' : '#94a3b8',
              background: isConnected ? 'rgba(74,222,128,0.1)' : 'rgba(148,163,184,0.1)',
              padding: '3px 9px',
              borderRadius: 12,
              border: `1px solid ${isConnected ? 'rgba(74,222,128,0.3)' : 'rgba(148,163,184,0.2)'}`,
            }}
          >
            {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {isConnected ? 'Live Socket Connected' : 'Connecting Socket…'}
          </span>
        </div>
      </div>

      {/* Progress Metric & Bar */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ color: '#94a3b8', fontSize: '0.82rem', fontWeight: 500 }}>
            Evaluation Progress
          </span>
          <span style={{ color: '#e2e8f0', fontSize: '0.88rem', fontWeight: 700 }}>
            {progress}% ·{' '}
            <span style={{ color: '#818cf8' }}>
              {processedRepos}/{totalRepos || 1}
            </span>{' '}
            repositories
          </span>
        </div>

        {/* Outer Bar */}
        <div
          style={{
            height: 10,
            borderRadius: 6,
            background: 'rgba(30,41,59,0.9)',
            border: '1px solid rgba(99,102,241,0.2)',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Inner Fill */}
          <div
            style={{
              width: `${Math.min(100, Math.max(0, progress))}%`,
              height: '100%',
              background: isFailed
                ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                : isCompleted
                ? 'linear-gradient(90deg, #10b981, #059669)'
                : 'linear-gradient(90deg, #6366f1, #a855f7)',
              borderRadius: 6,
              transition: 'width 0.4s ease-in-out',
            }}
          />
        </div>
      </div>

      {/* Latest Evaluated Project Card */}
      {latestResult && (
        <div
          style={{
            padding: '1rem',
            borderRadius: 12,
            background: 'rgba(15,23,42,0.7)',
            border: '1px solid rgba(99,102,241,0.2)',
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.04em' }}>
              LATEST EVALUATED REPOSITORY
            </span>
            {latestResult.healthStatus && getHealthBadge(latestResult.healthStatus)}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <div>
              <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.9rem' }}>
                {latestResult.teamName || latestResult.identifier || 'Project'}
              </span>
              {latestResult.repoUrl && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                  <a
                    href={latestResult.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: '#818cf8',
                      fontSize: '0.75rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      textDecoration: 'none',
                    }}
                  >
                    {latestResult.repoUrl} <ExternalLink size={11} />
                  </a>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {typeof latestResult.overallScore === 'number' && (
                <div style={{ textAlign: 'right' }}>
                  <span style={{ display: 'block', color: '#64748b', fontSize: '0.7rem' }}>Score</span>
                  <span style={{ color: '#4ade80', fontSize: '1rem', fontWeight: 700 }}>
                    {latestResult.overallScore}
                    <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>/{latestResult.maxScore || 100}</span>
                  </span>
                </div>
              )}
              {latestResult.gradeLabel && (
                <div
                  style={{
                    padding: '2px 8px',
                    borderRadius: 6,
                    background: 'rgba(99,102,241,0.15)',
                    color: '#c084fc',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                  }}
                >
                  {latestResult.gradeLabel}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Completion Banner */}
      {isCompleted && (
        <div
          style={{
            padding: '1rem 1.25rem',
            borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(5,150,105,0.06))',
            border: '1px solid rgba(16,185,129,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <CheckCircle2 size={22} style={{ color: '#4ade80' }} />
            <div>
              <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.92rem' }}>
                Batch Evaluation Complete!
              </span>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.78rem' }}>
                All {totalRepos} repositories evaluated. Scores and evidence have been indexed.
              </p>
            </div>
          </div>

          {onComplete && (
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                onComplete({
                  sessionId,
                  status,
                  results,
                  leaderboard,
                  totalEvaluated,
                })
              }
              style={{
                fontSize: '0.82rem',
                padding: '0.45rem 1.1rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              View Results & Leaderboard <ChevronRight size={15} />
            </button>
          )}
        </div>
      )}

      {/* Failure Banner */}
      {isFailed && (
        <div
          style={{
            padding: '1rem',
            borderRadius: 12,
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <AlertCircle size={22} style={{ color: '#f87171' }} />
            <div>
              <span style={{ color: '#fca5a5', fontWeight: 600, fontSize: '0.9rem' }}>
                Evaluation Failed
              </span>
              <p style={{ margin: 0, color: '#f87171', fontSize: '0.78rem' }}>
                {error || 'An unexpected error occurred during project evaluation.'}
              </p>
            </div>
          </div>

          {onRetry && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onRetry}
              style={{
                fontSize: '0.78rem',
                padding: '0.4rem 0.9rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <RotateCcw size={13} /> Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default BatchProgressTracker;
