import React, { useState } from 'react';

export const gradeColor = (score) => {
  if (score >= 85) return '#34C759';
  if (score >= 70) return '#30D158';
  if (score >= 55) return '#FF9F0A';
  return '#FF453A';
};

export const ScoreRing = ({ score, max = 100, label }) => {
  const pct = Math.round((score / max) * 100);
  const color = gradeColor(pct);
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
      <svg width="60" height="60" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
        <circle
          cx="30" cy="30" r={r} fill="none"
          stroke={color} strokeWidth="5"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 30 30)"
        />
        <text x="30" y="35" textAnchor="middle" fill={color} fontSize="13" fontWeight="700">{pct}</text>
      </svg>
      <span style={{ fontSize: '0.7rem', color: 'var(--muted)', textAlign: 'center', lineHeight: 1.2 }}>{label}</span>
    </div>
  );
};

export const Badge = ({ text, type }) => {
  const colors = {
    strength: { bg: 'rgba(52,199,89,0.14)',  border: 'rgba(52,199,89,0.35)',  text: '#34C759' },
    weakness: { bg: 'rgba(255,159,10,0.13)', border: 'rgba(255,159,10,0.35)', text: '#FF9F0A' },
    missing:  { bg: 'rgba(255,69,58,0.12)',  border: 'rgba(255,69,58,0.30)',  text: '#FF6B6B' },
    suggest:  { bg: 'rgba(10,132,255,0.12)', border: 'rgba(10,132,255,0.3)',  text: '#0A84FF' },
  };
  const c = colors[type] || colors.suggest;
  return (
    <div style={{
      padding: '0.45rem 0.75rem', borderRadius: '8px',
      border: `1px solid ${c.border}`, background: c.bg,
      color: c.text, fontSize: '0.82rem', lineHeight: '1.4',
    }}>
      {text}
    </div>
  );
};

export const FeedbackSection = ({ title, icon, items, type }) => {
  if (!items?.length) return null;
  return (
    <div style={{ marginBottom: '1rem' }}>
      <p style={{
        fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.5rem',
      }}>
        {icon} {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {items.map((item, i) => <Badge key={i} text={item} type={type} />)}
      </div>
    </div>
  );
};

const AIEvaluationCard = ({ aiEval, compact = false }) => {
  const [expanded, setExpanded] = useState(false);
  if (!aiEval) return null;

  const {
    totalScore, maxScore, gradeLabel, summary, detailedFeedback,
    strengths, mistakes, missingConcepts, improvementSuggestions, scoreBreakdown,
  } = aiEval;

  const hasRichFeedback =
    (strengths?.length > 0) || (mistakes?.length > 0) ||
    (missingConcepts?.length > 0) || (improvementSuggestions?.length > 0);

  const isGenericSummary =
    summary?.toLowerCase().includes('fallback semantic estimate') ||
    summary?.toLowerCase().includes('llm evaluation is unavailable');

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(10,132,255,0.07) 0%, rgba(142,36,170,0.05) 100%)',
      border: '1px solid rgba(10,132,255,0.2)',
      borderRadius: '14px',
      padding: '1rem 1.1rem',
      marginTop: '0.5rem',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span>🤖</span>
          <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>AI Evaluation</span>
          {gradeLabel && (
            <span style={{
              padding: '0.2rem 0.6rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700,
              background: `${gradeColor(totalScore)}22`, color: gradeColor(totalScore),
              border: `1px solid ${gradeColor(totalScore)}55`,
            }}>
              Grade {gradeLabel}
            </span>
          )}
        </div>
        <span style={{
          fontSize: '1.6rem', fontWeight: 800, color: gradeColor(totalScore),
          fontFamily: 'Outfit, sans-serif', letterSpacing: '-0.03em',
        }}>
          {totalScore}
          <span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--muted)' }}>/{maxScore}</span>
        </span>
      </div>

      {/* Score breakdown rings */}
      {scoreBreakdown && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
          <ScoreRing score={scoreBreakdown.correctness || 0} label="Correctness" />
          <ScoreRing score={scoreBreakdown.topicUnderstanding || 0} label="Topic Understanding" />
          <ScoreRing score={scoreBreakdown.completeness || 0} label="Completeness" />
          <ScoreRing score={scoreBreakdown.technicalAccuracy || 0} label="Technical Accuracy" />
        </div>
      )}

      {/* Summary */}
      {summary && !isGenericSummary && (
        <p style={{
          fontSize: '0.875rem', color: 'var(--text-main)', lineHeight: 1.55,
          background: 'rgba(255,255,255,0.04)', borderRadius: '8px',
          padding: '0.6rem 0.8rem', marginBottom: '0.85rem',
          borderLeft: `3px solid ${gradeColor(totalScore)}`,
        }}>
          {summary}
        </p>
      )}

      {/* Rich feedback sections */}
      {hasRichFeedback && (
        <>
          <FeedbackSection title="Strengths"        icon="✅" items={strengths}             type="strength" />
          <FeedbackSection title="Areas to Improve" icon="⚠️" items={mistakes}              type="weakness" />
          <FeedbackSection title="Missing Concepts"  icon="🔍" items={missingConcepts}       type="missing"  />
          <FeedbackSection title="Suggestions"       icon="💡" items={improvementSuggestions} type="suggest"  />
        </>
      )}

      {/* Expandable detailed feedback */}
      {detailedFeedback && (
        <>
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              background: 'none', border: 'none', color: 'var(--primary)',
              cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
              padding: '0.3rem 0', display: 'flex', alignItems: 'center', gap: '0.35rem',
              marginTop: '0.25rem',
            }}
          >
            <span style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: '0.2s', display: 'inline-block' }}>▶</span>
            {expanded ? 'Hide' : 'View'} Detailed Analysis
          </button>
          {expanded && (
            <p style={{
              fontSize: '0.84rem', color: 'var(--muted)', lineHeight: 1.6,
              marginTop: '0.6rem', padding: '0.65rem 0.85rem',
              background: 'rgba(255,255,255,0.03)', borderRadius: '8px',
              borderLeft: '2px solid rgba(255,255,255,0.12)',
            }}>
              {detailedFeedback}
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default AIEvaluationCard;
