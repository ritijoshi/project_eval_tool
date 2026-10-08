import React from 'react';
import {
  X,
  Github,
  ExternalLink,
  Users,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ListTodo,
  Calendar,
  Sparkles,
  Award,
  Layers,
  FileText,
  BarChart2,
} from 'lucide-react';
import ProjectHealthBadge from './ProjectHealthBadge';

export const TeamContributionPanel = ({ project, onClose }) => {
  if (!project) return null;

  // Extract GitHub-derived evidence
  const githubEvidence = project.githubEvidence || {};
  const analysis = githubEvidence.analysis || {};
  const evidenceData = githubEvidence.evidence || {};
  const contributors = analysis.contributors || analysis.contributorStats || [];
  const languages = analysis.languages || {};
  const requirementMapping = evidenceData.requirementMapping || [];

  // Extract weekly claims
  const weeklyClaims = project.weeklyClaims || {};
  const workCompleted = Array.isArray(weeklyClaims.workCompleted)
    ? weeklyClaims.workCompleted
    : weeklyClaims.workCompleted
    ? [weeklyClaims.workCompleted]
    : [];
  const problemsFaced = Array.isArray(weeklyClaims.problemsFaced)
    ? weeklyClaims.problemsFaced
    : weeklyClaims.problemsFaced
    ? [weeklyClaims.problemsFaced]
    : [];
  const plannedWork = Array.isArray(weeklyClaims.plannedWork)
    ? weeklyClaims.plannedWork
    : weeklyClaims.plannedWork
    ? [weeklyClaims.plannedWork]
    : [];
  const currentStatus = weeklyClaims.currentStatus || '';

  // Extract AI evaluation details
  const criteria = Array.isArray(project.criterionScores)
    ? project.criterionScores
    : project.criterionScores && typeof project.criterionScores === 'object'
    ? Object.entries(project.criterionScores).map(([name, data]) => ({
        name,
        score: typeof data === 'number' ? data : data?.score ?? 0,
        feedback: data?.feedback || '',
      }))
    : [];

  const strengths = Array.isArray(project.strengths) ? project.strengths : [];
  const missingRequirements = Array.isArray(project.missingRequirements) ? project.missingRequirements : [];
  const missingConcepts = Array.isArray(project.missingConcepts) ? project.missingConcepts : [];
  const nextWeekTasks = Array.isArray(project.nextWeekTasks) ? project.nextWeekTasks : [];

  return (
    <div
      style={{
        borderRadius: 16,
        background: 'rgba(15,23,42,0.96)',
        border: '1px solid rgba(99,102,241,0.3)',
        padding: '1.5rem',
        backdropFilter: 'blur(16px)',
        display: 'grid',
        gap: '1.25rem',
        marginBottom: '1.5rem',
      }}
      className="shadow-2xl"
    >
      {/* ─── Header & Close Action ─────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid rgba(99,102,241,0.2)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.2rem', fontWeight: 700 }}>
              {project.teamName || project.identifier || 'Project Details'}
            </h3>
            <ProjectHealthBadge healthStatus={project.healthStatus} size="sm" />
            {project.gradeLabel && (
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 6,
                  background: 'rgba(99,102,241,0.18)',
                  color: '#c084fc',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                }}
              >
                Grade: {project.gradeLabel}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
            {project.identifier && (
              <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                Identifier: <strong style={{ color: '#cbd5e1' }}>{project.identifier}</strong>
              </span>
            )}
            {project.repoUrl && (
              <a
                href={project.repoUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: '#818cf8',
                  fontSize: '0.8rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  textDecoration: 'none',
                }}
              >
                <Github size={13} /> {project.repoUrl} <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(99,102,241,0.1)',
              border: '1px solid rgba(99,102,241,0.25)',
              color: '#94a3b8',
              borderRadius: 8,
              padding: '0.4rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Close panel"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* ─── Score & Summary Metrics Bar ───────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '0.75rem',
          padding: '0.85rem 1rem',
          borderRadius: 12,
          background: 'rgba(30,41,59,0.5)',
          border: '1px solid rgba(99,102,241,0.15)',
        }}
      >
        <div>
          <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.72rem' }}>OVERALL SCORE</span>
          <span style={{ color: '#4ade80', fontSize: '1.2rem', fontWeight: 700 }}>
            {project.overallScore ?? 0}
            <span style={{ color: '#64748b', fontSize: '0.75rem' }}>/{project.maxScore || 100}</span>
          </span>
        </div>

        <div>
          <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.72rem' }}>REQUIREMENT COVERAGE</span>
          <span style={{ color: '#818cf8', fontSize: '1.2rem', fontWeight: 700 }}>
            {project.requirementCoverage ?? 0}%
          </span>
        </div>

        <div>
          <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.72rem' }}>VERIFIED REQUIREMENTS</span>
          <span style={{ color: '#f8fafc', fontSize: '1.2rem', fontWeight: 700 }}>
            {requirementMapping.filter((r) => r.status === 'COMPLETE').length}
            <span style={{ color: '#64748b', fontSize: '0.75rem' }}>/{requirementMapping.length || 0}</span>
          </span>
        </div>

        <div>
          <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.72rem' }}>EVALUATION STATUS</span>
          <span
            style={{
              color: project.evaluationStatus === 'COMPLETED' ? '#4ade80' : '#f87171',
              fontSize: '0.9rem',
              fontWeight: 600,
            }}
          >
            {project.evaluationStatus || 'COMPLETED'}
          </span>
        </div>
      </div>

      {/* ─── Section 1: GitHub-Derived Contribution Evidence ───────────────── */}
      <div
        style={{
          borderRadius: 12,
          background: 'rgba(15,23,42,0.6)',
          border: '1px solid rgba(99,102,241,0.18)',
          padding: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.85rem' }}>
          <Github size={16} style={{ color: '#818cf8' }} />
          <h4 style={{ margin: 0, color: '#f1f5f9', fontSize: '0.92rem', fontWeight: 600 }}>
            GitHub-Derived Contribution Evidence
          </h4>
        </div>

        {/* Contributors List */}
        <div style={{ marginBottom: '1rem' }}>
          <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.78rem', marginBottom: 6 }}>
            Top Contributors & Activity
          </span>
          {Array.isArray(contributors) && contributors.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {contributors.map((c, i) => (
                <div
                  key={i}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 8,
                    background: 'rgba(99,102,241,0.12)',
                    border: '1px solid rgba(99,102,241,0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: '0.78rem',
                  }}
                >
                  <Users size={12} style={{ color: '#a5b4fc' }} />
                  <span style={{ color: '#f8fafc', fontWeight: 600 }}>{c.login || c.name || 'Contributor'}</span>
                  <span style={{ color: '#818cf8', fontSize: '0.72rem' }}>
                    ({c.contributions || c.commits || 0} commits)
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, color: '#64748b', fontSize: '0.78rem' }}>
              No individual contributor metrics returned from repository analysis.
            </p>
          )}
        </div>

        {/* Languages detected */}
        {Object.keys(languages).length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.78rem', marginBottom: 6 }}>
              Languages Detected
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.keys(languages).map((lang, lIdx) => (
                <span
                  key={lIdx}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: 'rgba(148,163,184,0.1)',
                    border: '1px solid rgba(148,163,184,0.25)',
                    color: '#cbd5e1',
                    fontSize: '0.72rem',
                  }}
                >
                  {lang}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Requirement to Code Mapping */}
        {requirementMapping.length > 0 && (
          <div>
            <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.78rem', marginBottom: 6 }}>
              Verified Requirement Implementation
            </span>
            <div style={{ display: 'grid', gap: 6 }}>
              {requirementMapping.map((req, rIdx) => {
                const isComplete = req.status === 'COMPLETE';
                const isPartial = req.status === 'PARTIAL';
                return (
                  <div
                    key={rIdx}
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: 8,
                      background: 'rgba(30,41,59,0.4)',
                      border: '1px solid rgba(99,102,241,0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.78rem',
                    }}
                  >
                    <span style={{ color: '#cbd5e1' }}>{req.requirement || req.title || `Requirement ${rIdx + 1}`}</span>
                    <span
                      style={{
                        color: isComplete ? '#4ade80' : isPartial ? '#fbbf24' : '#f87171',
                        fontWeight: 600,
                        fontSize: '0.72rem',
                      }}
                    >
                      {req.status || 'UNVERIFIED'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ─── Section 2: Student/Team Weekly Claims ─────────────────────────── */}
      <div
        style={{
          borderRadius: 12,
          background: 'rgba(15,23,42,0.6)',
          border: '1px solid rgba(168,85,247,0.18)',
          padding: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.85rem' }}>
          <FileText size={16} style={{ color: '#c084fc' }} />
          <h4 style={{ margin: 0, color: '#f1f5f9', fontSize: '0.92rem', fontWeight: 600 }}>
            Student / Team Weekly Claims
          </h4>
        </div>

        {currentStatus && (
          <div style={{ marginBottom: '0.75rem' }}>
            <span style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600 }}>CURRENT REPORTED STATUS:</span>
            <p style={{ margin: '2px 0 0', color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.5 }}>
              {currentStatus}
            </p>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          {/* Work Completed */}
          <div>
            <span style={{ display: 'block', color: '#4ade80', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
              ✅ Stated Work Completed
            </span>
            {workCompleted.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 16, color: '#cbd5e1', fontSize: '0.78rem' }}>
                {workCompleted.map((w, i) => (
                  <li key={i} style={{ marginBottom: 3 }}>{w}</li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, color: '#64748b', fontSize: '0.75rem' }}>No claimed tasks recorded.</p>
            )}
          </div>

          {/* Problems Faced */}
          <div>
            <span style={{ display: 'block', color: '#f87171', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
              ⚠️ Problems Faced
            </span>
            {problemsFaced.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 16, color: '#cbd5e1', fontSize: '0.78rem' }}>
                {problemsFaced.map((p, i) => (
                  <li key={i} style={{ marginBottom: 3 }}>{p}</li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, color: '#64748b', fontSize: '0.75rem' }}>No reported blockers.</p>
            )}
          </div>

          {/* Planned Work */}
          <div>
            <span style={{ display: 'block', color: '#818cf8', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
              📋 Planned Next Steps
            </span>
            {plannedWork.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 16, color: '#cbd5e1', fontSize: '0.78rem' }}>
                {plannedWork.map((pw, i) => (
                  <li key={i} style={{ marginBottom: 3 }}>{pw}</li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, color: '#64748b', fontSize: '0.75rem' }}>No planned tasks specified.</p>
            )}
          </div>
        </div>
      </div>

      {/* ─── Section 3: AI Evaluation, Gaps & Recommended Tasks ────────────── */}
      <div
        style={{
          borderRadius: 12,
          background: 'rgba(15,23,42,0.6)',
          border: '1px solid rgba(99,102,241,0.18)',
          padding: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.85rem' }}>
          <Sparkles size={16} style={{ color: '#fde047' }} />
          <h4 style={{ margin: 0, color: '#f1f5f9', fontSize: '0.92rem', fontWeight: 600 }}>
            AI Evaluation Breakdown & Recommended Tasks
          </h4>
        </div>

        {/* Criteria Score Breakdown */}
        {criteria.length > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.78rem', marginBottom: 6 }}>
              Rubric Criteria Scores
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem' }}>
              {criteria.map((c, cIdx) => (
                <div
                  key={cIdx}
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: 8,
                    background: 'rgba(30,41,59,0.5)',
                    border: '1px solid rgba(99,102,241,0.15)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.8rem' }}>{c.name}</span>
                    <span style={{ color: '#4ade80', fontWeight: 700, fontSize: '0.85rem' }}>{c.score} pts</span>
                  </div>
                  {c.feedback && (
                    <p style={{ margin: '3px 0 0', color: '#94a3b8', fontSize: '0.72rem', lineHeight: 1.4 }}>
                      {c.feedback}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          {/* Strengths */}
          <div>
            <span style={{ display: 'block', color: '#4ade80', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
              🌟 Verified Strengths
            </span>
            {strengths.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 16, color: '#cbd5e1', fontSize: '0.78rem' }}>
                {strengths.map((s, i) => (
                  <li key={i} style={{ marginBottom: 3 }}>{s}</li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, color: '#64748b', fontSize: '0.75rem' }}>No strengths specified.</p>
            )}
          </div>

          {/* Missing Concepts / Gaps */}
          <div>
            <span style={{ display: 'block', color: '#fbbf24', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
              📚 Gaps & Missing Concepts
            </span>
            {missingConcepts.length > 0 || missingRequirements.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 16, color: '#cbd5e1', fontSize: '0.78rem' }}>
                {missingRequirements.map((mr, i) => (
                  <li key={`req-${i}`} style={{ marginBottom: 3, color: '#f87171' }}>Req: {mr}</li>
                ))}
                {missingConcepts.map((mc, i) => (
                  <li key={`c-${i}`} style={{ marginBottom: 3 }}>{mc}</li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, color: '#4ade80', fontSize: '0.75rem' }}>Zero detected gaps!</p>
            )}
          </div>

          {/* Next Week Tasks */}
          <div>
            <span style={{ display: 'block', color: '#818cf8', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
              🚀 AI Recommended Next Tasks
            </span>
            {nextWeekTasks.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 16, color: '#cbd5e1', fontSize: '0.78rem' }}>
                {nextWeekTasks.map((t, i) => (
                  <li key={i} style={{ marginBottom: 3 }}>{t}</li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, color: '#64748b', fontSize: '0.75rem' }}>No upcoming action items.</p>
            )}
          </div>
        </div>

        {/* Overall Summary Feedback */}
        {project.feedback && (
          <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(99,102,241,0.15)' }}>
            <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600, marginBottom: 3 }}>
              OVERALL EVALUATOR FEEDBACK
            </span>
            <p style={{ margin: 0, color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.6 }}>
              {project.feedback}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamContributionPanel;
