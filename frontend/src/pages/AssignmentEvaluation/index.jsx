import { useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { API_BASE } from '../../config/api';
import { useActiveCourse } from '../../context/ActiveCourseContext';
import {
  getSessionsForCourse,
  exportAssignmentEvalReport,
  getAssignmentLeaderboard,
  deleteEvalSession,
} from '../../services/assignmentEvalApi';
import ReportHistoryPanel from '../../components/AssignmentEvaluation/ReportHistoryPanel';
import AssignmentLeaderboard from '../../components/AssignmentEvaluation/AssignmentLeaderboard';

// ─── Helpers ────────────────────────────────────────────────────────────────
const normalizeCriterionScore = (score, maxScore) => {
  const numericScore = Number(score ?? 0);
  const numericMax = Number(maxScore ?? 0);
  if (!Number.isFinite(numericScore)) return '—';
  if (numericMax > 0) return Number(((numericScore / numericMax) * 10).toFixed(1));
  if (numericScore <= 10) return Number(numericScore.toFixed(1));
  return Number(numericScore.toFixed(1));
};

const formatList = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || '—';
  return value || '—';
};

const formatConfidence = (value) => {
  if (value === undefined || value === null || value === '') return '—';
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return '—';
  return `${(confidence <= 1 ? confidence * 100 : confidence).toFixed(0)}%`;
};

const formatDate = (dateStr) =>
  dateStr
    ? new Date(dateStr).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '—';

const statusBadge = (s) => {
  const map = {
    COMPLETED:       { bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.35)', color: '#4ade80' },
    FAILED:          { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)', color: '#f87171' },
    EVALUATING:      { bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.35)',  color: '#fbbf24' },
    UPLOADED:        { bg: 'rgba(148,163,184,0.1)',  border: 'rgba(148,163,184,0.3)', color: '#94a3b8' },
    PARSING_RUBRIC:  { bg: 'rgba(129,140,248,0.12)', border: 'rgba(129,140,248,0.35)', color: '#818cf8' },
    EXTRACTING:      { bg: 'rgba(129,140,248,0.12)', border: 'rgba(129,140,248,0.35)', color: '#818cf8' },
  };
  const style = map[s] || map.UPLOADED;
  return (
    <span style={{
      background: style.bg, border: `1px solid ${style.border}`, color: style.color,
      borderRadius: 20, padding: '2px 10px', fontSize: '0.72rem', fontWeight: 600,
    }}>
      {s || 'UNKNOWN'}
    </span>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────
const AssignmentEvaluation = () => {
  const { activeCourseId, activeCourse } = useActiveCourse();

  // Form fields
  const [assignments, setAssignments] = useState([]);
  const [assignmentId, setAssignmentId] = useState('');
  const [sessionLabel, setSessionLabel] = useState('');
  const [assignmentType, setAssignmentType] = useState('text');
  const [rubricFile, setRubricFile] = useState(null);
  const [submissionsZip, setSubmissionsZip] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(false);

  // Session submission
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Live session
  const [activeSessionId, setActiveSessionId] = useState('');
  const [sessionInfo, setSessionInfo] = useState(null);
  const [results, setResults] = useState([]);
  const [pollingStatus, setPollingStatus] = useState('');

  // Session history list (for the active course)
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState('');
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState(null);
  const [deletingSessionId, setDeletingSessionId] = useState(null);

  // Leaderboard
  const [leaderboard, setLeaderboard] = useState(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('results'); // 'results' | 'leaderboard'

  // Export
  const [exporting, setExporting] = useState(false);

  const pollingRef = useRef(null);

  // ─── Load assignments & sessions when active course changes ───────────────
  useEffect(() => {
    if (!activeCourseId || activeCourseId === 'all') {
      setAssignments([]);
      setAssignmentId('');
      setSessions([]);
      return;
    }

    const fetchMeta = async () => {
      setLoadingMeta(true);
      try {
        const token = localStorage.getItem('token');
        const config = { headers: { Authorization: `Bearer ${token}` } };
        const res = await axios.get(`${API_BASE}/api/professor/assignments?courseId=${activeCourseId}`, config);
        const list = Array.isArray(res.data?.assignments) ? res.data.assignments : [];
        setAssignments(list);
        setAssignmentId(list[0]?._id || '');
      } catch {
        setAssignments([]);
        setAssignmentId('');
      } finally {
        setLoadingMeta(false);
      }
    };

    const fetchSessions = async () => {
      setSessionsLoading(true);
      try {
        const data = await getSessionsForCourse(activeCourseId);
        setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      } catch {
        setSessions([]);
      } finally {
        setSessionsLoading(false);
      }
    };

    fetchMeta();
    fetchSessions();
  }, [activeCourseId]);

  // ─── Polling for live session ─────────────────────────────────────────────
  const startPolling = useCallback((sessionId) => {
    if (pollingRef.current) clearTimeout(pollingRef.current);
    let cancelled = false;

    const poll = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/api/assignment-eval/${sessionId}/results`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message);
        if (!cancelled) {
          setSessionInfo(data.session || null);
          setResults(Array.isArray(data.results) ? data.results : []);
          setPollingStatus(
            data.session?.status
              ? `Status: ${data.session.status} · ${data.session.processedStudents ?? 0}/${data.session.totalStudents ?? 0} students`
              : 'Processing…'
          );
          if (['COMPLETED', 'FAILED'].includes(data.session?.status)) return;
        }
        if (!cancelled) {
          pollingRef.current = setTimeout(poll, 4000);
        }
      } catch {
        if (!cancelled) setPollingStatus('Could not fetch session results.');
      }
    };

    pollingRef.current = setTimeout(poll, 1000);
    return () => {
      cancelled = true;
      clearTimeout(pollingRef.current);
    };
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    const cleanup = startPolling(activeSessionId);
    return cleanup;
  }, [activeSessionId, startPolling]);

  // ─── Submit form ──────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!activeCourseId || activeCourseId === 'all') {
      setFormError('Please select a specific course first.');
      return;
    }
    if (!assignmentId) {
      setFormError('Please select an assignment.');
      return;
    }
    if (!rubricFile || !submissionsZip) {
      setFormError('Please upload both a rubric file and a submissions ZIP.');
      return;
    }

    setSubmitting(true);
    setResults([]);
    setSessionInfo(null);
    setPollingStatus('Starting evaluation...');
    setLeaderboard(null);
    setActiveTab('results');

    try {
      const formData = new FormData();
      formData.append('courseId', activeCourseId);
      formData.append('assignmentId', assignmentId);
      formData.append('sessionLabel', sessionLabel || 'Assignment Evaluation');
      formData.append('assignmentType', assignmentType);
      formData.append('rubric', rubricFile);
      formData.append('submissions', submissionsZip);

      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/api/assignment-eval/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Could not start evaluation.');

      setActiveSessionId(data.sessionId);
      setPollingStatus(`Evaluation queued. Session: ${data.sessionId}`);

      // Refresh session list
      getSessionsForCourse(activeCourseId).then((d) => setSessions(Array.isArray(d.sessions) ? d.sessions : [])).catch(() => {});
    } catch (err) {
      setFormError(err.message || 'Evaluation failed to start.');
      setPollingStatus('');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── View results for a past session ─────────────────────────────────────
  const handleViewSession = async (session) => {
    setActiveSessionId(session._id);
    setSessionInfo(session);
    setResults([]);
    setLeaderboard(null);
    setActiveTab('results');
    setPollingStatus(`Loading session ${session._id}…`);
  };

  // ─── Delete a session (with cascade) ─────────────────────────────────────
  const handleDeleteSession = async (sessionId) => {
    setDeletingSessionId(sessionId);
    setConfirmDeleteSessionId(null);
    setSessionsError('');
    try {
      await deleteEvalSession(sessionId);
      const refreshed = await getSessionsForCourse(activeCourseId);
      setSessions(Array.isArray(refreshed.sessions) ? refreshed.sessions : []);
      // If viewing the deleted session, clear the panel
      if (activeSessionId === sessionId) {
        setActiveSessionId('');
        setSessionInfo(null);
        setResults([]);
        setPollingStatus('');
        setLeaderboard(null);
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to delete session. Please try again.';
      setSessionsError(msg);
    } finally {
      setDeletingSessionId(null);
    }
  };

  // ─── Load leaderboard for current session ─────────────────────────────────
  const handleLoadLeaderboard = async () => {
    if (!activeSessionId) return;
    setLeaderboardLoading(true);
    setActiveTab('leaderboard');
    try {
      const data = await getAssignmentLeaderboard(activeSessionId);
      setLeaderboard(data);
    } catch {
      setLeaderboard(null);
    } finally {
      setLeaderboardLoading(false);
    }
  };

  // ─── Export current session ───────────────────────────────────────────────
  const handleExport = async () => {
    if (!activeSessionId) return;
    setExporting(true);
    try {
      const blob = await exportAssignmentEvalReport(activeSessionId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const courseCode = activeCourse?.courseCode || 'eval';
      const title = sessionInfo?.assignmentTitle || sessionInfo?.sessionLabel || 'assignment';
      a.download = `${courseCode}_${title}_EvalReport.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // silent
    } finally {
      setExporting(false);
    }
  };

  const criterionNames = Array.from(
    new Set(results.flatMap((r) => Object.keys(r?.scoreBreakdown || {})))
  );

  // ─── Guard for 'all courses' ─────────────────────────────────────────────
  if (!activeCourseId || activeCourseId === 'all') {
    return (
      <div style={{
        maxWidth: 640, margin: '4rem auto', padding: '2.5rem 2rem',
        borderRadius: 18, background: 'rgba(17,24,39,0.85)',
        border: '1px solid rgba(99,102,241,0.2)',
        textAlign: 'center', color: '#94a3b8',
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</div>
        <h3 style={{ color: '#e2e8f0', marginBottom: '0.5rem' }}>Select a Course First</h3>
        <p style={{ marginBottom: 0, fontSize: '0.9rem' }}>
          Assignment Evaluation is scoped to a specific course. Use the course switcher in the sidebar to pick one.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '1.5rem auto', padding: '0 1rem' }}>
      {/* Page title */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700 }}>
          Assignment Evaluation
        </h2>
        <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '0.85rem' }}>
          {activeCourse?.title || activeCourse?.courseCode || ''} · Batch AI evaluation with rubric scoring
        </p>
      </div>

      {/* ─── Upload Form ─────────────────────────────────────────────────────── */}
      <div style={{
        borderRadius: 16, background: 'rgba(17,24,39,0.85)',
        border: '1px solid rgba(99,102,241,0.2)',
        padding: '1.5rem', marginBottom: '2rem',
        backdropFilter: 'blur(10px)',
      }}>
        <h3 style={{ margin: '0 0 1rem', color: '#e2e8f0', fontSize: '1rem', fontWeight: 600 }}>
          🚀 Start New Evaluation
        </h3>
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.85rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
            {/* Assignment dropdown */}
            <div>
              <label style={{ display: 'block', marginBottom: 4, color: '#94a3b8', fontSize: '0.8rem' }}>Assignment</label>
              <select
                className="glass-input"
                value={assignmentId}
                onChange={(e) => setAssignmentId(e.target.value)}
                disabled={loadingMeta || assignments.length === 0}
                style={{ width: '100%' }}
              >
                {!assignmentId && <option value="">Select assignment…</option>}
                {assignments.map((a) => (
                  <option key={a._id} value={a._id}>{a.title || a.name || 'Assignment'}</option>
                ))}
                {!loadingMeta && assignments.length === 0 && (
                  <option disabled value="">No assignments in this course</option>
                )}
              </select>
            </div>

            {/* Assignment type */}
            <div>
              <label style={{ display: 'block', marginBottom: 4, color: '#94a3b8', fontSize: '0.8rem' }}>Submission Type</label>
              <select
                className="glass-input"
                value={assignmentType}
                onChange={(e) => setAssignmentType(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="text">Text</option>
                <option value="code">Code</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>
          </div>

          {/* Session label */}
          <div>
            <label style={{ display: 'block', marginBottom: 4, color: '#94a3b8', fontSize: '0.8rem' }}>Session Label (optional)</label>
            <input
              className="glass-input"
              placeholder="e.g. Lab 3 Evaluation"
              value={sessionLabel}
              onChange={(e) => setSessionLabel(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
            {/* Rubric file */}
            <label style={{ display: 'block', cursor: 'pointer' }}>
              <span style={{ display: 'block', marginBottom: 4, color: '#94a3b8', fontSize: '0.8rem' }}>Rubric File (.pdf, .docx, .txt, .md)</span>
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md"
                onChange={(e) => setRubricFile(e.target.files?.[0] || null)}
                style={{ color: '#cbd5e1', fontSize: '0.82rem' }}
              />
              {rubricFile && <span style={{ fontSize: '0.75rem', color: '#4ade80' }}>✓ {rubricFile.name}</span>}
            </label>

            {/* Submissions ZIP */}
            <label style={{ display: 'block', cursor: 'pointer' }}>
              <span style={{ display: 'block', marginBottom: 4, color: '#94a3b8', fontSize: '0.8rem' }}>Student Submissions (.zip)</span>
              <input
                type="file"
                accept=".zip"
                onChange={(e) => setSubmissionsZip(e.target.files?.[0] || null)}
                style={{ color: '#cbd5e1', fontSize: '0.82rem' }}
              />
              {submissionsZip && <span style={{ fontSize: '0.75rem', color: '#4ade80' }}>✓ {submissionsZip.name}</span>}
            </label>
          </div>

          {formError && (
            <p style={{ margin: 0, color: '#f87171', fontSize: '0.85rem', padding: '0.5rem 0.75rem', background: 'rgba(248,113,113,0.08)', borderRadius: 8, border: '1px solid rgba(248,113,113,0.2)' }}>
              {formError}
            </p>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={submitting || !assignmentId || !rubricFile || !submissionsZip}
            style={{ alignSelf: 'start', opacity: submitting ? 0.7 : 1 }}
          >
            {submitting ? '⏳ Starting…' : '▶ Start Assignment Evaluation'}
          </button>
        </form>
      </div>

      {/* ─── Live Session Results ─────────────────────────────────────────────── */}
      {(sessionInfo || results.length > 0 || pollingStatus) && (
        <div style={{
          borderRadius: 16, background: 'rgba(15,23,42,0.9)',
          border: '1px solid rgba(99,102,241,0.2)',
          marginBottom: '2rem', overflow: 'hidden',
        }}>
          {/* Session header */}
          <div style={{
            padding: '1rem 1.5rem',
            background: 'linear-gradient(135deg,rgba(99,102,241,0.12),rgba(168,85,247,0.08))',
            borderBottom: '1px solid rgba(99,102,241,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem',
          }}>
            <div>
              <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Session: </span>
              <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.85rem' }}>
                {sessionInfo?.assignmentTitle || sessionInfo?.sessionLabel || activeSessionId}
              </span>
              {sessionInfo?.status && (
                <span style={{ marginLeft: 10 }}>{statusBadge(sessionInfo.status)}</span>
              )}
              {sessionInfo && (
                <span style={{ color: '#94a3b8', fontSize: '0.78rem', marginLeft: 10 }}>
                  {sessionInfo.processedStudents ?? 0}/{sessionInfo.totalStudents ?? 0} students
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {sessionInfo?.status === 'COMPLETED' && (
                <>
                  <button
                    onClick={handleLoadLeaderboard}
                    disabled={leaderboardLoading}
                    style={tabBtn(activeTab === 'leaderboard')}
                  >
                    🏆 Leaderboard
                  </button>
                  <button
                    onClick={handleExport}
                    disabled={exporting}
                    style={tabBtn(false, '#059669')}
                  >
                    {exporting ? '⏳…' : '⬇ Export Excel'}
                  </button>
                </>
              )}
              <button onClick={() => setActiveTab('results')} style={tabBtn(activeTab === 'results')}>
                📋 Results
              </button>
            </div>
          </div>

          {pollingStatus && (
            <p style={{ margin: 0, padding: '0.5rem 1.5rem', color: '#94a3b8', fontSize: '0.8rem', borderBottom: '1px solid rgba(30,41,59,0.6)' }}>
              {pollingStatus}
            </p>
          )}

          {/* Leaderboard tab */}
          {activeTab === 'leaderboard' && (
            <div style={{ padding: '1.25rem' }}>
              {leaderboardLoading ? (
                <p style={{ color: '#94a3b8', textAlign: 'center' }}>Loading leaderboard…</p>
              ) : leaderboard ? (
                <AssignmentLeaderboard
                  sessionId={activeSessionId}
                  leaderboard={leaderboard.leaderboard}
                  rubricCriteria={leaderboard.rubricCriteria}
                  totalEvaluated={leaderboard.totalEvaluated}
                  totalStudents={leaderboard.totalStudents}
                  assignmentTitle={leaderboard.assignmentTitle}
                />
              ) : (
                <p style={{ color: '#64748b', textAlign: 'center' }}>Could not load leaderboard. Try again.</p>
              )}
            </div>
          )}

          {/* Results table tab */}
          {activeTab === 'results' && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', color: '#f8fafc', fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    {['Student', 'Submission', 'Overall /Max', ...criterionNames, 'Confidence', 'Strengths', 'Mistakes', 'Missing Concepts', 'Feedback', 'Status'].map((h) => (
                      <th key={h} style={{
                        borderBottom: '1px solid #334155',
                        padding: '0.5rem 0.75rem',
                        textAlign: 'left',
                        color: '#94a3b8',
                        fontWeight: 600,
                        fontSize: '0.75rem',
                        whiteSpace: 'nowrap',
                        background: 'rgba(15,23,42,0.5)',
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.length === 0 ? (
                    <tr>
                      <td colSpan={10 + criterionNames.length} style={{ padding: '1.5rem', color: '#64748b', textAlign: 'center' }}>
                        {sessionInfo?.failureMetadata?.errorMessage ||
                          (sessionInfo?.status === 'COMPLETED'
                            ? 'Session completed but no result records were returned.'
                            : 'Evaluation is processing student results…')}
                      </td>
                    </tr>
                  ) : results.map((result) => (
                    <tr key={result._id || `${result.studentName}-${result.rollNumber}`}
                      style={{ borderBottom: '1px solid rgba(30,41,59,0.7)' }}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{result.studentName || 'Unknown'}</div>
                        <div style={{ color: '#64748b', fontSize: '0.75rem' }}>{result.rollNumber}</div>
                      </td>
                      <td style={td}>{result.fileName || result.file_name || `${result.studentName}.txt`}</td>
                      <td style={td}>
                        {result.evaluationStatus === 'FAILED' || result.overallScore == null
                          ? '—'
                          : `${Number(result.overallScore ?? result.score).toFixed(1)}/${result.maxScore ?? 100}`}
                      </td>
                      {criterionNames.map((criterion) => {
                        const entry = result.scoreBreakdown?.[criterion] || {};
                        const score = normalizeCriterionScore(entry.score, entry.maxScore);
                        return <td key={`${result._id}-${criterion}`} style={td}>{score === '—' ? '—' : score}</td>;
                      })}
                      <td style={td}>{formatConfidence(result.confidence)}</td>
                      <td style={{ ...td, minWidth: 160 }}>{result.evaluationStatus === 'FAILED' ? 'N/A' : formatList(result.strengths)}</td>
                      <td style={{ ...td, minWidth: 160 }}>{result.evaluationStatus === 'FAILED' ? result.errorMessage || '—' : formatList(result.mistakes)}</td>
                      <td style={{ ...td, minWidth: 160 }}>{formatList(result.missingConcepts || result.missingKeyPoints)}</td>
                      <td style={{ ...td, minWidth: 200 }}>{result.evaluationStatus === 'FAILED' ? result.errorMessage || '—' : (result.overallFeedback || result.feedback || '—')}</td>
                      <td style={td}>{statusBadge(result.evaluationStatus)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── Session History ──────────────────────────────────────────────────── */}
      <div style={{
        borderRadius: 16, background: 'rgba(17,24,39,0.85)',
        border: '1px solid rgba(99,102,241,0.2)',
        marginBottom: '2rem', overflow: 'hidden',
      }}>
        <div style={{
          padding: '1rem 1.5rem',
          borderBottom: '1px solid rgba(99,102,241,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h3 style={{ margin: 0, color: '#e2e8f0', fontWeight: 600, fontSize: '1rem' }}>📜 Session History</h3>
          {sessionsLoading && <span style={{ color: '#64748b', fontSize: '0.8rem' }}>Loading…</span>}
        </div>
        {sessionsError && (
          <p style={{ margin: 0, padding: '0.65rem 1.5rem', color: '#f87171', fontSize: '0.82rem', borderBottom: '1px solid rgba(248,113,113,0.2)' }}>
            {sessionsError}
          </p>
        )}
        {sessions.length === 0 && !sessionsLoading ? (
          <p style={{ padding: '1.25rem 1.5rem', color: '#64748b', fontSize: '0.85rem', margin: 0 }}>
            No past sessions for this course.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem', color: '#cbd5e1' }}>
              <thead>
                <tr>
                  {['Assignment', 'Label', 'Date', 'Status', 'Students', 'Actions'].map((h) => (
                    <th key={h} style={{
                      borderBottom: '1px solid rgba(30,41,59,0.8)',
                      padding: '0.5rem 1rem',
                      textAlign: h === 'Actions' ? 'right' : 'left',
                      color: '#94a3b8',
                      fontWeight: 600,
                      fontSize: '0.75rem',
                      whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const isConfirming = confirmDeleteSessionId === s._id;
                  const isDeleting   = deletingSessionId === s._id;
                  return (
                    <tr
                      key={s._id}
                      style={{ borderBottom: '1px solid rgba(30,41,59,0.5)', transition: 'background 0.12s' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(99,102,241,0.04)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '0.5rem 1rem' }}>
                        <div style={{ fontWeight: 500 }}>{s.assignmentId?.title || s.assignmentTitle || '—'}</div>
                      </td>
                      <td style={{ padding: '0.5rem 1rem', color: '#64748b' }}>{s.sessionLabel || '—'}</td>
                      <td style={{ padding: '0.5rem 1rem', whiteSpace: 'nowrap' }}>{formatDate(s.createdAt)}</td>
                      <td style={{ padding: '0.5rem 1rem' }}>{statusBadge(s.status)}</td>
                      <td style={{ padding: '0.5rem 1rem', textAlign: 'center' }}>
                        {s.processedStudents ?? 0}/{s.totalStudents ?? 0}
                      </td>
                      {/* Actions */}
                      <td style={{ padding: '0.5rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {isConfirming ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: '#fbbf24', fontSize: '0.78rem' }}>Delete session + all results?</span>
                            <button
                              onClick={() => handleDeleteSession(s._id)}
                              style={sBtn('#ef4444', '#7f1d1d')}
                            >
                              Yes, delete
                            </button>
                            <button
                              onClick={() => setConfirmDeleteSessionId(null)}
                              style={sBtn('#475569', '#1e293b')}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <button
                              onClick={() => handleViewSession(s)}
                              style={sBtn('#6366f1', '#3730a3')}
                            >
                              View →
                            </button>
                            <button
                              onClick={() => setConfirmDeleteSessionId(s._id)}
                              disabled={isDeleting}
                              title="Delete this session and all student results"
                              style={sBtn('#64748b', '#334155')}
                            >
                              {isDeleting ? '…' : '🗑 Delete'}
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Report History (Feature 3) ──────────────────────────────────────── */}
      <ReportHistoryPanel
        courseId={activeCourseId}
        courseCode={activeCourse?.courseCode}
      />
    </div>
  );
};

// ─── Shared styles ────────────────────────────────────────────────────────────
const td = {
  padding: '0.5rem 0.75rem',
  verticalAlign: 'top',
};

const tabBtn = (active, baseColor = '#6366f1') => ({
  background: active ? `rgba(${baseColor === '#6366f1' ? '99,102,241' : '5,150,105'},0.2)` : 'rgba(255,255,255,0.04)',
  border: `1px solid ${active ? (baseColor === '#6366f1' ? 'rgba(99,102,241,0.5)' : 'rgba(5,150,105,0.5)') : 'rgba(255,255,255,0.1)'}`,
  color: active ? (baseColor === '#6366f1' ? '#a5b4fc' : '#6ee7b7') : '#94a3b8',
  borderRadius: 8,
  padding: '4px 12px',
  cursor: 'pointer',
  fontSize: '0.78rem',
  fontWeight: 600,
});

// Small action button used by session history and report history delete/view
const sBtn = (bg, darkerBg) => ({
  background: `linear-gradient(135deg, ${bg}, ${darkerBg})`,
  border: 'none',
  color: '#fff',
  borderRadius: 7,
  padding: '3px 10px',
  cursor: 'pointer',
  fontSize: '0.78rem',
  fontWeight: 600,
  lineHeight: 1.5,
  transition: 'opacity 0.15s',
});

export default AssignmentEvaluation;
