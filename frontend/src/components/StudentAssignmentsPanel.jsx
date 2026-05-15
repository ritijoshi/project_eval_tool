import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../config/api';
import { useWebSocket } from '../hooks/useWebSocket';

const formatRemaining = (deadlineIso) => {
  const now = Date.now();
  const target = new Date(deadlineIso).getTime();
  const diff = target - now;
  if (diff <= 0) return 'Deadline passed';

  const totalSeconds = Math.floor(diff / 1000);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
};

const scoreText = (assignment) => {
  const professor = assignment?.submission?.professorEvaluation;
  const ai = assignment?.submission?.aiEvaluation;
  if (professor && professor.edited) {
    return `${professor.totalScore}/${professor.maxScore} (professor)`;
  }
  if (ai) {
    return `${ai.totalScore}/${ai.maxScore} (ai)`;
  }
  return 'Not graded yet';
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

  const { on, off } = useWebSocket();

  const selected = useMemo(
    () => assignments.find((item) => item.id === selectedId) || assignments[0] || null,
    [assignments, selectedId]
  );

  const handleSelectedFiles = (incomingFiles) => {
    const nextFiles = Array.from(incomingFiles || []);
    if (nextFiles.length) {
      setFiles(nextFiles);
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFiles(false);

    if (selected?.deadlinePassed) return;
    handleSelectedFiles(event.dataTransfer?.files);
  };

  useEffect(() => {
    const timer = setInterval(() => setClockTick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const fetchAssignments = async () => {
      try {
        setLoading(true);
        const config = { headers: { Authorization: `Bearer ${token}` } };
        const res = await axios.get(`${API_BASE}/api/assignments/student`, config);
        const list = Array.isArray(res.data?.assignments) ? res.data.assignments : [];
        setAssignments(list);
        if (!selectedId && list.length) {
          setSelectedId(list[0].id);
        }
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
    const onGraded = () => setRefreshKey((v) => v + 1);
    const onFeedback = () => setRefreshKey((v) => v + 1);
    const onCreated = () => setRefreshKey((v) => v + 1);

    on('assignment-submission-status', onStatus);
    on('assignment-graded', onGraded);
    on('assignment-feedback-updated', onFeedback);
    on('assignment-created', onCreated);

    return () => {
      off('assignment-submission-status', onStatus);
      off('assignment-graded', onGraded);
      off('assignment-feedback-updated', onFeedback);
      off('assignment-created', onCreated);
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
      setMessage('Submitting and evaluating...');
      const token = localStorage.getItem('token');
      const form = new FormData();
      form.append('submission_text', submissionText);
      files.forEach((file) => form.append('files', file));

      await axios.post(`${API_BASE}/api/assignments/${selected.id}/submit`, form, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      setSubmissionText('');
      setFiles([]);
      setMessage('Submission sent.');
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
        AI evaluates submissions automatically, and professors can override scores and feedback.
      </p>

      {message && <p style={{ marginBottom: '0.75rem', color: 'var(--muted)' }}>{message}</p>}

      {loading && assignments.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>Loading assignments...</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {assignments.map((assignment) => (
              <button
                key={assignment.id}
                onClick={() => setSelectedId(assignment.id)}
                style={{
                  textAlign: 'left',
                  border: '1px solid var(--border)',
                  background: selected?.id === assignment.id ? 'rgba(10,132,255,0.15)' : 'var(--surface-hover)',
                  borderRadius: '10px',
                  padding: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                <strong>{assignment.title}</strong>
                <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{assignment.courseKey}</p>
                <p style={{ color: assignment.deadlinePassed ? '#FF6B6B' : 'var(--muted)', fontSize: '0.8rem' }}>
                  {assignment.deadlinePassed ? 'Late' : `Time left: ${formatRemaining(assignment.deadline)}`}
                </p>
                <p style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                  Score: {scoreText(assignment)}
                </p>
              </button>
            ))}
            {assignments.length === 0 && <p style={{ color: 'var(--muted)' }}>No assignments posted yet.</p>}
          </div>

          <div>
            {!selected ? (
              <p style={{ color: 'var(--muted)' }}>Select an assignment.</p>
            ) : (
              <>
                <h3 className="text-xl font-semibold mb-2">{selected.title}</h3>
                <p style={{ color: 'var(--muted)', marginBottom: '0.75rem' }}>{selected.description || 'No description.'}</p>
                <p style={{ color: 'var(--muted)', marginBottom: '0.5rem' }}>
                  Deadline: {new Date(selected.deadline).toLocaleString()} ({formatRemaining(selected.deadline)})
                </p>
                <p style={{ color: 'var(--muted)', marginBottom: '0.75rem' }}>
                  Grading Status: {selected.submission?.gradingStatus || 'not_submitted'}
                </p>

                <textarea
                  className="glass-input"
                  rows="7"
                  style={{ width: '100%', marginBottom: '0.75rem' }}
                  placeholder="Paste your submission text"
                  value={submissionText}
                  disabled={selected.deadlinePassed}
                  onChange={(e) => setSubmissionText(e.target.value)}
                />

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  disabled={selected.deadlinePassed}
                  onChange={(e) => handleSelectedFiles(e.target.files)}
                />

                <div
                  onClick={selected.deadlinePassed ? undefined : openFilePicker}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    if (!selected.deadlinePassed) setIsDraggingFiles(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!selected.deadlinePassed) setIsDraggingFiles(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setIsDraggingFiles(false);
                  }}
                  onDrop={handleFileDrop}
                  role="button"
                  tabIndex={selected.deadlinePassed ? -1 : 0}
                  style={{
                    width: '100%',
                    marginBottom: '0.75rem',
                    padding: '1rem',
                    borderRadius: '12px',
                    border: `1px dashed ${isDraggingFiles ? '#0A84FF' : 'var(--border)'}`,
                    background: isDraggingFiles ? 'rgba(10,132,255,0.14)' : 'var(--surface-hover)',
                    color: selected.deadlinePassed ? 'var(--muted)' : 'inherit',
                    cursor: selected.deadlinePassed ? 'not-allowed' : 'pointer',
                    transition: 'border-color 120ms ease, background 120ms ease',
                  }}
                >
                  <strong style={{ display: 'block', marginBottom: '0.25rem' }}>
                    {selected.deadlinePassed ? 'Submission closed' : 'Drag and drop files here'}
                  </strong>
                  <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                    {selected.deadlinePassed ? 'Deadline passed' : 'Or click to browse and attach files'}
                  </span>
                  {files.length > 0 && (
                    <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {files.map((file) => (
                        <span key={`${file.name}-${file.size}`} style={{ color: 'var(--text)', fontSize: '0.88rem' }}>
                          {file.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '1rem' }}>
                  <button
                    className="btn-primary"
                    disabled={selected.deadlinePassed || loading}
                    style={{ opacity: selected.deadlinePassed || loading ? 0.6 : 1 }}
                    onClick={submit}
                  >
                    {selected.submission ? 'Resubmit' : 'Submit'}
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={selected.deadlinePassed || !selected.submission || loading}
                    style={{ opacity: selected.deadlinePassed || !selected.submission || loading ? 0.6 : 1 }}
                    onClick={unsubmit}
                  >
                    Unsubmit
                  </button>
                </div>

                {selected.submission?.aiEvaluation && (
                  <div className="glass-card" style={{ padding: '1rem' }}>
                    <h4 className="font-semibold mb-2">AI Evaluation</h4>
                    <p>Score: {selected.submission.aiEvaluation.totalScore}/{selected.submission.aiEvaluation.maxScore}</p>
                    <p style={{ color: 'var(--muted)' }}>{selected.submission.aiEvaluation.summary}</p>
                  </div>
                )}

                {selected.submission?.professorEvaluation && (
                  <div className="glass-card" style={{ padding: '1rem', marginTop: '0.75rem' }}>
                    <h4 className="font-semibold mb-2">Professor Review</h4>
                    <p>
                      Score: {selected.submission.professorEvaluation.totalScore}/{selected.submission.professorEvaluation.maxScore}
                    </p>
                    <p style={{ color: 'var(--muted)' }}>{selected.submission.professorEvaluation.summary || selected.submission.professorEvaluation.feedback}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentAssignmentsPanel;
