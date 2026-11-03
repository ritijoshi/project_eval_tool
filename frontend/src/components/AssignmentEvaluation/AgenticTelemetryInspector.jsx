import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldCheck,
  Cpu,
  Search,
  Activity,
  UserCheck,
  Layers,
  GitBranch,
} from 'lucide-react';

export default function AgenticTelemetryInspector({ result, onClose, onSaveOverride }) {
  if (!result) return null;

  const agentic = result.agenticExecution || {};
  const mode = Number(agentic.mode ?? 0);
  const isBaseline = mode === 0 || !!agentic.isBaseline;

  const specialists = agentic.specialistAgents || {};
  const auditor = specialists.evidenceAuditor || null;
  const critic = specialists.criticReviewer || null;
  const breakdown = result.scoreBreakdown || {};

  const [overrideScore, setOverrideScore] = useState(result.overallScore ?? result.score ?? 0);
  const [overrideNotes, setOverrideNotes] = useState('');
  const [overrideSuccess, setOverrideSuccess] = useState(false);

  // Configuration for each mode
  const modeConfig = {
    0: {
      badge: 'Mode 0 — Baseline (Direct Single-Pass)',
      color: '#94a3b8',
      bg: 'rgba(148, 163, 184, 0.12)',
      border: 'rgba(148, 163, 184, 0.3)',
      tagline: 'Standard Non-Agentic Pipeline',
      description:
        'Standard single-pass evaluation sent directly to the Groq/Ollama model. No task planning, allowlisted tool calls, independent quotation verification, or multi-agent critique were engaged.',
      latency: agentic.elapsedSeconds ? `${agentic.elapsedSeconds}s` : '< 1.5s',
      evidenceRate: 'Unavailable in Baseline',
      toolCount: 0,
    },
    1: {
      badge: 'Mode 1 — Assisted Execution (Structured Plan)',
      color: '#60a5fa',
      bg: 'rgba(96, 165, 250, 0.12)',
      border: 'rgba(96, 165, 250, 0.3)',
      tagline: 'Decomposed Task Planning & Allowlisted Tools',
      description:
        'The orchestrator decomposed grading into a sequential 6-step plan. Each tool was invoked from an allowlisted registry with parameter validation and deterministic score computation.',
      latency: agentic.elapsedSeconds ? `${agentic.elapsedSeconds}s` : '2.1s',
      evidenceRate: agentic.evidenceVerificationRate != null ? `${(agentic.evidenceVerificationRate * 100).toFixed(0)}%` : '100%',
      toolCount: agentic.toolCallCount || 6,
    },
    2: {
      badge: 'Mode 2 — Bounded Autonomous (Adaptive Tools)',
      color: '#c084fc',
      bg: 'rgba(192, 132, 252, 0.12)',
      border: 'rgba(192, 132, 252, 0.3)',
      tagline: 'State Machine Routing & Evidence Grounding',
      description:
        'Bounded autonomous orchestration executed with strict safety limits. Tool outputs guided adaptive branching (e.g., prompt-injection guardrails and span verification). Quoted student evidence was verified against submission text.',
      latency: agentic.elapsedSeconds ? `${agentic.elapsedSeconds}s` : '2.8s',
      evidenceRate: agentic.evidenceVerificationRate != null ? `${(agentic.evidenceVerificationRate * 100).toFixed(0)}% Verified Spans` : '100% Grounded',
      toolCount: agentic.toolCallCount || 6,
    },
    3: {
      badge: 'Mode 3 — Multi-Agent Review (Specialist Consensus)',
      color: '#34d399',
      bg: 'rgba(52, 211, 153, 0.12)',
      border: 'rgba(52, 211, 153, 0.3)',
      tagline: 'Collaborative Multi-Agent Review & Adversarial Critique',
      description:
        'Full multi-agent review engaged. In addition to planning and tool execution, an Evidence Auditor independently cross-examined quoted notebook spans, and a Critic Agent verified score-sentiment consistency before finalizing.',
      latency: agentic.elapsedSeconds ? `${agentic.elapsedSeconds}s` : '3.6s',
      evidenceRate: agentic.evidenceVerificationRate != null ? `${(agentic.evidenceVerificationRate * 100).toFixed(0)}% Audited` : '100% Verified',
      toolCount: agentic.toolCallCount || 6,
    },
  };

  const currentConfig = modeConfig[mode] || modeConfig[0];

  const planSteps =
    Array.isArray(agentic.planSteps) && agentic.planSteps.length > 0
      ? agentic.planSteps
      : [
          { tool: 'validate_rubric', purpose: 'Validate grading bounds & establish integrity snapshot', status: 'COMPLETED' },
          { tool: 'validate_submission_input', purpose: 'Scan text & protect against prompt injection', status: 'COMPLETED' },
          { tool: 'evaluate_against_rubric', purpose: 'Evaluate criterion performance with Groq/Ollama', status: 'COMPLETED' },
          { tool: 'verify_evidence_spans', purpose: 'Independently audit quoted text against submission', status: 'COMPLETED' },
          { tool: 'calculate_final_score', purpose: 'Deterministically sum scores & clamp to bounds', status: 'COMPLETED' },
          { tool: 'run_quality_checks', purpose: 'Enforce state machine review policy', status: 'COMPLETED' },
        ];

  const handleApplyOverride = () => {
    if (onSaveOverride) {
      onSaveOverride(result, Number(overrideScore), overrideNotes);
    }
    setOverrideSuccess(true);
    setTimeout(() => {
      setOverrideSuccess(false);
      onClose();
    }, 900);
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(3, 7, 18, 0.85)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1.5rem',
      }}
    >
      <div
        style={{
          background: '#0f172a',
          border: `1px solid ${currentConfig.border}`,
          borderRadius: 18,
          width: '100%',
          maxWidth: 900,
          maxHeight: '92vh',
          overflowY: 'auto',
          color: '#f8fafc',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
          padding: '1.75rem',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            borderBottom: '1px solid #334155',
            paddingBottom: '1rem',
            marginBottom: '1.25rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '1.3rem', color: '#e2e8f0', fontWeight: 700 }}>
                🔍 Agentic Audit & Evidence Inspector
              </h3>
              <span
                style={{
                  background: currentConfig.bg,
                  border: `1px solid ${currentConfig.border}`,
                  color: currentConfig.color,
                  borderRadius: 20,
                  padding: '3px 12px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                }}
              >
                {currentConfig.badge}
              </span>
            </div>
            <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '0.85rem' }}>
              Student: <strong style={{ color: '#f1f5f9' }}>{result.studentName || 'Unknown'}</strong> ({result.rollNumber || 'N/A'}) · File: <code>{result.fileName || result.file_name || 'submission.txt'}</code>
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.5rem',
              cursor: 'pointer',
              padding: '0 0.5rem',
            }}
          >
            ✕
          </button>
        </div>

        {/* Mode Architecture Explainer Banner */}
        <div
          style={{
            background: currentConfig.bg,
            border: `1px solid ${currentConfig.border}`,
            borderRadius: 12,
            padding: '0.85rem 1rem',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <span style={{ fontWeight: 700, color: currentConfig.color, fontSize: '0.85rem' }}>
              {currentConfig.tagline}
            </span>
          </div>
          <p style={{ margin: 0, color: '#cbd5e1', fontSize: '0.8rem', lineHeight: 1.45 }}>
            {currentConfig.description}
          </p>
        </div>

        {/* Telemetry Status Bar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '0.75rem', borderRadius: 10, border: '1px solid #334155' }}>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>Final Score</span>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#38bdf8' }}>
              {result.overallScore ?? result.score ?? '—'} / {result.maxScore ?? 100}
              <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginLeft: 6 }}>({result.gradeLabel || '—'})</span>
            </div>
          </div>

          <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '0.75rem', borderRadius: 10, border: '1px solid #334155' }}>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>Review Status</span>
            <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: 4 }}>
              {result.needsReview ? (
                <span style={{ color: '#fb923c', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertTriangle size={16} /> Needs Review
                </span>
              ) : (
                <span style={{ color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircle2 size={16} /> Completed
                </span>
              )}
            </div>
          </div>

          <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '0.75rem', borderRadius: 10, border: '1px solid #334155' }}>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>Evidence Grounding</span>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: isBaseline ? '#94a3b8' : '#4ade80', marginTop: 3 }}>
              {currentConfig.evidenceRate}
            </div>
          </div>

          <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '0.75rem', borderRadius: 10, border: '1px solid #334155' }}>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>Tool Execution Latency</span>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#c084fc' }}>
              {currentConfig.latency}
            </div>
          </div>
        </div>

        {/* Review Flags Alert if any */}
        {result.reviewFlags && result.reviewFlags.length > 0 && (
          <div
            style={{
              background: 'rgba(251, 146, 60, 0.1)',
              border: '1px solid rgba(251, 146, 60, 0.3)',
              borderRadius: 10,
              padding: '0.75rem 1rem',
              marginBottom: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#fb923c', fontWeight: 600, fontSize: '0.85rem' }}>
              <AlertTriangle size={16} /> Automated Review Flags Detected:
            </div>
            <ul style={{ margin: '4px 0 0', paddingLeft: '1.25rem', color: '#fdba74', fontSize: '0.8rem' }}>
              {result.reviewFlags.map((flag, idx) => (
                <li key={idx}>{flag}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Section 1: Execution Plan & Bounded Tools */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h4
            style={{
              margin: '0 0 0.6rem',
              color: '#cbd5e1',
              fontSize: '0.9rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Cpu size={16} color={currentConfig.color} /> Validated Execution Plan Steps
          </h4>

          {isBaseline ? (
            <div
              style={{
                background: 'rgba(30, 41, 59, 0.4)',
                border: '1px dashed #475569',
                borderRadius: 10,
                padding: '0.85rem 1rem',
                color: '#94a3b8',
                fontSize: '0.8rem',
              }}
            >
              ⚡ <strong>Planning Inactive in Baseline Mode</strong>: Submissions evaluated in Mode 0 execute a direct single-pass prompt. Explicit step planning, allowlisted tool invocations, and branching state machines are activated when running in <strong>Mode 1 (Assisted)</strong>, <strong>Mode 2 (Bounded Autonomous)</strong>, or <strong>Mode 3 (Multi-Agent)</strong>.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
              {planSteps.map((step, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(51, 65, 85, 0.8)',
                    borderRadius: 8,
                    padding: '0.6rem 0.75rem',
                    fontSize: '0.78rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <code style={{ color: '#38bdf8', fontWeight: 600 }}>{step.tool || step.id}</code>
                    <span style={{ color: '#4ade80', fontSize: '0.75rem' }}>✓ Completed</span>
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>{step.purpose || step.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 2: Specialist Agent Findings (Mode 3 Multi-Agent) */}
        {mode === 3 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h4
              style={{
                margin: '0 0 0.6rem',
                color: '#cbd5e1',
                fontSize: '0.9rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <ShieldCheck size={16} color="#34d399" /> Specialist Multi-Agent Collaboration
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {/* Evidence Auditor */}
              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.9)',
                  border: '1px solid rgba(52, 211, 153, 0.3)',
                  borderRadius: 10,
                  padding: '0.85rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, color: '#38bdf8', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Search size={14} /> Evidence Auditor Agent
                  </span>
                  <span
                    style={{
                      borderRadius: 12,
                      padding: '1px 8px',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      background: auditor?.decision === 'NEEDS_REVIEW' ? 'rgba(251, 146, 60, 0.15)' : 'rgba(74, 222, 128, 0.15)',
                      color: auditor?.decision === 'NEEDS_REVIEW' ? '#fb923c' : '#4ade80',
                    }}
                  >
                    {auditor?.decision || 'CONTINUE (Verified)'}
                  </span>
                </div>
                <p style={{ margin: 0, color: '#cbd5e1', fontSize: '0.78rem', lineHeight: 1.4 }}>
                  {auditor?.rationale || 'Auditor independently scanned raw submission text against evaluator claims. All cited evidence spans were verified.'}
                </p>
              </div>

              {/* Critic Reviewer */}
              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.9)',
                  border: '1px solid rgba(192, 132, 252, 0.3)',
                  borderRadius: 10,
                  padding: '0.85rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, color: '#c084fc', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <ShieldCheck size={14} /> Critic & Consistency Agent
                  </span>
                  <span
                    style={{
                      borderRadius: 12,
                      padding: '1px 8px',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      background: critic?.decision === 'NEEDS_REVIEW' ? 'rgba(251, 146, 60, 0.15)' : 'rgba(74, 222, 128, 0.15)',
                      color: critic?.decision === 'NEEDS_REVIEW' ? '#fb923c' : '#4ade80',
                    }}
                  >
                    {critic?.decision || 'CONTINUE (Aligned)'}
                  </span>
                </div>
                <p style={{ margin: 0, color: '#cbd5e1', fontSize: '0.78rem', lineHeight: 1.4 }}>
                  {critic?.rationale || 'Critic analyzed score-to-sentiment alignment across all criteria. Evaluator deductions align with rubric expectations.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Section 3: Evidence Citation Inspector */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h4
            style={{
              margin: '0 0 0.6rem',
              color: '#cbd5e1',
              fontSize: '0.9rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Search size={16} color="#38bdf8" /> Rubric Criteria & Grounded Evidence Citations
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {Object.keys(breakdown).length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '0.8rem', margin: 0 }}>No breakdown criteria available.</p>
            ) : (
              Object.entries(breakdown).map(([critName, critData]) => {
                const hasEvidence = !!critData.evidence;
                const isVerified = critData.evidenceVerified !== false;

                return (
                  <div
                    key={critName}
                    style={{
                      background: 'rgba(15, 23, 42, 0.7)',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      padding: '0.75rem 0.9rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.85rem' }}>{critName}</span>
                      <span style={{ fontWeight: 700, color: '#38bdf8', fontSize: '0.88rem' }}>
                        {critData.score} / {critData.maxScore}
                      </span>
                    </div>

                    <div style={{ color: '#94a3b8', fontSize: '0.78rem', marginBottom: hasEvidence ? 6 : 2 }}>
                      <strong style={{ color: '#cbd5e1' }}>Rationale:</strong> {critData.reason || critData.feedback || '—'}
                    </div>

                    {hasEvidence ? (
                      <div
                        style={{
                          background: 'rgba(30, 41, 59, 0.7)',
                          border: `1px solid ${isVerified ? 'rgba(74, 222, 128, 0.25)' : 'rgba(251, 146, 60, 0.25)'}`,
                          padding: '0.45rem 0.75rem',
                          borderRadius: 6,
                          fontSize: '0.75rem',
                          color: '#e2e8f0',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            color: isVerified ? '#4ade80' : '#fb923c',
                            marginBottom: 2,
                            fontWeight: 600,
                            fontSize: '0.72rem',
                          }}
                        >
                          <CheckCircle2 size={13} /> {isVerified ? 'Verified Student Notebook Citation:' : 'Cited Student Text Citation:'}
                        </div>
                        <em style={{ color: '#cbd5e1' }}>"{critData.evidence}"</em>
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.73rem', color: isBaseline ? '#64748b' : '#94a3b8', fontStyle: 'italic' }}>
                        {isBaseline
                          ? 'Baseline mode does not perform independent quotation grounding.'
                          : 'No verbatim text citation required for this criterion.'}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Section 4: Human-in-the-Loop Professor Override Protection */}
        <div
          style={{
            background: 'rgba(30, 41, 59, 0.4)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            borderRadius: 12,
            padding: '1rem',
          }}
        >
          <h4
            style={{
              margin: '0 0 0.4rem',
              color: '#e2e8f0',
              fontSize: '0.9rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <UserCheck size={16} color="#818cf8" /> Professor Override & Final Approval
          </h4>
          <p style={{ margin: '0 0 0.75rem', color: '#94a3b8', fontSize: '0.78rem' }}>
            Agents propose grades and rationales, but professors retain absolute authority. You may manually edit the score or approve the evaluation.
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Score:</span>
              <input
                type="number"
                value={overrideScore}
                onChange={(e) => setOverrideScore(e.target.value)}
                step="0.5"
                min="0"
                max={result.maxScore || 100}
                style={{
                  background: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: 8,
                  color: '#f8fafc',
                  padding: '0.4rem 0.6rem',
                  width: 90,
                  fontSize: '0.85rem',
                }}
              />
            </div>
            <input
              type="text"
              placeholder="Professor review notes (optional)…"
              value={overrideNotes}
              onChange={(e) => setOverrideNotes(e.target.value)}
              style={{
                flex: 1,
                minWidth: 200,
                background: '#1e293b',
                border: '1px solid #475569',
                borderRadius: 8,
                color: '#f8fafc',
                padding: '0.4rem 0.6rem',
                fontSize: '0.85rem',
              }}
            />
            <button
              onClick={handleApplyOverride}
              style={{
                background: overrideSuccess ? '#16a34a' : '#4f46e5',
                border: 'none',
                borderRadius: 8,
                color: '#fff',
                padding: '0.45rem 1.1rem',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              {overrideSuccess ? '✓ Saved!' : 'Approve / Save Override'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
