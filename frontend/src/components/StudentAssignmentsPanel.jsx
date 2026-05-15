import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../config/api';
import { useWebSocket } from '../hooks/useWebSocket';
import AIEvaluationCard, { gradeColor } from './AIEvaluationCard';

const formatRemaining = (deadlineIso) => {
  const diff = new Date(deadlineIso).getTime() - Date.now();
  if (diff <= 0) return 'Deadline passed';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
};

const scoreText = (assignment) => {
  const professor = assignment?.submission?.professorEvaluation;
  const ai = assignment?.submission?.aiEvaluation;
  if (professor?.edited) return `${professor.totalScore}/${professor.maxScore} (professor)`;
  if (ai) return `${ai.totalScore}/${ai.maxScore} (AI)`;
  return 'Not graded yet';
};

// Shared components imported from AIEvaluationCard.jsx

const ProfessorReviewCard = ({ profEval }) => {
  if (!profEval) return null;
  const { totalScore, maxScore, summary, feedback } = profEval;
  const text = summary || feedback;
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(142,36,170,0.08) 0%, rgba(10,132,255,0.05) 100%)',
      border: '1px solid rgba(142,36,170,0.25)',
      borderRadius: '14px', padding: '1rem 1.1rem', marginTop: '0.75rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
        <span style={{ fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>👨‍🏫</span> Professor Review
        </span>
        {totalScore != null && (
          <span style={{ fontSize: '1.4rem', fontWeight: 800, color: gradeColor(totalScore), fontFamily: 'Outfit, sans-serif' }}>
            {totalScore}<span style={{ fontSize: '0.9rem', color: 'var(--muted)', fontWeight: 500 }}>/{maxScore || 100}</span>
          </span>
        )}
      </div>
      {text && (
        <p style={{
          fontSize: '0.875rem', color: 'var(--text-main)', lineHeight: 1.55,
          background: 'rgba(255,255,255,0.04)', borderRadius: '8px',
          padding: '0.6rem 0.8rem', borderLeft: '3px solid rgba(142,36,170,0.5)',
        }}>
          {text}
        </p>
      )}
    </div>
  );
};

const StudentAssignmentsPanel = () => {
  const [assignments, setAssignments] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [submissionText, setSubmissionText] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [clockTick, setClockTick] = useState(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const fileInputRef = useRef(null);
  const removalTimerRef = useRef(null);
  const [isAiExpanded, setIsAiExpanded] = useState(false);
  const [isProfExpanded, setIsProfExpanded] = useState(true);
  const { on, off } = useWebSocket();

  const selected = useMemo(
    () => assignments.find((item) => item.id === selectedId) || assignments[0] || null,
    [assignments, selectedId]
  );

  useEffect(() => {
    const timer = setInterval(() => setClockTick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => { if (removalTimerRef.current) clearTimeout(removalTimerRef.current); }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const fetchAssignments = async () => {
      try {
        setLoading(true);
        const res = await axios.get(`${API_BASE}/api/assignments/student`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const list = Array.isArray(res.data?.assignments) ? res.data.assignments : [];
        setAssignments(list);
        if (!selectedId && list.length) setSelectedId(list[0].id);
      } catch (err) {
        setMessage(err.response?.data?.message || 'Failed to load assignments.');
      } finally {
        setLoading(false);
      }
    };
    fetchAssignments();
  }, [refreshKey, selectedId]);

  useEffect(() => {
    const onStatus = () => setRefreshKey((v) => v + 1);
    const onDeleted = (data) => {
      const targetId = String(data?.assignmentId || data?.id || '').trim();
      if (!targetId) return;
      if (removalTimerRef.current) clearTimeout(removalTimerRef.current);
      setMessage(data?.message || 'Assignment removed by professor.');
      removalTimerRef.current = setTimeout(() => {
        setMessage('');
        setAssignments((prev) => prev.filter((item) => String(item.id) !== targetId));
        setSelectedId((prev) => (String(prev) === targetId ? '' : prev));
      }, Number(data?.removeAfterMs || 1200));
    };
    on('assignment-submission-status', onStatus);
    on('assignment-graded', onStatus);
    on('assignment-feedback-updated', onStatus);
    on('assignment-created', onStatus);
    on('assignmentDeleted', onDeleted);
    on('assignmentListRefresh', onStatus);
    on('dashboardUpdated', onStatus);
    return () => {
      off('assignment-submission-status', onStatus);
      off('assignment-graded', onStatus);
      off('assignment-feedback-updated', onStatus);
      off('assignment-created', onStatus);
      off('assignmentDeleted', onDeleted);
      off('assignmentListRefresh', onStatus);
      off('dashboardUpdated', onStatus);
    };
  }, [on, off]);

  const submit = async () => {
    if (!selected) return;
    if (!submissionText.trim() && !files.length) {
      setMessage('Add submission text or files first.');
      return;
    }
    try {
      setLoading(true);
      setMessage('Submitting and evaluating with AI…');
      const token = localStorage.getItem('token');
      const form = new FormData();
      form.append('submission_text', submissionText);
      files.forEach((file) => form.append('files', file));
      await axios.post(`${API_BASE}/api/assignments/${selected.id}/submit`, form, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSubmissionText('');
      setFiles([]);
      setMessage('Submission evaluated successfully.');
      setRefreshKey((v) => v + 1);
    } catch (err) {
      setMessage(err.response?.data?.message || 'Submission failed.');
    } finally {
      setLoading(false);
    }
  };

  const unsubmit = async () => {
    if (!selected) return;
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      await axios.delete(`${API_BASE}/api/assignments/${selected.id}/submission`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMessage('Submission removed.');
      setRefreshKey((v) => v + 1);
    } catch (err) {
      setMessage(err.response?.data?.message || 'Unable to unsubmit.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel" key={clockTick % 2}>
      <h2 className="text-2xl font-bold mb-2">Assignments</h2>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        AI evaluates submissions automatically with detailed feedback. Professors can override scores.
      </p>

      {message && (
        <p style={{
          marginBottom: '0.75rem', padding: '0.6rem 0.9rem', borderRadius: '8px',
          background: message.includes('fail') || message.includes('error') ? 'rgba(255,69,58,0.12)' : 'rgba(52,199,89,0.1)',
          color: message.includes('fail') || message.includes('error') ? '#FF6B6B' : '#34C759',
          fontSize: '0.875rem',
        }}>
          {message}
        </p>
      )}

      {loading && assignments.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>Loading assignments…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '1rem' }}>
          {/* Left: Assignment list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {assignments.map((assignment) => (
              <button
                key={assignment.id}
                onClick={() => setSelectedId(assignment.id)}
                style={{
                  textAlign: 'left',
                  border: `1px solid ${selected?.id === assignment.id ? 'rgba(10,132,255,0.5)' : 'var(--border)'}`,
                  background: selected?.id === assignment.id ? 'rgba(10,132,255,0.12)' : 'var(--surface-hover)',
                  borderRadius: '10px', padding: '0.75rem', cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <strong style={{ display: 'block', marginBottom: '0.2rem' }}>{assignment.title}</strong>
                <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>{assignment.courseKey}</p>
                <p style={{ color: assignment.deadlinePassed ? '#FF6B6B' : 'var(--muted)', fontSize: '0.78rem' }}>
                  {assignment.deadlinePassed ? '⏰ Late' : `⏳ ${formatRemaining(assignment.deadline)}`}
                </p>
                <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.2rem' }}>
                  {scoreText(assignment)}
                </p>
              </button>
            ))}
            {assignments.length === 0 && <p style={{ color: 'var(--muted)' }}>No assignments posted yet.</p>}
          </div>

          {/* Right: Detail + submission + feedback */}
          <div>
            {!selected ? (
              <p style={{ color: 'var(--muted)' }}>Select an assignment.</p>
            ) : (
              <>
                {(() => {
                  const isLocked = selected.deadlinePassed || !!selected.submission?.professorEvaluation;
                  return (
                    <>
                      <h3 className="text-xl font-semibold mb-2">{selected.title}</h3>
                      <p style={{ color: 'var(--muted)', marginBottom: '0.75rem' }}>{selected.description || 'No description.'}</p>
                <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                  📅 Deadline: {new Date(selected.deadline).toLocaleString()} · {formatRemaining(selected.deadline)}
                </p>
                <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.85rem' }}>
                  📊 Status: <strong>{selected.submission?.gradingStatus || 'not submitted'}</strong>
                </p>

                <textarea
                  className="glass-input"
                  rows="6"
                  style={{ width: '100%', marginBottom: '0.65rem' }}
                  placeholder="Paste your submission text here…"
                  value={submissionText}
                  disabled={isLocked}
                  onChange={(e) => setSubmissionText(e.target.value)}
                />

                <input
                  ref={fileInputRef} type="file" multiple
                  style={{ display: 'none' }} disabled={isLocked}
                  onChange={(e) => setFiles(Array.from(e.target.files || []))}
                />

                <div
                  onClick={isLocked ? undefined : () => fileInputRef.current?.click()}
                  onDragEnter={(e) => { e.preventDefault(); if (!isLocked) setIsDraggingFiles(true); }}
                  onDragOver={(e) => { e.preventDefault(); if (!isLocked) setIsDraggingFiles(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setIsDraggingFiles(false); }}
                  onDrop={(e) => {
                    e.preventDefault(); e.stopPropagation(); setIsDraggingFiles(false);
                    if (!isLocked) setFiles(Array.from(e.dataTransfer?.files || []));
                  }}
                  role="button" tabIndex={isLocked ? -1 : 0}
                  style={{
                    width: '100%', marginBottom: '0.75rem', padding: '0.85rem 1rem',
                    borderRadius: '10px', textAlign: 'center',
                    border: `1px dashed ${isDraggingFiles ? '#0A84FF' : 'var(--border)'}`,
                    background: isDraggingFiles ? 'rgba(10,132,255,0.1)' : 'var(--surface-hover)',
                    color: isLocked ? 'var(--muted)' : 'inherit',
                    cursor: isLocked ? 'not-allowed' : 'pointer',
                    transition: 'border-color 120ms ease, background 120ms ease',
                    fontSize: '0.875rem',
                  }}
                >
                  {selected.submission?.professorEvaluation ? 'Submission closed — Professor review saved' : selected.deadlinePassed ? 'Submission closed — deadline passed' : files.length > 0 ? `${files.length} file(s) selected` : '📎 Drop files here or click to attach'}
                </div>

                <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '1rem' }}>
                  <button className="btn-primary" disabled={isLocked || loading}
                    style={{ opacity: isLocked || loading ? 0.6 : 1 }}
                    onClick={submit}>
                    {loading ? 'Evaluating…' : selected.submission ? 'Resubmit' : 'Submit'}
                  </button>
                  <button className="btn-secondary"
                    disabled={isLocked || !selected.submission || loading}
                    style={{ opacity: isLocked || !selected.submission || loading ? 0.6 : 1 }}
                    onClick={unsubmit}>
                    Unsubmit
                  </button>
                </div>

                {/* AI Evaluation Collapsible */}
                {selected.submission?.aiEvaluation && (
                  <div style={{ marginBottom: '1rem' }}>
                    <button
                      onClick={() => setIsAiExpanded(!isAiExpanded)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: 'var(--surface-hover)', border: '1px solid var(--border)',
                        padding: '0.8rem 1rem', borderRadius: '10px', cursor: 'pointer',
                        fontWeight: 600, color: 'var(--text-main)',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        🤖 AI Evaluation
                      </span>
                      <span style={{ transform: isAiExpanded ? 'rotate(90deg)' : 'none', transition: '0.2s' }}>▶</span>
                    </button>
                    {isAiExpanded && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <AIEvaluationCard aiEval={selected.submission.aiEvaluation} />
                      </div>
                    )}
                  </div>
                )}

                {/* Professor Review Collapsible */}
                {selected.submission?.professorEvaluation && (
                  <div>
                    <button
                      onClick={() => setIsProfExpanded(!isProfExpanded)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: 'var(--surface-hover)', border: '1px solid var(--border)',
                        padding: '0.8rem 1rem', borderRadius: '10px', cursor: 'pointer',
                        fontWeight: 600, color: 'var(--text-main)',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        👨‍🏫 Professor Review
                      </span>
                      <span style={{ transform: isProfExpanded ? 'rotate(90deg)' : 'none', transition: '0.2s' }}>▶</span>
                    </button>
                    {isProfExpanded && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <ProfessorReviewCard profEval={selected.submission.professorEvaluation} />
                      </div>
                    )}
                  </div>
                )}
              </>
            ); })()}
            </>
          )}
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentAssignmentsPanel;
