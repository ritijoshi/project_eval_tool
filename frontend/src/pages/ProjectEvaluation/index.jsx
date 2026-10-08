import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FolderGit2,
  Activity,
  Trophy,
  FileSpreadsheet,
  RefreshCw,
  Plus,
  ArrowLeft,
  Calendar,
  Sparkles,
  Bot,
  AlertCircle,
  CheckCircle2,
  Layers,
  Users,
  Upload,
  X,
  FileText,
  Loader2,
} from 'lucide-react';

import { useActiveCourse } from '../../context/ActiveCourseContext';
import {
  getCourseSessions,
  getSessionResults,
  getProjectLeaderboard,
  exportSessionReport,
  submitWeeklyProgress,
  getProjectDetail,
} from '../../services/projectEvalApi';

// Component Layer
import ProjectSetupForm from '../../components/ProjectEvaluation/ProjectSetupForm';
import BatchProgressTracker from '../../components/ProjectEvaluation/BatchProgressTracker';
import ProjectResultsTable from '../../components/ProjectEvaluation/ProjectResultsTable';
import ProjectLeaderboard from '../../components/ProjectEvaluation/ProjectLeaderboard';
import TeamContributionPanel from '../../components/ProjectEvaluation/TeamContributionPanel';
import StudentProjectView from '../../components/ProjectEvaluation/StudentProjectView';
import WeeklyProgressTimeline from '../../components/ProjectEvaluation/WeeklyProgressTimeline';
import ProjectAssistant from '../../components/ProjectEvaluation/ProjectAssistant';

/**
 * Retrieves the currently logged-in user object safely from localStorage.
 */
const getStoredUser = () => {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/**
 * Determines current user role following application convention.
 */
const detectUserRole = () => {
  const storedRole = localStorage.getItem('role');
  if (storedRole) return storedRole.toLowerCase();

  const user = getStoredUser();
  if (user?.role) return String(user.role).toLowerCase();

  const token = localStorage.getItem('token');
  if (token) {
    try {
      const payloadBase64 = token.split('.')[1];
      const payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.role) return String(payload.role).toLowerCase();
    } catch {
      // ignore
    }
  }

  return 'student';
};

/**
 * ProjectEvaluation Main Page
 * Supports both Professor (Setup -> Progress -> Results -> Diagnostics)
 * and Student (Project View -> Weekly Timeline -> AI Assistant) workflows.
 */
export const ProjectEvaluation = () => {
  const { activeCourseId, activeCourse } = useActiveCourse();
  const currentUser = useMemo(() => getStoredUser(), []);
  const userRole = useMemo(() => detectUserRole(), []);
  const isProfessor = userRole === 'professor';

  // ─── Professor Navigation State ───────────────────────────────────────────
  // 'setup' | 'progress' | 'results'
  const [professorView, setProfessorView] = useState('setup');

  // ─── Shared Session & Results State ───────────────────────────────────────
  const [sessionId, setSessionId] = useState('');
  const [currentSession, setCurrentSession] = useState(null);
  const [courseSessions, setCourseSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const [results, setResults] = useState([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  // Selected project for granular diagnostic inspector
  const [selectedProject, setSelectedProject] = useState(null);
  const [exportingReport, setExportingReport] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // ─── Student State ────────────────────────────────────────────────────────
  const [studentTab, setStudentTab] = useState('evaluation'); // 'evaluation' | 'timeline' | 'assistant'
  const [studentProject, setStudentProject] = useState(null);
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentError, setStudentError] = useState('');

  // ─── Weekly Progress Submission Modal State ───────────────────────────────
  const [showWeeklyModal, setShowWeeklyModal] = useState(false);
  const [weeklyModalSubmitting, setWeeklyModalSubmitting] = useState(false);
  const [weeklyModalWeekLabel, setWeeklyModalWeekLabel] = useState('Week 1');
  const [weeklyModalText, setWeeklyModalText] = useState('');
  const [weeklyModalFile, setWeeklyModalFile] = useState(null);
  const [weeklyModalError, setWeeklyModalError] = useState('');

  // ─── 1. Load Course Sessions ──────────────────────────────────────────────
  const fetchCourseSessions = useCallback(async () => {
    if (!activeCourseId || activeCourseId === 'all') return;
    setSessionsLoading(true);
    try {
      const data = await getCourseSessions(activeCourseId);
      if (data && data.success) {
        const list = Array.isArray(data.sessions) ? data.sessions : [];
        setCourseSessions(list);
        if (list.length > 0 && !sessionId) {
          // Select newest session by default
          setSessionId(list[0]._id);
          setCurrentSession(list[0]);
        }
      }
    } catch {
      // Keep silent on background list load
    } finally {
      setSessionsLoading(false);
    }
  }, [activeCourseId, sessionId]);

  useEffect(() => {
    fetchCourseSessions();
  }, [fetchCourseSessions]);

  // ─── 2. Fetch Session Results & Leaderboard ───────────────────────────────
  const fetchSessionData = useCallback(async (targetSessionId) => {
    const sId = targetSessionId || sessionId;
    if (!sId) return;

    setResultsLoading(true);
    setLeaderboardLoading(true);
    setActionError('');

    try {
      const [resData, lbData] = await Promise.allSettled([
        getSessionResults(sId),
        getProjectLeaderboard(sId),
      ]);

      if (resData.status === 'fulfilled' && resData.value?.success) {
        setResults(Array.isArray(resData.value.results) ? resData.value.results : []);
        if (resData.value.session) {
          setCurrentSession(resData.value.session);
        }
      }

      if (lbData.status === 'fulfilled' && lbData.value?.success) {
        setLeaderboardData(Array.isArray(lbData.value.leaderboard) ? lbData.value.leaderboard : []);
      }
    } catch (err) {
      console.error('Failed to load session data:', err);
      setActionError('Could not load session evaluation results.');
    } finally {
      setResultsLoading(false);
      setLeaderboardLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) {
      fetchSessionData(sessionId);
    }
  }, [sessionId, fetchSessionData]);

  // ─── 3. Student: Identify and Fetch Specific Project ──────────────────────
  const fetchStudentEvaluation = useCallback(async () => {
    if (!sessionId) return;
    setStudentLoading(true);
    setStudentError('');

    try {
      const resData = await getSessionResults(sessionId);
      if (resData && resData.success) {
        const list = Array.isArray(resData.results) ? resData.results : [];
        if (resData.session) {
          setCurrentSession(resData.session);
        }

        // Match student's project:
        // Priority 1: Match by studentIds containing current user's _id
        // Priority 2: Use existing exact identifier/email/name matching only where appropriate
        // NEVER fall back to list[0]
        const userEmail = (currentUser?.email || '').toLowerCase().trim();
        const userName = (currentUser?.name || '').toLowerCase().trim();
        const userId = String(currentUser?._id || '');

        let matched = null;

        // Priority 1: Match by studentIds containing current user's _id
        if (userId) {
          matched = list.find((r) => {
            if (Array.isArray(r.studentIds) && r.studentIds.length > 0) {
              return r.studentIds.some((s) => {
                const sIdStr = String(typeof s === 'object' && s !== null ? (s._id || s.id || s) : s);
                return sIdStr === userId;
              });
            }
            if (r.studentId) {
              return String(r.studentId) === userId;
            }
            return false;
          });
        }

        // Priority 2: Then use existing exact identifier/email/name matching only where appropriate
        if (!matched) {
          matched = list.find((r) => {
            const ident = String(r.identifier || '').toLowerCase().trim();
            const team = String(r.teamName || '').toLowerCase().trim();
            const teamMembers = team.includes(',') ? team.split(',').map((s) => s.trim()) : [team];
            return (
              (userEmail && (ident === userEmail || teamMembers.includes(userEmail))) ||
              (userName && (ident === userName || teamMembers.includes(userName)))
            );
          });
        }

        // NEVER use list[0] as a fallback

        if (matched) {
          // Fetch granular detail if available
          try {
            const detailRes = await getProjectDetail(sessionId, matched._id);
            if (detailRes?.success && detailRes.detail) {
              setStudentProject(detailRes.detail);
            } else {
              setStudentProject(matched);
            }
          } catch {
            setStudentProject(matched);
          }
        } else {
          setStudentProject(null);
        }
      }
    } catch (err) {
      console.error('Failed to fetch student evaluation:', err);
      setStudentError('Failed to retrieve your project evaluation details.');
    } finally {
      setStudentLoading(false);
    }
  }, [sessionId, currentUser]);

  useEffect(() => {
    if (!isProfessor && sessionId) {
      fetchStudentEvaluation();
    }
  }, [isProfessor, sessionId, fetchStudentEvaluation]);

  // ─── 4. Professor Handlers ────────────────────────────────────────────────
  const handleSessionCreated = (createdSessionData) => {
    const newSessionId = createdSessionData?.sessionId || createdSessionData?._id;
    if (newSessionId) {
      setSessionId(newSessionId);
      setCurrentSession(createdSessionData);
      setProfessorView('progress');
      fetchCourseSessions();
    }
  };

  const handleBatchComplete = ({ sessionId: completedId, results: completedResults, leaderboard: completedLb }) => {
    if (Array.isArray(completedResults) && completedResults.length > 0) {
      setResults(completedResults);
    }
    if (Array.isArray(completedLb)) {
      setLeaderboardData(completedLb);
    }
    setProfessorView('results');
    fetchSessionData(completedId);
  };

  const handleSelectProject = (project) => {
    setSelectedProject(project);
  };

  const handleExportExcel = async () => {
    if (!sessionId) return;
    setExportingReport(true);
    setActionError('');
    try {
      const fileName = `${currentSession?.sessionLabel || 'Project_Evaluation'}_Report.xlsx`;
      await exportSessionReport(sessionId, fileName);
      setActionSuccess('Excel report downloaded successfully.');
      setTimeout(() => setActionSuccess(''), 4000);
    } catch (err) {
      console.error('Export failed:', err);
      setActionError('Failed to generate Excel report file.');
    } finally {
      setExportingReport(false);
    }
  };

  // ─── 5. Weekly Progress Modal Submission ──────────────────────────────────
  const handleSubmitWeeklyProgressModal = async (e) => {
    e.preventDefault();
    if (!sessionId) {
      setWeeklyModalError('No active evaluation session found.');
      return;
    }

    const identifier = studentProject?.identifier || currentUser?.email || currentUser?.name || 'Project-1';

    setWeeklyModalSubmitting(true);
    setWeeklyModalError('');

    try {
      await submitWeeklyProgress({
        sessionId,
        identifier,
        weekLabel: weeklyModalWeekLabel.trim() || 'Week 1',
        fileText: weeklyModalText.trim(),
        weeklyDocFile: weeklyModalFile,
        studentId: currentUser?._id || null,
      });

      setShowWeeklyModal(false);
      setWeeklyModalText('');
      setWeeklyModalFile(null);
      setActionSuccess('Weekly progress recorded successfully!');
      setTimeout(() => setActionSuccess(''), 4000);

      if (!isProfessor) {
        fetchStudentEvaluation();
      } else {
        fetchSessionData(sessionId);
      }
    } catch (err) {
      console.error('Failed to submit weekly progress:', err);
      setWeeklyModalError(err.response?.data?.message || 'Failed to submit weekly progress.');
    } finally {
      setWeeklyModalSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(145deg, #090d16 0%, #0f172a 100%)',
        color: '#f8fafc',
        padding: '1.75rem',
      }}
    >
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* ─── Top Page Header ─────────────────────────────────────────────── */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            borderRadius: 16,
            padding: '1.25rem 1.5rem',
            backdropFilter: 'blur(16px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(168, 85, 247, 0.25) 100%)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#818cf8',
              }}
            >
              <FolderGit2 size={24} />
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#f8fafc' }}>
                  AI Continuous Project Evaluation
                </h1>
                <span
                  style={{
                    padding: '2px 9px',
                    borderRadius: 12,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    background: isProfessor ? 'rgba(99, 102, 241, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                    color: isProfessor ? '#818cf8' : '#38bdf8',
                    border: `1px solid ${isProfessor ? 'rgba(99, 102, 241, 0.35)' : 'rgba(56, 189, 248, 0.35)'}`,
                  }}
                >
                  {isProfessor ? 'Professor Console' : 'Student Portal'}
                </span>
              </div>

              <p style={{ margin: '0.15rem 0 0 0', color: '#94a3b8', fontSize: '0.84rem' }}>
                {activeCourse ? `Course: ${activeCourse.title || activeCourse.courseCode}` : 'Automated GitHub & Milestone Rubric Verification'}
              </p>
            </div>
          </div>

          {/* Session Switcher & Top Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {courseSessions.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Session:</span>
                <select
                  value={sessionId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSessionId(nextId);
                    const found = courseSessions.find((s) => s._id === nextId);
                    if (found) setCurrentSession(found);
                    if (isProfessor) setProfessorView('results');
                  }}
                  disabled={sessionsLoading}
                  style={{
                    background: 'rgba(30, 41, 59, 0.7)',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    color: '#f8fafc',
                    padding: '0.45rem 0.85rem',
                    borderRadius: 8,
                    fontSize: '0.82rem',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {courseSessions.map((s) => (
                    <option key={s._id} value={s._id} style={{ background: '#0f172a' }}>
                      {s.sessionLabel || 'Project Evaluation'} ({new Date(s.createdAt).toLocaleDateString()})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isProfessor && (
              <button
                type="button"
                onClick={() => {
                  setProfessorView('setup');
                  setSelectedProject(null);
                }}
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
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
                }}
              >
                <Plus size={15} />
                <span>New Evaluation Session</span>
              </button>
            )}
          </div>
        </div>

        {/* ─── Global Action Banners (Success / Error) ──────────────────────── */}
        {actionSuccess && (
          <div
            style={{
              background: 'rgba(74, 222, 128, 0.12)',
              border: '1px solid rgba(74, 222, 128, 0.35)',
              borderRadius: 10,
              padding: '0.75rem 1rem',
              color: '#4ade80',
              fontSize: '0.86rem',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <CheckCircle2 size={16} />
            <span>{actionSuccess}</span>
          </div>
        )}

        {actionError && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: 10,
              padding: '0.75rem 1rem',
              color: '#f87171',
              fontSize: '0.86rem',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertCircle size={16} />
            <span>{actionError}</span>
          </div>
        )}

        {/* =================================================================== */}
        {/* PROFESSOR FLOW                                                      */}
        {/* =================================================================== */}
        {isProfessor && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* View Navigation Tabs */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(15, 23, 42, 0.6)',
                padding: 4,
                borderRadius: 12,
                border: '1px solid rgba(99, 102, 241, 0.2)',
                width: 'fit-content',
              }}
            >
              <button
                type="button"
                onClick={() => setProfessorView('setup')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0.5rem 1.1rem',
                  borderRadius: 8,
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: professorView === 'setup' ? '#6366f1' : 'transparent',
                  color: professorView === 'setup' ? '#fff' : '#94a3b8',
                  transition: 'all 0.2s ease',
                }}
              >
                <Plus size={15} />
                <span>1. Setup Session</span>
              </button>

              <button
                type="button"
                onClick={() => setProfessorView('progress')}
                disabled={!sessionId}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0.5rem 1.1rem',
                  borderRadius: 8,
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  border: 'none',
                  cursor: sessionId ? 'pointer' : 'not-allowed',
                  opacity: sessionId ? 1 : 0.45,
                  background: professorView === 'progress' ? '#6366f1' : 'transparent',
                  color: professorView === 'progress' ? '#fff' : '#94a3b8',
                  transition: 'all 0.2s ease',
                }}
              >
                <Activity size={15} />
                <span>2. Live Progress</span>
              </button>

              <button
                type="button"
                onClick={() => setProfessorView('results')}
                disabled={!sessionId}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0.5rem 1.1rem',
                  borderRadius: 8,
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  border: 'none',
                  cursor: sessionId ? 'pointer' : 'not-allowed',
                  opacity: sessionId ? 1 : 0.45,
                  background: professorView === 'results' ? '#6366f1' : 'transparent',
                  color: professorView === 'results' ? '#fff' : '#94a3b8',
                  transition: 'all 0.2s ease',
                }}
              >
                <Trophy size={15} />
                <span>3. Results & Leaderboard</span>
              </button>
            </div>

            {/* 1. Setup Form View */}
            {professorView === 'setup' && (
              <ProjectSetupForm
                onSessionCreated={handleSessionCreated}
                courseId={activeCourseId !== 'all' ? activeCourseId : ''}
              />
            )}

            {/* 2. Live Progress Tracker View */}
            {professorView === 'progress' && sessionId && (
              <BatchProgressTracker
                sessionId={sessionId}
                sessionLabel={currentSession?.sessionLabel || 'Project Evaluation'}
                onComplete={handleBatchComplete}
                onRetry={() => fetchSessionData(sessionId)}
              />
            )}

            {/* 3. Results & Leaderboard View */}
            {professorView === 'results' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Results Action Bar */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                    background: 'rgba(15, 23, 42, 0.65)',
                    padding: '0.85rem 1.25rem',
                    borderRadius: 12,
                    border: '1px solid rgba(99, 102, 241, 0.2)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc' }}>
                      {currentSession?.sessionLabel || 'Evaluation Results'}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                      ({results.length} {results.length === 1 ? 'project' : 'projects'})
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => fetchSessionData(sessionId)}
                      disabled={resultsLoading}
                      title="Refresh results"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#cbd5e1',
                        padding: '0.45rem 0.9rem',
                        borderRadius: 8,
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      <RefreshCw size={14} className={resultsLoading ? 'animate-spin' : ''} />
                      <span>Refresh</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleExportExcel}
                      disabled={exportingReport || results.length === 0}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        border: 'none',
                        color: '#fff',
                        padding: '0.48rem 1rem',
                        borderRadius: 8,
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        cursor: exportingReport ? 'not-allowed' : 'pointer',
                        boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
                      }}
                    >
                      {exportingReport ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
                      <span>Export Excel Report</span>
                    </button>
                  </div>
                </div>

                {/* Granular Team Contribution Panel (When Selected) */}
                {selectedProject && (
                  <div style={{ position: 'relative' }}>
                    <TeamContributionPanel
                      project={selectedProject}
                      onClose={() => setSelectedProject(null)}
                    />
                  </div>
                )}

                {/* Ranked Leaderboard */}
                <ProjectLeaderboard
                  sessionId={sessionId}
                  leaderboard={leaderboardData}
                  sessionLabel={currentSession?.sessionLabel}
                  loading={leaderboardLoading}
                  onSelectProject={handleSelectProject}
                  onRefresh={() => fetchSessionData(sessionId)}
                />

                {/* Detailed Results Table */}
                <ProjectResultsTable
                  results={results}
                  loading={resultsLoading}
                  onSelectProject={handleSelectProject}
                  emptyMessage="No evaluation results found for this session."
                />
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* STUDENT FLOW                                                        */}
        {/* =================================================================== */}
        {!isProfessor && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Student View Navigation Tabs */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(15, 23, 42, 0.6)',
                padding: 4,
                borderRadius: 12,
                border: '1px solid rgba(99, 102, 241, 0.2)',
                width: 'fit-content',
              }}
            >
              <button
                type="button"
                onClick={() => setStudentTab('evaluation')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0.5rem 1.1rem',
                  borderRadius: 8,
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: studentTab === 'evaluation' ? '#6366f1' : 'transparent',
                  color: studentTab === 'evaluation' ? '#fff' : '#94a3b8',
                  transition: 'all 0.2s ease',
                }}
              >
                <Layers size={15} />
                <span>Evaluation Dashboard</span>
              </button>

              <button
                type="button"
                onClick={() => setStudentTab('timeline')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0.5rem 1.1rem',
                  borderRadius: 8,
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: studentTab === 'timeline' ? '#6366f1' : 'transparent',
                  color: studentTab === 'timeline' ? '#fff' : '#94a3b8',
                  transition: 'all 0.2s ease',
                }}
              >
                <Calendar size={15} />
                <span>Weekly Progress</span>
              </button>

              <button
                type="button"
                onClick={() => setStudentTab('assistant')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0.5rem 1.1rem',
                  borderRadius: 8,
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: studentTab === 'assistant' ? '#6366f1' : 'transparent',
                  color: studentTab === 'assistant' ? '#fff' : '#94a3b8',
                  transition: 'all 0.2s ease',
                }}
              >
                <Sparkles size={15} />
                <span>AI Project Assistant</span>
              </button>
            </div>

            {/* If no project matched and not loading / not in error */}
            {!studentLoading && !studentError && !studentProject ? (
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
                  No project evaluation found for your account
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: '0 0 1.5rem 0', maxWidth: 460, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
                  Your account is not linked to any project evaluation in this session. If you are part of a team, please ask your instructor to link your student ID or email.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setShowWeeklyModal(true)}
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
                  <button
                    type="button"
                    onClick={fetchStudentEvaluation}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      background: 'rgba(99, 102, 241, 0.15)',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      color: '#c7d2fe',
                      padding: '0.6rem 1.2rem',
                      borderRadius: 8,
                      fontSize: '0.88rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <RefreshCw size={16} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Tab 1: Student Evaluation View */}
                {studentTab === 'evaluation' && (
                  <StudentProjectView
                    project={studentProject}
                    loading={studentLoading}
                    error={studentError}
                    onSubmitWeeklyProgress={() => setShowWeeklyModal(true)}
                    onRefresh={fetchStudentEvaluation}
                  />
                )}

                {/* Tab 2: Weekly Progress Timeline */}
                {studentTab === 'timeline' && (
                  <WeeklyProgressTimeline
                    weeklyProgressList={Array.isArray(studentProject?.weeklyProgress) ? studentProject.weeklyProgress : []}
                    project={studentProject}
                    loading={studentLoading}
                    onSubmitWeeklyProgress={() => setShowWeeklyModal(true)}
                    onRefresh={fetchStudentEvaluation}
                  />
                )}

                {/* Tab 3: Project AI Assistant */}
                {studentTab === 'assistant' && (
                  <ProjectAssistant
                    project={studentProject}
                    projectIdentifier={studentProject?.identifier}
                    teamName={studentProject?.teamName}
                    projectGoal={currentSession?.projectGoal || studentProject?.projectGoal}
                    evaluationFeedback={studentProject?.feedback}
                    missingRequirements={studentProject?.missingRequirements}
                    missingConcepts={studentProject?.missingConcepts}
                    nextWeekTasks={studentProject?.nextWeekTasks}
                    weeklyProgress={studentProject?.weeklyClaims}
                    courseKey={activeCourse?.courseCode || 'general'}
                    courseId={activeCourseId}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* ─── Submit Weekly Progress Modal ───────────────────────────────── */}
        {showWeeklyModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.75)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: '1rem',
            }}
          >
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.96)',
                border: '1px solid rgba(99, 102, 241, 0.35)',
                borderRadius: 16,
                padding: '1.75rem',
                maxWidth: 540,
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
                boxShadow: '0 25px 50px rgba(0, 0, 0, 0.5)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Calendar size={20} style={{ color: '#818cf8' }} />
                  <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.15rem', fontWeight: 700 }}>
                    Submit Weekly Progress Update
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWeeklyModal(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                >
                  <X size={18} />
                </button>
              </div>

              {weeklyModalError && (
                <div
                  style={{
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    borderRadius: 8,
                    padding: '0.65rem 0.85rem',
                    color: '#f87171',
                    fontSize: '0.82rem',
                  }}
                >
                  {weeklyModalError}
                </div>
              )}

              <form onSubmit={handleSubmitWeeklyProgressModal} style={{ display: 'grid', gap: '1rem' }}>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: '#cbd5e1',
                      marginBottom: '0.35rem',
                    }}
                  >
                    Week Label
                  </label>
                  <input
                    type="text"
                    value={weeklyModalWeekLabel}
                    onChange={(e) => setWeeklyModalWeekLabel(e.target.value)}
                    placeholder="e.g. Week 1, Week 2, Sprint 3"
                    required
                    style={{
                      width: '100%',
                      background: 'rgba(30, 41, 59, 0.7)',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      borderRadius: 8,
                      padding: '0.55rem 0.85rem',
                      color: '#f8fafc',
                      fontSize: '0.85rem',
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: '#cbd5e1',
                      marginBottom: '0.35rem',
                    }}
                  >
                    Progress Report Text / Notes
                  </label>
                  <textarea
                    value={weeklyModalText}
                    onChange={(e) => setWeeklyModalText(e.target.value)}
                    rows={4}
                    placeholder="Highlight accomplishments, blockers faced, and next sprint commitments..."
                    style={{
                      width: '100%',
                      background: 'rgba(30, 41, 59, 0.7)',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      borderRadius: 8,
                      padding: '0.55rem 0.85rem',
                      color: '#f8fafc',
                      fontSize: '0.85rem',
                      outline: 'none',
                      resize: 'vertical',
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: '#cbd5e1',
                      marginBottom: '0.35rem',
                    }}
                  >
                    Attach Weekly Report Document (Optional)
                  </label>
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt,.md"
                    onChange={(e) => setWeeklyModalFile(e.target.files ? e.target.files[0] : null)}
                    style={{
                      width: '100%',
                      background: 'rgba(30, 41, 59, 0.4)',
                      border: '1px dashed rgba(99, 102, 241, 0.35)',
                      borderRadius: 8,
                      padding: '0.5rem',
                      color: '#94a3b8',
                      fontSize: '0.8rem',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setShowWeeklyModal(false)}
                    disabled={weeklyModalSubmitting}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#cbd5e1',
                      padding: '0.5rem 1rem',
                      borderRadius: 8,
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={weeklyModalSubmitting}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                      border: 'none',
                      color: '#fff',
                      padding: '0.5rem 1.25rem',
                      borderRadius: 8,
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      cursor: weeklyModalSubmitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {weeklyModalSubmitting && <Loader2 size={14} className="animate-spin" />}
                    <span>{weeklyModalSubmitting ? 'Submitting...' : 'Record Progress'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectEvaluation;
