import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  Target,
  Book,
  Users,
  LogOut,
  Sun,
  Moon,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  ArrowRight,
  Zap,
  MessageSquare,
  TrendingUp,
  Award,
  Trash2,
  Check,
} from 'lucide-react';
import axios from 'axios';
import Chatbot from '../components/Chatbot';
import FeedbackViewer from '../components/FeedbackViewer';
import AnnouncementsPanel from '../components/AnnouncementsPanel';
import { API_BASE } from '../config/api';
import CourseSwitcher from '../components/CourseSwitcher';
import { useActiveCourse } from '../context/ActiveCourseContext';
import { useWebSocket } from '../hooks/useWebSocket';

const StudentDashboard = () => {
  const navigate = useNavigate();
  const contentRef = useRef(null);
  const [isDark, setIsDark] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [learningPath, setLearningPath] = useState(null);
  const [progressData, setProgressData] = useState(null);
  const [allCourseProgress, setAllCourseProgress] = useState([]);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState('');
  const [_error, setError] = useState('');
  const [evaluationData, setEvaluationData] = useState(null);
  const [submissionText, setSubmissionText] = useState('');
  const [rubricText, setRubricText] = useState('1. Clarity (20%)\n2. Accuracy (50%)\n3. Originality (30%)');
  const [submissionFiles, setSubmissionFiles] = useState([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [userName, setUserName] = useState('Student');
  const [feedbackList, setFeedbackList] = useState([]);
  const [selectedFeedback, setSelectedFeedback] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [evaluationCourseKey, setEvaluationCourseKey] = useState('general');
  const [joinCode, setJoinCode] = useState('');
  const [joinStatus, setJoinStatus] = useState('');
  const [joinStatusType, setJoinStatusType] = useState('');
  const [unenrollStatus, setUnenrollStatus] = useState({});
  const {
    courses,
    loading: coursesLoading,
    activeCourseId,
    activeCourse,
    isAllCourses,
    refreshCourses,
    activeRubricText,
    rubricLoading,
  } = useActiveCourse();

  const DEFAULT_RUBRIC = '1. Clarity (20%)\n2. Accuracy (50%)\n3. Originality (30%)';
  const [assignments, setAssignments] = useState([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentFiles, setAssignmentFiles] = useState({});
  const [assignmentStatus, setAssignmentStatus] = useState({});
  const [assignmentSubmissions, setAssignmentSubmissions] = useState({});
  const [assignmentSubmissionsLoading, setAssignmentSubmissionsLoading] = useState({});
  const [expandedAssignmentId, setExpandedAssignmentId] = useState('');
  const [upcomingAssignments, setUpcomingAssignments] = useState([]);
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  const [assignmentSort, setAssignmentSort] = useState('newest');
  const { on, off } = useWebSocket();

  // Practice tests
  const [practiceTests, setPracticeTests] = useState([]);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceError, setPracticeError] = useState('');
  const [practiceHistory, setPracticeHistory] = useState([]);
  const [practiceHistoryLoading, setPracticeHistoryLoading] = useState(false);
  const [practiceSettings, setPracticeSettings] = useState({
    timed: false,
    minutes: 10,
    feedbackMode: 'delayed',
    questionCount: 10,
  });
  const [practiceSession, setPracticeSession] = useState(null);
  const [practiceAnswers, setPracticeAnswers] = useState({});
  const [practiceChecks, setPracticeChecks] = useState({});
  const [practiceSubmitting, setPracticeSubmitting] = useState(false);
  const [practiceResult, setPracticeResult] = useState(null);
  const [practiceTimeLeft, setPracticeTimeLeft] = useState(null);
  const [todos, setTodos] = useState([]);
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const [newTodoPriority, setNewTodoPriority] = useState('normal');

  const upsertAssignmentTodos = (assignmentList) => {
    if (!Array.isArray(assignmentList) || assignmentList.length === 0) return;

    setTodos((prev) => {
      const prevTodos = Array.isArray(prev) ? prev : [];
      const nextTodos = [...prevTodos];
      let changed = false;

      assignmentList.forEach((assignment) => {
        const assignmentId = assignment?._id ? String(assignment._id) : '';
        if (!assignmentId) return;

        const courseCode = assignment?.course?.courseCode ? String(assignment.course.courseCode) : '';
        const title = `Assignment: ${assignment?.title || 'Untitled'}${courseCode ? ` • ${courseCode}` : ''}`;
        const todoId = `assignment:${assignmentId}`;

        const existingIndex = nextTodos.findIndex((todo) => {
          if (!todo) return false;
          if (String(todo.id) === todoId) return true;
          if (todo.source === 'assignment' && String(todo.assignmentId || '') === assignmentId) return true;
          return false;
        });

        if (existingIndex >= 0) {
          const existing = nextTodos[existingIndex];
          const updated = {
            ...existing,
            id: existing.id ?? todoId,
            source: 'assignment',
            assignmentId,
            courseId: assignment?.course?._id ? String(assignment.course._id) : existing.courseId,
            deadline: assignment?.deadline || existing.deadline,
            title,
          };

          if (
            updated.title !== existing.title ||
            updated.deadline !== existing.deadline ||
            updated.courseId !== existing.courseId
          ) {
            nextTodos[existingIndex] = updated;
            changed = true;
          }
          return;
        }

        nextTodos.push({
          id: todoId,
          title,
          done: false,
          priority: 'high',
          createdAt: new Date().toISOString(),
          source: 'assignment',
          assignmentId,
          courseId: assignment?.course?._id ? String(assignment.course._id) : '',
          deadline: assignment?.deadline || null,
        });
        changed = true;
      });

      if (changed) {
        saveTodosToLocalStorage(nextTodos);
      }

      return nextTodos;
    });
  };

  const markAssignmentTodoCompleted = (assignmentId) => {
    const normalizedId = assignmentId ? String(assignmentId) : '';
    if (!normalizedId) return;

    const todoId = `assignment:${normalizedId}`;

    setTodos((prev) => {
      const prevTodos = Array.isArray(prev) ? prev : [];
      const nextTodos = prevTodos.map((todo) => {
        if (!todo) return todo;
        const matches =
          String(todo.id) === todoId ||
          (todo.source === 'assignment' && String(todo.assignmentId || '') === normalizedId);
        if (!matches) return todo;
        if (todo.done) return todo;
        return { ...todo, done: true };
      });

      const changed = nextTodos.some((t, i) => (t?.done || false) !== (prevTodos[i]?.done || false));
      if (changed) {
        saveTodosToLocalStorage(nextTodos);
      }
      return changed ? nextTodos : prevTodos;
    });
  };

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setIsDark(savedTheme === 'dark');
    document.documentElement.setAttribute('data-theme', savedTheme);

    const user = JSON.parse(localStorage.getItem('user') || '{}');
    setUserName(user.name || 'Student');
    setEvaluationCourseKey((user.courseKey || 'general').toLowerCase());

    try {
      const savedTodos = JSON.parse(localStorage.getItem('studentTodos') || '[]');
      setTodos(Array.isArray(savedTodos) ? savedTodos : []);
    } catch {
      setTodos([]);
    }
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('token');
        const config = { headers: { Authorization: `Bearer ${token}` } };
        const courseQuery = activeCourseId && activeCourseId !== 'all' ? `?courseId=${activeCourseId}` : '';
        const pathRes = await axios.get(`${API_BASE}/api/student/learning-path${courseQuery}`, config);
        setLearningPath(pathRes.data);

        if (activeCourseId && activeCourseId !== 'all') {
          axios
            .post(
              `${API_BASE}/api/progress/update`,
              {
                studentId: JSON.parse(localStorage.getItem('user') || '{}')._id,
                courseId: activeCourseId,
                eventType: 'material_view',
                payload: {
                  moduleKey: `learning-path:${activeCourseId}`,
                  materialTitle: 'Adaptive Learning Path',
                  timeSpentSeconds: 90,
                  completed: false,
                },
              },
              config
            )
            .catch(() => {
              // Best-effort telemetry only.
            });
        }
      } catch (err) {
        console.error(err);
        setError('Failed to fetch learning path.');
      }
    };
    fetchData();
  }, [activeCourseId]);

  const fetchUpcoming = async () => {
    try {
      setUpcomingLoading(true);
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.get(`${API_BASE}/api/student/assignments/upcoming`, config);
      const list = Array.isArray(res.data?.assignments) ? res.data.assignments : [];
      setUpcomingAssignments(list);
      upsertAssignmentTodos(list);
      return list;
    } catch {
      setUpcomingAssignments([]);
      return [];
    } finally {
      setUpcomingLoading(false);
    }
  };

  const fetchProgressData = async () => {
    try {
      setProgressLoading(true);
      setProgressError('');
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };

      if (activeCourseId && activeCourseId !== 'all') {
        const res = await axios.get(
          `${API_BASE}/api/progress?courseId=${encodeURIComponent(activeCourseId)}&includeInsights=true`,
          config
        );
        setProgressData(res.data?.progress || null);
      } else {
        setProgressData(null);
      }

      const allRes = await axios.get(`${API_BASE}/api/progress/all-courses`, config);
      setAllCourseProgress(Array.isArray(allRes.data?.progress) ? allRes.data.progress : []);
    } catch (err) {
      setProgressError(err.response?.data?.message || 'Failed to load progress insights.');
      setProgressData(null);
      setAllCourseProgress([]);
    } finally {
      setProgressLoading(false);
    }
  };

  const fetchPracticeTests = async () => {
    if (!activeCourseId || activeCourseId === 'all') {
      setPracticeTests([]);
      return;
    }

    try {
      setPracticeLoading(true);
      setPracticeError('');
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.get(`${API_BASE}/api/tests?courseId=${activeCourseId}`, config);
      setPracticeTests(Array.isArray(res.data?.tests) ? res.data.tests : []);
    } catch (err) {
      setPracticeTests([]);
      setPracticeError(err.response?.data?.message || 'Failed to load practice tests.');
    } finally {
      setPracticeLoading(false);
    }
  };

  const fetchPracticeHistory = async () => {
    if (!activeCourseId || activeCourseId === 'all') {
      setPracticeHistory([]);
      return;
    }

    try {
      setPracticeHistoryLoading(true);
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.get(`${API_BASE}/api/results?courseId=${encodeURIComponent(activeCourseId)}`, config);
      setPracticeHistory(Array.isArray(res.data?.results) ? res.data.results : []);
    } catch {
      setPracticeHistory([]);
    } finally {
      setPracticeHistoryLoading(false);
    }
  };

  const viewPracticeAttempt = (attemptRow) => {
    if (!attemptRow) return;
    const breakdown = Array.isArray(attemptRow.breakdown) ? attemptRow.breakdown : [];
    const correctCount = breakdown.filter((b) => Boolean(b?.correct)).length;
    const total = breakdown.length;

    setPracticeResult({
      attemptId: attemptRow.attemptId,
      testId: attemptRow?.test?._id,
      courseId: activeCourseId,
      score: Number(attemptRow.score) || 0,
      correctCount,
      total,
      timeTakenSeconds: Number(attemptRow.timeTakenSeconds) || 0,
      weakAreas: Array.isArray(attemptRow.weakAreas) ? attemptRow.weakAreas : [],
      breakdown,
      recommendedTests: [],
    });
  };

  const startPracticeTest = async (test) => {
    if (!test?._id) return;
    if (!activeCourseId || activeCourseId === 'all') return;
    if (test?.isActive === false) {
      setPracticeError('This test is inactive and no longer available.');
      return;
    }

    try {
      setPracticeError('');
      setPracticeSubmitting(false);
      setPracticeResult(null);
      setPracticeChecks({});
      setPracticeAnswers({});

      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const count = Number(practiceSettings.questionCount) || 0;
      const query = count > 0 ? `?count=${encodeURIComponent(String(count))}` : '';
      const res = await axios.get(`${API_BASE}/api/tests/${test._id}${query}`, config);

      const questions = Array.isArray(res.data?.questions) ? res.data.questions : [];
      setPracticeSession({
        test: res.data?.test || test,
        questions,
        startedAt: Date.now(),
        currentIndex: 0,
        timed: Boolean(practiceSettings.timed),
        minutes: Number(practiceSettings.minutes) || 10,
        feedbackMode: practiceSettings.feedbackMode === 'immediate' ? 'immediate' : 'delayed',
      });

      if (practiceSettings.timed) {
        const seconds = Math.max(1, Math.floor((Number(practiceSettings.minutes) || 10) * 60));
        setPracticeTimeLeft(seconds);
      } else {
        setPracticeTimeLeft(null);
      }
    } catch (err) {
      setPracticeError(err.response?.data?.message || 'Failed to start test.');
    }
  };

  const selectPracticeAnswer = async ({ questionId, selectedIndex }) => {
    if (!practiceSession?.test?._id) return;
    setPracticeAnswers((prev) => ({ ...prev, [questionId]: selectedIndex }));

    if (practiceSession.feedbackMode !== 'immediate') return;

    try {
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.post(
        `${API_BASE}/api/attempt/check`,
        { testId: practiceSession.test._id, questionId, selectedIndex },
        config
      );
      setPracticeChecks((prev) => ({
        ...prev,
        [questionId]: {
          correct: Boolean(res.data?.correct),
          correctAnswer: res.data?.correctAnswer,
          explanation: res.data?.explanation || '',
        },
      }));
    } catch {
      // Non-blocking: keep the UX smooth even if check fails.
    }
  };

  const submitPracticeAttempt = async () => {
    if (!practiceSession?.test?._id) return;
    const questions = practiceSession.questions || [];

    const answers = questions
      .filter((q) => q?._id && practiceAnswers[q._id] !== undefined)
      .map((q) => ({ questionId: q._id, selectedIndex: practiceAnswers[q._id] }));

    if (answers.length === 0) {
      setPracticeError('Answer at least one question before submitting.');
      return;
    }

    try {
      setPracticeSubmitting(true);
      setPracticeError('');
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const timeTakenSeconds = Math.max(0, Math.floor((Date.now() - practiceSession.startedAt) / 1000));

      const res = await axios.post(
        `${API_BASE}/api/attempt`,
        {
          testId: practiceSession.test._id,
          answers,
          timeTakenSeconds,
          feedbackMode: practiceSession.feedbackMode,
        },
        config
      );

      setPracticeResult(res.data?.result || null);
      setPracticeSession(null);
      setPracticeTimeLeft(null);
    } catch (err) {
      setPracticeError(err.response?.data?.message || 'Failed to submit attempt.');
    } finally {
      setPracticeSubmitting(false);
    }
  };

  useEffect(() => {
    fetchUpcoming();
  }, []);

  useEffect(() => {
    fetchProgressData();
  }, [activeCourseId]);

  useEffect(() => {
    if (activeTab !== 'dashboard') return;
    // Prevent the dashboard panel from keeping an old scroll position.
    requestAnimationFrame(() => {
      if (contentRef.current) {
        contentRef.current.scrollTop = 0;
      }
    });
  }, [activeTab]);

  useEffect(() => {
    if (!practiceSession?.timed) return;
    if (practiceTimeLeft === null) return;
    if (practiceTimeLeft <= 0) {
      submitPracticeAttempt();
      return;
    }

    const timer = setInterval(() => {
      setPracticeTimeLeft((prev) => (prev === null ? null : prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [practiceSession?.timed, practiceTimeLeft]);

  useEffect(() => {
    if (activeTab === 'practice' || activeTab === 'dashboard') {
      fetchPracticeTests();
    }
    if (activeTab === 'practice') {
      fetchPracticeHistory();
    }
    if (activeTab === 'analytics') {
      fetchLeaderboard();
    }
  }, [activeTab, activeCourseId]);

  useEffect(() => {
    const handlePracticeUpdated = (data) => {
      if (!data) return;

      // Even if the student is viewing "All courses" (or another course), we still
      // want the progress snapshot to reflect the latest practice activity.
      const targetsActiveCourse =
        !data.courseId ||
        (activeCourseId && activeCourseId !== 'all' && String(data.courseId) === String(activeCourseId));

      // Only mutate practice-test specific UI when the update targets the active course.
      if (!targetsActiveCourse) {
        fetchProgressData();
        return;
      }

      if (data.kind === 'test-updated' && data.testId) {
        setPracticeTests((prev) =>
          prev.map((test) =>
            String(test._id) === String(data.testId)
              ? { ...test, isActive: data.isActive !== false }
              : test
          )
        );

        if (data.isActive === false) {
          setPracticeSession((prev) => {
            if (!prev?.test?._id) return prev;
            if (String(prev.test._id) !== String(data.testId)) return prev;
            setPracticeError('This test was set inactive by the professor.');
            setPracticeTimeLeft(null);
            return null;
          });
        }
      }

      fetchPracticeTests();
      if (activeTab === 'practice') {
        fetchPracticeHistory();
      }
      fetchProgressData();
    };

    on('practice-updated', handlePracticeUpdated);
    return () => {
      off('practice-updated', handlePracticeUpdated);
    };
  }, [on, off, activeCourseId, activeTab]);

  useEffect(() => {
    if (activeCourse?.courseCode) {
      setEvaluationCourseKey(activeCourse.courseCode);
    }
  }, [activeCourse]);

  useEffect(() => {
    // Keep the evaluation rubric synced to the professor's active rubric for this course.
    if (!activeCourseId || activeCourseId === 'all') return;

    if (activeRubricText && String(activeRubricText).trim()) {
      setRubricText(String(activeRubricText));
      return;
    }

    // No professor rubric found yet: keep a sensible default.
    setRubricText(DEFAULT_RUBRIC);
  }, [activeCourseId, activeRubricText]);

  useEffect(() => {
    if (activeTab === 'courses' && activeCourseId && activeCourseId !== 'all') {
      fetchAssignments();
    }
  }, [activeTab, activeCourseId, assignmentSort]);

  const saveTodosToLocalStorage = (updatedTodos) => {
    localStorage.setItem('studentTodos', JSON.stringify(updatedTodos));
  };

  const addTodo = () => {
    const title = String(newTodoTitle || '').trim();
    if (!title) return;

    const newTodo = {
      id: `manual:${Date.now()}`,
      title,
      done: false,
      priority: newTodoPriority,
      createdAt: new Date().toISOString(),
      source: 'manual',
    };

    setTodos((prev) => {
      const next = [...(Array.isArray(prev) ? prev : []), newTodo];
      saveTodosToLocalStorage(next);
      return next;
    });

    setNewTodoTitle('');
    setNewTodoPriority('normal');
  };

  const handleTodoInputKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addTodo();
  };

  const toggleTodo = (id) => {
    const updatedTodos = todos.map((todo) =>
      todo.id === id ? { ...todo, done: !todo.done } : todo
    );
    setTodos(updatedTodos);
    saveTodosToLocalStorage(updatedTodos);
  };

  const deleteTodo = (id) => {
    const updatedTodos = todos.filter((todo) => todo.id !== id);
    setTodos(updatedTodos);
    saveTodosToLocalStorage(updatedTodos);
  };

  const completedCount = todos.filter((todo) => todo.done).length;
  const totalCount = todos.length;

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('user');
    window.dispatchEvent(new Event('auth-changed'));
    navigate('/login');
  };

  const toggleTheme = () => {
    const newTheme = isDark ? 'light' : 'dark';
    setIsDark(!isDark);
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  };

  const handleEvaluate = async () => {
    if (!submissionText && submissionFiles.length === 0) return;
    setIsEvaluating(true);
    try {
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      let res;

      if (submissionFiles.length > 0) {
        const form = new FormData();
        form.append('rubric', rubricText);
        form.append('course_key', evaluationCourseKey);
        if (activeCourseId && activeCourseId !== 'all') {
          form.append('course_id', activeCourseId);
        }
        submissionFiles.forEach((file) => form.append('files', file));

        res = await axios.post(`${API_BASE}/api/student/evaluate-files`, form, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
        });
      } else {
        res = await axios.post(
          `${API_BASE}/api/student/evaluate`,
          {
            submission_text: submissionText,
            rubric: rubricText,
            course_key: evaluationCourseKey,
            course_id: activeCourseId && activeCourseId !== 'all' ? activeCourseId : undefined,
          },
          config
        );
      }

      setEvaluationData(res.data);
    } catch (err) {
      console.error(err);
      setError('Failed to evaluate submission.');
    }
    setIsEvaluating(false);
  };

  const fetchFeedback = async () => {
    try {
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const courseQuery = activeCourseId && activeCourseId !== 'all' ? `?courseId=${activeCourseId}` : '';
      const res = await axios.get(`${API_BASE}/api/feedback${courseQuery}`, config);
      const normalized = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.feedbacks)
        ? res.data.feedbacks
        : [];
      setFeedbackList(normalized);
      setSelectedFeedback(null);
    } catch (err) {
      console.error(err);
      setError('Failed to fetch feedback.');
    }
  };

  const fetchLeaderboard = async () => {
    try {
      setLeaderboardLoading(true);
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const courseQuery = activeCourseId && activeCourseId !== 'all' ? `?courseId=${activeCourseId}` : '';
      const res = await axios.get(`${API_BASE}/api/student/leaderboard${courseQuery}`, config);
      setLeaderboard(Array.isArray(res.data?.leaderboard) ? res.data.leaderboard : []);
    } catch (err) {
      console.error(err);
      setLeaderboard([]);
    } finally {
      setLeaderboardLoading(false);
    }
  };

  const handleJoinCourse = async () => {
    if (!joinCode.trim()) return;
    try {
      setJoinStatus('');
      setJoinStatusType('');
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      await axios.post(
        `${API_BASE}/api/student/courses/join`,
        { code: joinCode.trim() },
        config
      );
      setJoinStatus('Enrolled successfully.');
      setJoinStatusType('success');
      setJoinCode('');
      refreshCourses();
    } catch (err) {
      setJoinStatus(err.response?.data?.message || 'Failed to join course.');
      setJoinStatusType('error');
    }
  };

  const handleUnenrollCourse = async (course) => {
    const courseId = course?._id;
    if (!courseId) return;

    const confirmText = `Unenroll from ${course.title || 'this course'} (${course.courseCode || ''})?`;
    if (!window.confirm(confirmText)) return;

    try {
      setUnenrollStatus((prev) => ({ ...prev, [courseId]: { type: 'loading', message: 'Unenrolling...' } }));
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      await axios.post(`${API_BASE}/api/student/courses/${courseId}/unenroll`, {}, config);
      setUnenrollStatus((prev) => ({ ...prev, [courseId]: { type: 'success', message: 'Unenrolled.' } }));
      refreshCourses();
    } catch (err) {
      setUnenrollStatus((prev) => ({
        ...prev,
        [courseId]: { type: 'error', message: err.response?.data?.message || 'Failed to unenroll.' },
      }));
    }
  };

  const fetchAssignments = async () => {
    if (!activeCourseId || activeCourseId === 'all') return;
    try {
      setAssignmentsLoading(true);
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.get(
        `${API_BASE}/api/student/assignments?courseId=${activeCourseId}&sort=${assignmentSort}`,
        config
      );
      setAssignments(Array.isArray(res.data?.assignments) ? res.data.assignments : []);
    } catch {
      setAssignments([]);
    } finally {
      setAssignmentsLoading(false);
    }
  };

  useEffect(() => {
    const handleAssignmentsUpdated = (data) => {
      if (data?.reason === 'submitted' && data?.assignmentId) {
        markAssignmentTodoCompleted(data.assignmentId);
      }

      // Upcoming deadlines and todo list span all courses.
      fetchUpcoming();

      // Only refresh the course assignments list when the update targets the active course.
      const targetsActiveCourse =
        !data?.courseId ||
        (activeCourseId && activeCourseId !== 'all' && String(data.courseId) === String(activeCourseId));

      if (targetsActiveCourse && activeTab === 'courses' && activeCourseId && activeCourseId !== 'all') {
        fetchAssignments();
      }

      // Always refresh progress so the course-wise progress list stays current.
      fetchProgressData();
    };

    on('assignments-updated', handleAssignmentsUpdated);
    return () => {
      off('assignments-updated', handleAssignmentsUpdated);
    };
  }, [on, off, activeCourseId, activeTab, assignmentSort]);

  useEffect(() => {
    if (activeTab !== 'dashboard') return;
    fetchUpcoming();
    fetchProgressData();
    fetchPracticeTests();
  }, [activeTab, activeCourseId]);

  const submitAssignment = async (assignmentId) => {
    const files = assignmentFiles[assignmentId] || [];
    if (!files.length) {
      setAssignmentStatus((prev) => ({ ...prev, [assignmentId]: 'Select files to submit.' }));
      return;
    }

    try {
      setAssignmentStatus((prev) => ({ ...prev, [assignmentId]: 'Submitting...' }));
      const token = localStorage.getItem('token');
      const form = new FormData();
      files.forEach((file) => form.append('files', file));
      await axios.post(
        `${API_BASE}/api/student/assignments/${assignmentId}/submissions`,
        form,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setAssignmentStatus((prev) => ({ ...prev, [assignmentId]: 'Submission received.' }));
      setAssignmentFiles((prev) => ({ ...prev, [assignmentId]: [] }));
      markAssignmentTodoCompleted(assignmentId);
      fetchUpcoming();
      fetchAssignments();
      fetchProgressData();
    } catch (err) {
      setAssignmentStatus((prev) => ({
        ...prev,
        [assignmentId]: err.response?.data?.message || 'Submission failed.',
      }));
    }
  };

  const fetchAssignmentSubmissions = async (assignmentId) => {
    try {
      setAssignmentSubmissionsLoading((prev) => ({ ...prev, [assignmentId]: true }));
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.get(`${API_BASE}/api/student/assignments/${assignmentId}/submissions`, config);
      setAssignmentSubmissions((prev) => ({
        ...prev,
        [assignmentId]: Array.isArray(res.data?.submissions) ? res.data.submissions : [],
      }));
    } catch {
      setAssignmentSubmissions((prev) => ({ ...prev, [assignmentId]: [] }));
    } finally {
      setAssignmentSubmissionsLoading((prev) => ({ ...prev, [assignmentId]: false }));
    }
  };

  const getAssignmentStatus = (assignment) => {
    const submission = assignment.latestSubmission;
    const deadline = assignment.deadline ? new Date(assignment.deadline) : null;
    const isPastDue = deadline ? new Date() > deadline : false;
    const maxPoints = Number.isFinite(Number(assignment?.maxPoints)) ? Number(assignment.maxPoints) : null;

    if (!submission) {
      return isPastDue ? { label: 'Missing', tone: 'error' } : { label: 'Pending', tone: 'muted' };
    }

    if (submission.score !== null && submission.score !== undefined) {
      const scoreText = maxPoints ? `${submission.score} / ${maxPoints}` : String(submission.score);
      return { label: `Graded • ${scoreText}`, tone: 'primary' };
    }

    if (submission.isLate) {
      return { label: `Late • v${submission.version}`, tone: 'error' };
    }

    return { label: `Submitted • v${submission.version}`, tone: 'success' };
  };

  const activePracticeTests = practiceTests.filter((test) => test?.isActive !== false);
  const pastPracticeTests = practiceTests.filter((test) => test?.isActive === false);

  return (
    <div className="dashboard-layout">
      {/* Sidebar */}
      <div className="dashboard-sidebar">
        <h2 className="text-xl mb-8"><span className="text-gradient">Student Hub</span></h2>

        <div style={{ flex: 1, marginTop: '20px' }} className="flex flex-col gap-4 w-full">
          <button
            className={`flex items-center gap-4 w-full ${activeTab === 'dashboard' ? 'btn-primary shadow-lg' : 'btn-secondary border-none opacity-70 hover:opacity-100'}`}
            style={{ justifyContent: 'flex-start', padding: '14px 20px' }}
            onClick={() => {
              setActiveTab('dashboard');
              if (contentRef.current) {
                contentRef.current.scrollTop = 0;
              }
            }}
          >
            <LayoutDashboard size={20} />
            <span className="font-medium">Dashboard Overview</span>
          </button>
          <button
            className={`flex items-center gap-4 w-full ${activeTab === 'evaluate' ? 'btn-primary shadow-lg' : 'btn-secondary border-none opacity-70 hover:opacity-100'}`}
            style={{ justifyContent: 'flex-start', padding: '14px 20px' }}
            onClick={() => setActiveTab('evaluate')}
          >
            <FileText size={20} />
            <span className="font-medium">AI Project Evaluation</span>
          </button>
          <button
            className={`flex items-center gap-4 w-full ${activeTab === 'learning' ? 'btn-primary shadow-lg' : 'btn-secondary border-none opacity-70 hover:opacity-100'}`}
            style={{ justifyContent: 'flex-start', padding: '14px 20px' }}
            onClick={() => setActiveTab('learning')}
          >
            <Target size={20} />
            <span className="font-medium">Learning Path</span>
          </button>
          <button
            className={`flex items-center gap-4 w-full ${activeTab === 'courses' ? 'btn-primary shadow-lg' : 'btn-secondary border-none opacity-70 hover:opacity-100'}`}
            style={{ justifyContent: 'flex-start', padding: '14px 20px' }}
            onClick={() => {
              setActiveTab('courses');
              refreshCourses();
            }}
          >
            <Book size={20} />
            <span className="font-medium">Course Modules</span>
          </button>
          <button
            className={`flex items-center gap-4 w-full ${activeTab === 'announcements' ? 'btn-primary shadow-lg' : 'btn-secondary border-none opacity-70 hover:opacity-100'}`}
            style={{ justifyContent: 'flex-start', padding: '14px 20px' }}
            onClick={() => setActiveTab('announcements')}
          >
            <AlertCircle size={20} />
            <span className="font-medium">Announcements</span>
          </button>
          <button
            className={`flex items-center gap-4 w-full ${activeTab === 'practice' ? 'btn-primary shadow-lg' : 'btn-secondary border-none opacity-70 hover:opacity-100'}`}
            style={{ justifyContent: 'flex-start', padding: '14px 20px' }}
            onClick={() => setActiveTab('practice')}
          >
            <Zap size={20} />
            <span className="font-medium">Practice Tests</span>
          </button>
          <button
            className={`flex items-center gap-4 w-full ${activeTab === 'analytics' ? 'btn-primary shadow-lg' : 'btn-secondary border-none opacity-70 hover:opacity-100'}`}
            style={{ justifyContent: 'flex-start', padding: '14px 20px' }}
            onClick={() => {
              setActiveTab('analytics');
              fetchLeaderboard();
            }}
          >
            <Users size={20} />
            <span className="font-medium">Team & Analytics</span>
          </button>
          <button
            className={`flex items-center gap-4 w-full ${activeTab === 'feedback' ? 'btn-primary shadow-lg' : 'btn-secondary border-none opacity-70 hover:opacity-100'}`}
            style={{ justifyContent: 'flex-start', padding: '14px 20px' }}
            onClick={() => {
              setActiveTab('feedback');
              fetchFeedback();
            }}
          >
            <MessageSquare size={20} />
            <span className="font-medium">My Feedback</span>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
          <button
            className="flex items-center gap-4 btn-secondary w-full"
            style={{ border: 'none', justifyContent: 'flex-start' }}
            onClick={toggleTheme}
          >
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
            <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="dashboard-content" ref={contentRef}>
        <div className="glass-panel" style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div>
            <h1 className="text-3xl font-bold mb-2">Welcome back, {userName} 👋</h1>
            <p className="text-muted">Ready to learn today?</p>
          </div>
          <CourseSwitcher label="Active Course" />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              className="px-4 py-2 rounded-lg flex items-center gap-2 text-sm"
              style={{
                background: 'rgba(52, 199, 89, 0.15)',
                color: '#34C759',
              }}
            >
              <CheckCircle2 size={16} />
              Active Now
            </div>
            <button
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--error)' }}
              onClick={handleLogout}
            >
              <LogOut size={16} />
              <span>Logout</span>
            </button>
          </div>
        </div>

        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div className="glass-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <h2 className="text-xl font-semibold">Progress Tracking</h2>
                {progressData?.activityLevel ? (
                  <span
                    style={{
                      padding: '0.35rem 0.65rem',
                      borderRadius: '9999px',
                      fontSize: '0.75rem',
                      textTransform: 'uppercase',
                      background: progressData.activityLevel === 'high' ? 'rgba(52, 199, 89, 0.18)' : progressData.activityLevel === 'medium' ? 'rgba(255, 193, 7, 0.18)' : 'rgba(255, 59, 48, 0.18)',
                      color: progressData.activityLevel === 'high' ? '#34C759' : progressData.activityLevel === 'medium' ? '#FFC107' : '#FF3B30',
                      fontWeight: 600,
                    }}
                  >
                    {progressData.activityLevel} engagement
                  </span>
                ) : null}
              </div>

              {progressLoading ? (
                <p style={{ color: 'var(--muted)' }}>Calculating your latest progress...</p>
              ) : progressError ? (
                <p style={{ color: 'var(--error)' }}>{progressError}</p>
              ) : !activeCourseId || activeCourseId === 'all' ? (
                <p style={{ color: 'var(--muted)' }}>
                  Select an active course to see detailed progress insights.
                </p>
              ) : (
                <>
                  {progressData && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.9rem', marginBottom: '1rem' }}>
                      <div style={{ padding: '0.9rem', border: '1px solid var(--border)', borderRadius: '12px', background: 'var(--surface-hover)' }}>
                        <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Overall Progress</p>
                        <p style={{ fontSize: '1.35rem', fontWeight: 700 }}>{Math.round(progressData.overallProgress || 0)}%</p>
                      </div>
                      <div style={{ padding: '0.9rem', border: '1px solid var(--border)', borderRadius: '12px', background: 'var(--surface-hover)' }}>
                        <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Assignments</p>
                        <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>{Math.round(progressData.assignmentStats?.avgScore || 0)}%</p>
                        <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{progressData.assignmentStats?.pending || 0} pending</p>
                      </div>
                      <div style={{ padding: '0.9rem', border: '1px solid var(--border)', borderRadius: '12px', background: 'var(--surface-hover)' }}>
                        <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Practice Tests</p>
                        <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>{Math.round(progressData.testStats?.avgScore || 0)}%</p>
                        <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{progressData.testStats?.attempts || 0} attempt(s)</p>
                      </div>
                      <div style={{ padding: '0.9rem', border: '1px solid var(--border)', borderRadius: '12px', background: 'var(--surface-hover)' }}>
                        <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Modules Completed</p>
                        <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>{progressData.modulesCompleted || 0}/{progressData.totalModules || 0}</p>
                      </div>
                    </div>
                  )}

                  {progressData?.weakTopics?.length > 0 ? (
                    <p style={{ marginBottom: '0.75rem' }}>
                      You are weak in <strong>{progressData.weakTopics.slice(0, 3).join(', ')}</strong>.
                    </p>
                  ) : (
                    <p style={{ marginBottom: '0.75rem', color: 'var(--muted)' }}>No weak topics detected yet. Keep practicing to build a stronger profile.</p>
                  )}

                  {progressData?.aiInsights?.recommendations?.length > 0 && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <p className="font-semibold" style={{ marginBottom: '0.35rem' }}>Recommended Next Steps</p>
                      <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--muted)' }}>
                        {progressData.aiInsights.recommendations.slice(0, 3).map((rec, idx) => (
                          <li key={`${rec}-${idx}`}>{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.8rem' }}>
                    <p className="font-semibold" style={{ marginBottom: '0.5rem' }}>Course-wise Progress</p>
                    {allCourseProgress.length === 0 ? (
                      <p style={{ color: 'var(--muted)' }}>No course progress yet.</p>
                    ) : (
                      <div style={{ display: 'grid', gap: '0.45rem' }}>
                        {allCourseProgress.slice(0, 6).map((row) => (
                          <div key={`${row.courseId?._id || row.courseId}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ color: 'var(--muted)' }}>{row.courseId?.courseCode || row.courseId?.title || 'Course'}</span>
                            <strong>{Math.round(row.overallProgress || 0)}%</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Upcoming Deadlines */}
            <div className="glass-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Clock size={20} style={{ color: 'var(--primary)' }} />
                  <h2 className="text-xl font-semibold">Upcoming Deadlines</h2>
                </div>
                <a href="#" style={{ color: 'var(--primary)', fontSize: '0.875rem' }} className="hover:underline">
                  See all →
                </a>
              </div>
              {upcomingLoading ? (
                <p style={{ color: 'var(--muted)' }}>Loading upcoming deadlines...</p>
              ) : upcomingAssignments.length === 0 ? (
                <p style={{ color: 'var(--muted)' }}>No upcoming deadlines yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {upcomingAssignments.map((deadline) => {
                    const dueAt = new Date(deadline.deadline);
                    const diffDays = Math.max(0, Math.ceil((dueAt - new Date()) / (1000 * 60 * 60 * 24)));
                    const urgent = diffDays <= 2;
                    return (
                      <div
                        key={deadline._id}
                        className="p-4 rounded-lg border"
                        style={{
                          background: 'var(--surface-hover)',
                          borderColor: 'var(--border)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', alignItems: 'center' }}>
                          <div>
                            <h3 className="font-semibold">{deadline.title}</h3>
                            <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>{deadline.course?.courseCode || ''}</p>
                          </div>
                          <span
                            style={{
                              padding: '0.5rem 0.75rem',
                              borderRadius: '9999px',
                              fontSize: '0.75rem',
                              fontWeight: 500,
                              background: urgent ? 'rgba(255, 59, 48, 0.15)' : 'rgba(255, 193, 7, 0.15)',
                              color: urgent ? '#FF3B30' : '#FFC107',
                            }}
                          >
                            {diffDays} days left
                          </span>
                        </div>
                        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                          Due {dueAt.toLocaleString()}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Learning and Practice Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
              {/* Continue Learning */}
              <div className="glass-panel">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
                  <Zap size={20} style={{ color: 'var(--secondary)' }} />
                  <h2 className="text-xl font-semibold">Continue Learning</h2>
                </div>
                {learningPath ? (
                  <div>
                    <div style={{ marginBottom: '1.5rem' }}>
                      <div
                        style={{
                          background: 'linear-gradient(135deg, rgba(142, 36, 170, 0.2), rgba(10, 132, 255, 0.2))',
                          border: '1px solid var(--border)',
                          borderRadius: '0.5rem',
                          padding: '1rem',
                          marginBottom: '1rem'
                        }}
                      >
                        <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                          Next Best Topic
                        </p>
                        <h3 className="text-lg font-bold mb-3">{learningPath.next_best_topic}</h3>
                        <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>{learningPath.adaptive_message}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-semibold mb-3">Topics To Revise:</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {learningPath.topics_to_revise?.map((topic, idx) => (
                          <span
                            key={idx}
                            style={{
                              padding: '0.25rem 0.75rem',
                              borderRadius: '9999px',
                              fontSize: '0.75rem',
                              fontWeight: 500,
                              background: 'var(--surface-hover)',
                              border: '1px solid var(--border)',
                            }}
                          >
                            {topic}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      style={{
                        width: '100%',
                        marginTop: '1.5rem',
                        padding: '0.75rem',
                        borderRadius: '0.5rem',
                        fontWeight: 500,
                        background: 'var(--primary)',
                        color: 'white',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem'
                      }}
                    >
                      <ArrowRight size={18} />
                      Resume Lesson
                    </button>
                  </div>
                ) : (
                  <p style={{ color: 'var(--muted)' }}>Loading learning profile...</p>
                )}
              </div>

              {/* Practice Tests */}
              <div className="glass-panel">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
                  <Award size={20} style={{ color: 'var(--primary)' }} />
                  <h2 className="text-xl font-semibold">Practice Tests</h2>
                </div>
                {practiceLoading ? (
                  <p style={{ color: 'var(--muted)' }}>Loading available practice tests...</p>
                ) : !activeCourseId || activeCourseId === 'all' ? (
                  <p style={{ color: 'var(--muted)' }}>Select an active course to view practice tests.</p>
                ) : practiceTests.length === 0 ? (
                  <p style={{ color: 'var(--muted)' }}>No practice tests available yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {practiceTests.slice(0, 4).map((test) => (
                      <div
                        key={test._id}
                        style={{
                          padding: '0.75rem 0.9rem',
                          borderRadius: '10px',
                          border: '1px solid var(--border)',
                          background: 'var(--surface-hover)',
                          display: 'grid',
                          gridTemplateColumns: '1fr auto',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        <div>
                          <p className="font-semibold">{test.title}</p>
                          <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                            {test.questionCount || 0} questions • {String(test.difficulty || 'medium').toUpperCase()}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setActiveTab('practice')}
                          style={{ fontSize: '0.8rem', padding: '0.45rem 0.7rem' }}
                        >
                          Open
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setActiveTab('practice')}
                      style={{ marginTop: '0.25rem' }}
                    >
                      View All Practice Tests
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* AI Teaching Assistant */}
            <div className="glass-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <MessageSquare size={20} style={{ color: '#34C759' }} />
                  <h2 className="text-xl font-semibold">AI Teaching Assistant</h2>
                </div>
                <span
                  style={{
                    padding: '0.25rem 0.75rem',
                    borderRadius: '9999px',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    background: 'rgba(52, 199, 89, 0.15)',
                    color: '#34C759',
                  }}
                >
                  Active
                </span>
              </div>
              <div
                style={{
                  height: '560px',
                  maxHeight: '560px',
                  width: '100%',
                  borderRadius: '0.5rem',
                  padding: 0,
                  background: 'transparent',
                  overflow: 'hidden',
                }}
              >
                <Chatbot />
              </div>
            </div>

            {/* To-Do List */}
            <div className="glass-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 size={20} style={{ color: 'var(--primary)' }} />
                  <h2 className="text-xl font-semibold">Your To-Do List</h2>
                </div>
                <span style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
                  {completedCount} out of {totalCount} done
                </span>
              </div>

              <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Add a new task..."
                  value={newTodoTitle}
                  onChange={(e) => setNewTodoTitle(e.target.value)}
                  onKeyDown={handleTodoInputKeyDown}
                  className="glass-input"
                  style={{
                    flex: 1,
                    minWidth: '240px',
                    padding: '0.75rem',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--border)',
                  }}
                />
                <select
                  value={newTodoPriority}
                  onChange={(e) => setNewTodoPriority(e.target.value)}
                  className="prof-select"
                  style={{
                    padding: '0.75rem',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--border)',
                    minWidth: '140px',
                  }}
                >
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
                <button
                  type="button"
                  onClick={addTodo}
                  style={{
                    padding: '0.75rem 1.5rem',
                    borderRadius: '0.5rem',
                    fontWeight: 500,
                    background: 'var(--primary)',
                    color: 'white',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    transition: 'all 0.2s ease',
                    flexShrink: 0,
                  }}
                >
                  <Plus size={18} />
                  Add
                </button>
              </div>

              {totalCount === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
                  <CheckCircle2 size={48} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
                  <p>No tasks yet. Add one to get started!</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {todos.map((task) => (
                    <div
                      key={task.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.75rem 1rem',
                        borderRadius: '0.5rem',
                        background: task.done ? 'rgba(52, 199, 89, 0.08)' : 'var(--surface-hover)',
                        border: task.priority === 'urgent'
                          ? '1px solid rgba(255, 59, 48, 0.3)'
                          : task.priority === 'high'
                          ? '1px solid rgba(255, 193, 7, 0.3)'
                          : '1px solid var(--border)',
                        transition: 'all 0.2s ease',
                        opacity: task.done ? 0.7 : 1,
                      }}
                    >
                      <button
                        onClick={() => toggleTodo(task.id)}
                        style={{
                          width: '24px',
                          height: '24px',
                          minWidth: '24px',
                          borderRadius: '0.375rem',
                          border: task.done ? 'none' : '2px solid var(--border)',
                          background: task.done ? 'var(--primary)' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        {task.done && <Check size={16} style={{ color: 'white' }} />}
                      </button>

                      <span
                        style={{
                          flex: 1,
                          textDecoration: task.done ? 'line-through' : 'none',
                          color: task.done ? 'var(--muted)' : 'var(--text-main)',
                          fontSize: '0.95rem',
                          wordBreak: 'break-word',
                        }}
                      >
                        {task.title}
                      </span>

                      {task.priority === 'urgent' && (
                        <AlertCircle
                          size={16}
                          style={{
                            color: '#FF3B30',
                            flexShrink: 0,
                          }}
                        />
                      )}

                      {task.priority === 'high' && (
                        <div
                          style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '50%',
                            background: '#FFC107',
                            flexShrink: 0,
                          }}
                        />
                      )}

                      <button
                        onClick={() => deleteTodo(task.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--muted)',
                          padding: '0.25rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s ease',
                          flexShrink: 0,
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {totalCount > 0 && (
                <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
                    <span style={{ color: 'var(--muted)' }}>Progress</span>
                    <span style={{ fontWeight: 500 }}>{Math.round((completedCount / totalCount) * 100)}%</span>
                  </div>
                  <div style={{ height: '8px', borderRadius: '9999px', background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${(completedCount / totalCount) * 100}%`,
                        height: '100%',
                        background: 'var(--primary)',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* EVALUATE TAB */}
        {activeTab === 'evaluate' && (
          <div className="glass-panel">
            <h2 className="text-2xl font-bold mb-2">AI Project Evaluation</h2>
            <p style={{ color: 'var(--muted)', marginBottom: '2rem' }}>
              Submit code/docs as text or upload files. The model evaluates strictly against rubric criteria.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.75rem' }}>
                  <label className="block text-sm font-semibold">Rubric</label>
                  {activeCourseId && activeCourseId !== 'all' && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.25rem 0.6rem',
                        borderRadius: '9999px',
                        border: '1px solid var(--border)',
                        background: 'var(--surface-hover)',
                        color: 'var(--muted)',
                      }}
                    >
                      {rubricLoading
                        ? 'Syncing…'
                        : activeRubricText && String(activeRubricText).trim()
                          ? 'Synced to professor'
                          : 'Default rubric'}
                    </span>
                  )}
                </div>
                <textarea
                  className="glass-input"
                  style={{ width: '100%', minHeight: '100px', padding: '12px' }}
                  value={rubricText}
                  onChange={(e) => setRubricText(e.target.value)}
                  placeholder="1. Clarity (20%)\n2. Accuracy (50%)\n3. Originality (30%)"
                  readOnly={Boolean(activeRubricText && String(activeRubricText).trim())}
                />

                {activeCourseId && activeCourseId !== 'all' && activeRubricText && String(activeRubricText).trim() && (
                  <p style={{ marginTop: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
                    This rubric is managed by your professor for the active course.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold mb-3">Course Key</label>
                <input
                  className="glass-input"
                  style={{ width: '100%', padding: '12px' }}
                  value={evaluationCourseKey}
                  onChange={(e) => setEvaluationCourseKey(e.target.value)}
                  placeholder="Course key"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-3">Submission Text</label>
                <textarea
                  className="glass-input"
                  style={{ width: '100%', minHeight: '160px', padding: '12px' }}
                  value={submissionText}
                  onChange={(e) => setSubmissionText(e.target.value)}
                  placeholder="Paste project code/docs content here..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-3">Submission Files</label>
                <input
                  type="file"
                  multiple
                  onChange={(e) => setSubmissionFiles(Array.from(e.target.files || []))}
                  className="glass-input"
                  style={{ width: '100%', padding: '10px' }}
                />
                {submissionFiles.length > 0 && (
                  <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
                    {submissionFiles.length} file(s) selected
                  </p>
                )}
              </div>

              <button
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  fontWeight: 500,
                  background: isEvaluating ? 'var(--muted)' : 'var(--primary)',
                  color: 'white',
                  cursor: isEvaluating || (!submissionText && submissionFiles.length === 0) ? 'not-allowed' : 'pointer',
                  opacity: isEvaluating || (!submissionText && submissionFiles.length === 0) ? 0.5 : 1,
                  border: 'none'
                }}
                onClick={handleEvaluate}
                disabled={isEvaluating || (!submissionText && submissionFiles.length === 0)}
              >
                {isEvaluating ? 'Evaluating...' : 'Run AI Evaluation'}
              </button>

              {evaluationData && (
                <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                    <div className="glass-card" style={{ padding: '1.5rem' }}>
                      <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                        Final Score
                      </p>
                      <p className="text-3xl font-bold" style={{ color: 'var(--primary)' }}>
                        {evaluationData.score}%
                      </p>
                    </div>
                    <div className="glass-card" style={{ padding: '1.5rem' }}>
                      <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                        Summary
                      </p>
                      <p className="text-sm">{evaluationData.explanation}</p>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                    {['strengths', 'weaknesses', 'suggestions'].map((section) => (
                      <div key={section} className="glass-card" style={{ padding: '1.5rem' }}>
                        <h3 className="font-semibold mb-3 capitalize">{section}</h3>
                        <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {(evaluationData[section] || []).map((item, idx) => (
                            <li key={idx} style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
                              • {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>

                  {Array.isArray(evaluationData.criterion_breakdown) && evaluationData.criterion_breakdown.length > 0 && (
                    <div className="glass-card" style={{ padding: '1.25rem' }}>
                      <h3 className="font-semibold mb-3">Criterion-wise Breakdown</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {evaluationData.criterion_breakdown.map((row, idx) => (
                          <div key={`${row.criterion}-${idx}`} style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '0.75rem', background: 'var(--surface-hover)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                              <strong>{row.criterion}</strong>
                              <span>{row.score}/100 • {row.weight}%</span>
                            </div>
                            <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{row.rationale}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'announcements' && (
          <AnnouncementsPanel role="student" activeCourseId={activeCourseId} activeCourse={activeCourse} />
        )}

        {/* OTHER TABS */}
        {activeTab === 'learning' && (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
            <TrendingUp size={48} style={{ margin: '0 auto 1rem', color: 'var(--primary)' }} />
            <h2 className="text-2xl font-bold mb-2">Learning Path</h2>
            <p style={{ color: 'var(--muted)' }}>Your personalized learning journey coming soon</p>
          </div>
        )}

        {activeTab === 'courses' && (
          <div className="glass-panel" style={{ padding: '2rem 1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h2 className="text-2xl font-bold mb-2">My Courses</h2>
                <p style={{ color: 'var(--muted)' }}>Join a class with a code and see your enrolled courses.</p>
              </div>
              <button className="btn-secondary" onClick={refreshCourses} disabled={coursesLoading}>Refresh</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <label className="text-sm font-semibold">Join Course</label>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <input
                  className="glass-input"
                  style={{ flex: 1, minWidth: '240px', textTransform: 'uppercase' }}
                  placeholder="Enter course code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                />
                <button className="btn-primary" onClick={handleJoinCourse}>
                  Join
                </button>
              </div>
              {joinStatus && (
                <div className={`auth-alert ${joinStatusType === 'success' ? 'auth-alert--success' : 'auth-alert--error'}`}>
                  {joinStatus}
                </div>
              )}
            </div>

            {isAllCourses ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
                <Book size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
                <p>Select a course to view modules, assignments, and announcements.</p>
              </div>
            ) : coursesLoading ? (
              <p style={{ color: 'var(--muted)' }}>Loading courses...</p>
            ) : courses.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
                <Book size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
                <p>No enrolled courses yet. Use a course code to join.</p>
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                  {courses.map((course) => (
                    <div key={course._id} className="glass-card" style={{ padding: '1.25rem', borderRadius: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                        <div>
                          <h3 className="text-lg font-semibold">{course.title}</h3>
                          <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                            {course.courseCode}
                          </p>
                        </div>
                        <span style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem', borderRadius: '999px', background: 'rgba(10, 132, 255, 0.12)', color: 'var(--primary)' }}>
                          {course.studentsCount || 0} students
                        </span>
                      </div>
                      {course.description && (
                        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.75rem' }}>{course.description}</p>
                      )}
                      {course.professor?.name && (
                        <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
                          Professor: {course.professor.name}
                        </p>
                      )}

                      <div style={{ marginTop: '0.9rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <button className="btn-secondary" onClick={() => handleUnenrollCourse(course)}>
                          <Trash2 size={16} style={{ marginRight: '0.35rem' }} />
                          Unenroll
                        </button>
                      </div>

                      {unenrollStatus[course._id]?.message && (
                        <p style={{ marginTop: '0.65rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
                          {unenrollStatus[course._id].message}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: '2rem' }}>
                  <h3 className="text-xl font-semibold" style={{ marginBottom: '1rem' }}>Assignments</h3>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button className="btn-secondary" onClick={fetchAssignments}>Refresh Assignments</button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Sort</span>
                      <select
                        className="prof-select"
                        value={assignmentSort}
                        onChange={(e) => setAssignmentSort(e.target.value)}
                        style={{ padding: '0.65rem 0.75rem', borderRadius: '0.5rem', border: '1px solid var(--border)' }}
                      >
                        <option value="newest">Newer first</option>
                        <option value="oldest">Older first</option>
                      </select>
                    </div>
                  </div>

                  {assignmentsLoading ? (
                    <p style={{ color: 'var(--muted)', marginTop: '1rem' }}>Loading assignments...</p>
                  ) : assignments.length === 0 ? (
                    <p style={{ color: 'var(--muted)', marginTop: '1rem' }}>No assignments yet for this course.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                      {assignments.map((assignment) => (
                        <div key={assignment._id} className="glass-card" style={{ padding: '1.25rem', borderRadius: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '1rem' }}>
                            <div>
                              <h4 className="text-lg font-semibold">{assignment.title}</h4>
                              <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                                Due {new Date(assignment.deadline).toLocaleString()}
                              </p>
                            </div>
                            {(() => {
                              const status = getAssignmentStatus(assignment);
                              const toneMap = {
                                primary: { bg: 'rgba(10, 132, 255, 0.15)', color: '#0A84FF' },
                                success: { bg: 'rgba(52, 199, 89, 0.15)', color: '#34C759' },
                                error: { bg: 'rgba(255, 59, 48, 0.15)', color: '#FF3B30' },
                                muted: { bg: 'rgba(120, 120, 120, 0.2)', color: 'var(--muted)' },
                              };
                              const style = toneMap[status.tone] || toneMap.muted;
                              return (
                                <span style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem', borderRadius: '999px', background: style.bg, color: style.color }}>
                                  {status.label}
                                </span>
                              );
                            })()}
                          </div>
                          {assignment.description && (
                            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.75rem' }}>{assignment.description}</p>
                          )}
                          {assignment.rubric && (
                            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>Rubric: {assignment.rubric}</p>
                          )}
                          {Array.isArray(assignment.attachments) && assignment.attachments.length > 0 && (
                            <div style={{ marginTop: '0.75rem' }}>
                              <p className="text-sm font-semibold">Attachments</p>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                                {assignment.attachments.map((file) => (
                                  <a
                                    key={file.url}
                                    href={`${API_BASE}${file.url}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ fontSize: '0.8rem', color: 'var(--primary)' }}
                                  >
                                    {file.originalName || file.filename}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                          {assignment.latestSubmission?.files?.length > 0 && (
                            <div style={{ marginTop: '0.75rem' }}>
                              <p className="text-sm font-semibold">Latest Submission</p>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                                {assignment.latestSubmission.files.map((file) => (
                                  <a
                                    key={file.url}
                                    href={`${API_BASE}${file.url}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ fontSize: '0.8rem', color: 'var(--primary)' }}
                                  >
                                    {file.originalName || file.filename}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                          <div style={{ marginTop: '0.75rem' }}>
                            <label className="text-sm font-semibold">Submit files</label>
                            <input
                              type="file"
                              multiple
                              className="glass-input"
                              style={{ width: '100%', marginTop: '0.5rem' }}
                              onChange={(e) =>
                                setAssignmentFiles((prev) => ({
                                  ...prev,
                                  [assignment._id]: Array.from(e.target.files || []),
                                }))
                              }
                            />
                            <button
                              className="btn-primary"
                              style={{ marginTop: '0.75rem' }}
                              onClick={() => submitAssignment(assignment._id)}
                            >
                              Submit
                            </button>
                            {assignmentStatus[assignment._id] && (
                              <p style={{ marginTop: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
                                {assignmentStatus[assignment._id]}
                              </p>
                            )}
                          </div>
                          <div style={{ marginTop: '0.75rem' }}>
                            <button
                              className="btn-secondary"
                              onClick={() => {
                                const next = expandedAssignmentId === assignment._id ? '' : assignment._id;
                                setExpandedAssignmentId(next);
                                if (next) fetchAssignmentSubmissions(assignment._id);
                              }}
                            >
                              {expandedAssignmentId === assignment._id ? 'Hide Timeline' : 'View Timeline'}
                            </button>
                          </div>
                          {expandedAssignmentId === assignment._id && (
                            <div style={{ marginTop: '0.75rem' }}>
                              {assignmentSubmissionsLoading[assignment._id] ? (
                                <p style={{ color: 'var(--muted)' }}>Loading submissions...</p>
                              ) : (assignmentSubmissions[assignment._id] || []).length === 0 ? (
                                <p style={{ color: 'var(--muted)' }}>No submissions yet.</p>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                  {(assignmentSubmissions[assignment._id] || []).map((submission) => (
                                    <div key={submission._id} style={{ padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--surface-hover)' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                                        <strong>Version {submission.version}</strong>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                                          {new Date(submission.submittedAt).toLocaleString()}
                                        </span>
                                      </div>
                                      <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                                        Status: {submission.isLate ? 'Late' : 'On time'}
                                        {submission.score !== null && submission.score !== undefined && ` • Score: ${submission.score}`}
                                      </div>
                                      {submission.feedback && (
                                        <p style={{ marginTop: '0.35rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
                                          Feedback: {submission.feedback}
                                        </p>
                                      )}
                                      {submission.files?.length > 0 && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                                          {submission.files.map((file) => (
                                            <a
                                              key={file.url}
                                              href={`${API_BASE}${file.url}`}
                                              target="_blank"
                                              rel="noreferrer"
                                              style={{ fontSize: '0.8rem', color: 'var(--primary)' }}
                                            >
                                              {file.originalName || file.filename}
                                            </a>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'practice' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="glass-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <h2 className="text-xl font-semibold" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Zap size={18} style={{ color: 'var(--primary)' }} />
                    Practice Tests
                  </h2>
                  <p style={{ color: 'var(--muted)', marginTop: '0.25rem' }}>
                    Course-specific tests that adapt based on your performance.
                  </p>
                </div>
                <button className="btn-secondary" onClick={fetchPracticeTests}>
                  Refresh
                </button>
              </div>

              {practiceError && (
                <p style={{ marginTop: '0.75rem', color: 'var(--error)' }}>{practiceError}</p>
              )}

              {!activeCourseId || activeCourseId === 'all' ? (
                <p style={{ marginTop: '0.75rem', color: 'var(--muted)' }}>
                  Select an active course to view practice tests.
                </p>
              ) : null}

              <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Mode</label>
                  <select
                    className="prof-select"
                    value={practiceSettings.feedbackMode}
                    onChange={(e) => setPracticeSettings((p) => ({ ...p, feedbackMode: e.target.value }))}
                  >
                    <option value="delayed">Delayed feedback</option>
                    <option value="immediate">Immediate feedback</option>
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Timer</label>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={practiceSettings.timed}
                      onChange={(e) => setPracticeSettings((p) => ({ ...p, timed: e.target.checked }))}
                    />
                    <input
                      type="number"
                      min="1"
                      value={practiceSettings.minutes}
                      disabled={!practiceSettings.timed}
                      onChange={(e) => setPracticeSettings((p) => ({ ...p, minutes: e.target.value }))}
                      className="glass-input"
                      style={{ width: '110px' }}
                    />
                    <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>minutes</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Questions</label>
                  <input
                    type="number"
                    min="1"
                    value={practiceSettings.questionCount}
                    onChange={(e) => setPracticeSettings((p) => ({ ...p, questionCount: e.target.value }))}
                    className="glass-input"
                  />
                </div>
              </div>
            </div>

            {practiceSession ? (
              <div className="glass-panel">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <h3 className="text-lg font-semibold">{practiceSession.test?.title || 'Practice Test'}</h3>
                    <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                      Difficulty: {practiceSession.test?.difficulty || 'medium'}
                      {practiceSession.timed && practiceTimeLeft !== null
                        ? ` • Time left: ${Math.floor(practiceTimeLeft / 60)}:${String(practiceTimeLeft % 60).padStart(2, '0')}`
                        : ''}
                    </p>
                  </div>
                  <button className="btn-secondary" onClick={() => { setPracticeSession(null); setPracticeTimeLeft(null); }}>
                    Exit
                  </button>
                </div>

                {(() => {
                  const total = practiceSession.questions?.length || 0;
                  const answered = Object.keys(practiceAnswers).length;
                  const progress = total ? Math.round((answered / total) * 100) : 0;
                  return (
                    <div style={{ marginTop: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', fontSize: '0.85rem' }}>
                        <span>{answered} / {total} answered</span>
                        <span>{progress}%</span>
                      </div>
                      <div style={{ height: '10px', background: 'var(--surface-hover)', borderRadius: '999px', overflow: 'hidden', marginTop: '0.5rem', border: '1px solid var(--border)' }}>
                        <div style={{ width: `${progress}%`, height: '100%', background: 'var(--primary)' }} />
                      </div>
                    </div>
                  );
                })()}

                <div style={{ marginTop: '1.25rem', display: 'grid', gridTemplateColumns: '1fr 220px', gap: '1rem' }}>
                  <div>
                    {(() => {
                      const idx = practiceSession.currentIndex || 0;
                      const q = practiceSession.questions?.[idx];
                      if (!q) return <p style={{ color: 'var(--muted)' }}>No questions available.</p>;

                      const selected = practiceAnswers[q._id];
                      const check = practiceChecks[q._id];

                      return (
                        <div>
                          <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Question {idx + 1}</p>
                          <h4 className="text-lg font-semibold" style={{ marginTop: '0.25rem' }}>{q.questionText}</h4>
                          <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {(q.options || []).map((opt, optIdx) => {
                              const isSelected = selected === optIdx;
                              const showImmediate = practiceSession.feedbackMode === 'immediate' && check;
                              const isCorrectChoice = showImmediate && Number(check.correctAnswer) === optIdx;
                              const isWrongSelected = showImmediate && isSelected && !check.correct;
                              const borderColor = isCorrectChoice
                                ? 'rgba(52, 199, 89, 0.55)'
                                : isWrongSelected
                                ? 'rgba(255, 59, 48, 0.55)'
                                : 'var(--border)';

                              return (
                                <button
                                  key={optIdx}
                                  type="button"
                                  className="btn-secondary"
                                  style={{
                                    textAlign: 'left',
                                    justifyContent: 'flex-start',
                                    border: `1px solid ${borderColor}`,
                                    background: isSelected ? 'rgba(10, 132, 255, 0.12)' : 'var(--surface-hover)',
                                  }}
                                  onClick={() => selectPracticeAnswer({ questionId: q._id, selectedIndex: optIdx })}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>

                          {practiceSession.feedbackMode === 'immediate' && check && (
                            <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', borderRadius: '0.75rem', border: '1px solid var(--border)', background: 'var(--surface-hover)' }}>
                              <p style={{ fontWeight: 700, color: check.correct ? 'var(--primary)' : 'var(--error)' }}>
                                {check.correct ? 'Correct' : 'Not quite'}
                              </p>
                              {check.explanation ? (
                                <p style={{ marginTop: '0.35rem', color: 'var(--muted)' }}>{check.explanation}</p>
                              ) : null}
                            </div>
                          )}

                          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between' }}>
                            <button
                              className="btn-secondary"
                              type="button"
                              disabled={(practiceSession.currentIndex || 0) === 0}
                              onClick={() => setPracticeSession((s) => ({ ...s, currentIndex: Math.max(0, (s.currentIndex || 0) - 1) }))}
                            >
                              Prev
                            </button>
                            <button
                              className="btn-primary"
                              type="button"
                              disabled={(practiceSession.currentIndex || 0) >= ((practiceSession.questions?.length || 1) - 1)}
                              onClick={() => setPracticeSession((s) => ({ ...s, currentIndex: Math.min((s.questions?.length || 1) - 1, (s.currentIndex || 0) + 1) }))}
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '1rem' }}>
                    <p style={{ fontWeight: 700 }}>Navigate</p>
                    <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem' }}>
                      {(practiceSession.questions || []).map((q, idx) => {
                        const answered = practiceAnswers[q._id] !== undefined;
                        const active = idx === (practiceSession.currentIndex || 0);
                        return (
                          <button
                            key={q._id}
                            type="button"
                            className={active ? 'btn-primary' : 'btn-secondary'}
                            style={{
                              padding: '0.5rem 0',
                              border: answered ? '1px solid rgba(52, 199, 89, 0.55)' : '1px solid var(--border)',
                            }}
                            onClick={() => setPracticeSession((s) => ({ ...s, currentIndex: idx }))}
                          >
                            {idx + 1}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      className="btn-primary"
                      style={{ width: '100%', marginTop: '1rem', opacity: practiceSubmitting ? 0.7 : 1 }}
                      disabled={practiceSubmitting}
                      onClick={submitPracticeAttempt}
                    >
                      {practiceSubmitting ? 'Submitting...' : 'Submit Test'}
                    </button>
                  </div>
                </div>
              </div>
            ) : practiceResult ? (
              <div className="glass-panel">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <h3 className="text-lg font-semibold">Result</h3>
                    <p style={{ color: 'var(--muted)' }}>
                      Score: <span style={{ color: 'var(--text-main)', fontWeight: 800 }}>{practiceResult.score}%</span>
                      {' '}({practiceResult.correctCount} / {practiceResult.total})
                      {practiceResult.timeTakenSeconds ? ` • Time: ${Math.floor(practiceResult.timeTakenSeconds / 60)}m` : ''}
                    </p>
                    {Array.isArray(practiceResult.weakAreas) && practiceResult.weakAreas.length > 0 && (
                      <p style={{ marginTop: '0.25rem', color: 'var(--muted)' }}>
                        Weak areas: {practiceResult.weakAreas.join(', ')}
                      </p>
                    )}
                  </div>
                  <button className="btn-secondary" onClick={() => setPracticeResult(null)}>
                    Back to tests
                  </button>
                </div>

                <div style={{ marginTop: '1rem' }}>
                  <h4 className="font-semibold">Review</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
                    {(practiceResult.breakdown || []).map((b, idx) => (
                      <div key={b.questionId || idx} style={{ border: '1px solid var(--border)', borderRadius: '12px', padding: '1rem', background: 'var(--surface-hover)' }}>
                        <p style={{ fontWeight: 800 }}>
                          Q{idx + 1}. {b.questionText}
                        </p>
                        <p style={{ marginTop: '0.35rem', color: b.correct ? 'var(--primary)' : 'var(--error)', fontWeight: 700 }}>
                          {b.correct ? 'Correct' : 'Wrong'}
                        </p>
                        <p style={{ marginTop: '0.35rem', color: 'var(--muted)' }}>
                          Your answer: {(b.options || [])[b.selectedIndex] ?? '—'}
                        </p>
                        <p style={{ marginTop: '0.25rem', color: 'var(--muted)' }}>
                          Correct answer: {(b.options || [])[b.correctAnswer] ?? '—'}
                        </p>
                        {b.explanation ? (
                          <p style={{ marginTop: '0.5rem' }}>{b.explanation}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                {Array.isArray(practiceResult.recommendedTests) && practiceResult.recommendedTests.length > 0 && (
                  <div style={{ marginTop: '1.25rem' }}>
                    <h4 className="font-semibold">Recommended next</h4>
                    <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                      {practiceResult.recommendedTests.map((t) => (
                        <div key={t._id} className="glass-card" style={{ padding: '1rem', borderRadius: '12px' }}>
                          <p style={{ fontWeight: 800 }}>{t.title}</p>
                          <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                            Difficulty: {t.difficulty} • {t.questionCount} questions
                          </p>
                          <button className="btn-primary" style={{ marginTop: '0.75rem' }} onClick={() => startPracticeTest(t)}>
                            Start
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="glass-panel">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <h3 className="text-lg font-semibold">Available Tests</h3>
                  <button className="btn-secondary" onClick={fetchPracticeHistory} disabled={practiceHistoryLoading}>
                    {practiceHistoryLoading ? 'Refreshing…' : 'Refresh history'}
                  </button>
                </div>

                {activeCourseId && activeCourseId !== 'all' && (
                  <div style={{ marginTop: '1rem' }}>
                    <h4 className="font-semibold">My Past Attempts</h4>
                    {practiceHistoryLoading ? (
                      <p style={{ color: 'var(--muted)', marginTop: '0.5rem' }}>Loading your attempts…</p>
                    ) : practiceHistory.length === 0 ? (
                      <p style={{ color: 'var(--muted)', marginTop: '0.5rem' }}>No attempts yet for this course.</p>
                    ) : (
                      <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                        {practiceHistory.slice(0, 8).map((row) => (
                          <div key={row.attemptId} className="glass-card" style={{ padding: '1rem', borderRadius: '12px' }}>
                            {(() => {
                              const match = practiceTests.find((t) => String(t._id) === String(row?.test?._id));
                              const canRetake = Boolean(match && match.isActive !== false);
                              return (
                                <>
                            <p style={{ fontWeight: 800 }}>{row?.test?.title || 'Practice Test'}</p>
                            <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                              Score: {row.score}%
                              {row.createdAt ? ` • ${new Date(row.createdAt).toLocaleString()}` : ''}
                            </p>
                            {Array.isArray(row.weakAreas) && row.weakAreas.length > 0 && (
                              <p style={{ marginTop: '0.35rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
                                Weak areas: {row.weakAreas.slice(0, 3).join(', ')}{row.weakAreas.length > 3 ? '…' : ''}
                              </p>
                            )}
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                              <button className="btn-secondary" onClick={() => viewPracticeAttempt(row)}>
                                Review
                              </button>
                              <button
                                className="btn-primary"
                                disabled={!canRetake}
                                onClick={() => {
                                  if (!canRetake) {
                                    setPracticeError('This test is inactive and cannot be retaken.');
                                    return;
                                  }
                                  if (match) startPracticeTest(match);
                                  else setPracticeError('This test is no longer available to start.');
                                }}
                              >
                                {canRetake ? 'Retake' : 'Inactive'}
                              </button>
                            </div>
                                </>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    )}
                    {practiceHistory.length > 8 && (
                      <p style={{ marginTop: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
                        Showing latest 8 attempts.
                      </p>
                    )}
                  </div>
                )}

                {practiceLoading ? (
                  <p style={{ color: 'var(--muted)', marginTop: '0.75rem' }}>Loading tests...</p>
                ) : activePracticeTests.length === 0 ? (
                  <p style={{ color: 'var(--muted)', marginTop: '0.75rem' }}>No tests available for this course yet.</p>
                ) : (
                  <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                    {activePracticeTests.map((t) => (
                      <div key={t._id} className="glass-card" style={{ padding: '1rem', borderRadius: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'start' }}>
                          <div>
                            <p style={{ fontWeight: 800 }}>{t.title}</p>
                            <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                              Difficulty: {t.difficulty} • {t.questionCount} questions
                            </p>
                          </div>
                          <span style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem', borderRadius: '999px', background: 'rgba(10, 132, 255, 0.12)', color: 'var(--primary)' }}>
                            {t.createdBy === 'ai' ? 'AI' : 'Prof'}
                          </span>
                        </div>
                        {Array.isArray(t.topics) && t.topics.length > 0 && (
                          <p style={{ marginTop: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
                            Topics: {t.topics.slice(0, 4).join(', ')}{t.topics.length > 4 ? '…' : ''}
                          </p>
                        )}
                        <button className="btn-primary" style={{ marginTop: '0.75rem' }} onClick={() => startPracticeTest(t)}>
                          Start Test
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {pastPracticeTests.length > 0 && (
                  <div style={{ marginTop: '1.25rem' }}>
                    <h4 className="font-semibold">Past Tests</h4>
                    <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: '0.3rem' }}>
                      These tests are inactive and cannot be retaken.
                    </p>
                    <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                      {pastPracticeTests.map((t) => (
                        <div key={t._id} className="glass-card" style={{ padding: '1rem', borderRadius: '12px', opacity: 0.88 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'start' }}>
                            <div>
                              <p style={{ fontWeight: 800 }}>{t.title}</p>
                              <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                                Difficulty: {t.difficulty} • {t.questionCount} questions
                              </p>
                            </div>
                            <span style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem', borderRadius: '999px', background: 'rgba(255, 59, 48, 0.15)', color: '#FF6259' }}>
                              Inactive
                            </span>
                          </div>
                          {Array.isArray(t.topics) && t.topics.length > 0 && (
                            <p style={{ marginTop: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
                              Topics: {t.topics.slice(0, 4).join(', ')}{t.topics.length > 4 ? '…' : ''}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="glass-panel" style={{ padding: '2rem 1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h2 className="text-2xl font-bold mb-1">Class Leaderboard</h2>
                <p style={{ color: 'var(--muted)' }}>Track class standings and healthy competition.</p>
              </div>
              <button className="btn-secondary" onClick={fetchLeaderboard}>Refresh</button>
            </div>

            {leaderboardLoading ? (
              <p style={{ color: 'var(--muted)' }}>Loading leaderboard...</p>
            ) : leaderboard.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>No leaderboard entries yet. Submit evaluations to populate standings.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {leaderboard.slice(0, 20).map((entry) => (
                  <div key={entry.studentId} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 100px 110px 90px', gap: '0.75rem', alignItems: 'center', padding: '0.75rem', borderRadius: '8px', background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                    <span style={{ fontWeight: 700, color: entry.rank <= 3 ? 'var(--primary)' : 'var(--text-main)' }}>#{entry.rank}</span>
                    <span>{entry.name}</span>
                    <span>{entry.score}%</span>
                    <span>{entry.submissions} evals</span>
                    <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{entry.coursesCovered} courses</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'feedback' && (
          <div>
            {!selectedFeedback ? (
              <div className="glass-panel">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                  <div>
                    <h2 className="text-2xl font-bold mb-2">My Feedback</h2>
                    <p style={{ color: 'var(--muted)' }}>Reviews from professors and AI evaluations</p>
                  </div>
                  <span style={{ background: 'rgba(10, 132, 255, 0.15)', color: 'var(--primary)', padding: '0.5rem 0.75rem', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600 }}>
                    {feedbackList.length} feedback
                  </span>
                </div>

                {feedbackList.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
                    <FileText size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
                    <p>No feedback yet. Submit a project to get started!</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {feedbackList.map((feedback) => (
                      <div
                        key={feedback._id}
                        onClick={() => setSelectedFeedback(feedback._id)}
                        style={{
                          padding: '1.5rem',
                          background: 'linear-gradient(135deg, rgba(10, 132, 255, 0.08), rgba(142, 36, 170, 0.05))',
                          border: '1px solid rgba(10, 132, 255, 0.2)',
                          borderRadius: '12px',
                          cursor: 'pointer',
                          transition: 'all 0.25s ease',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                          <div>
                            <h3 className="font-semibold text-lg">{feedback.courseKey}</h3>
                            <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                              AI Score: {feedback.aiEvaluation?.score}%
                            </p>
                          </div>
                          <span style={{
                            padding: '0.5rem 0.75rem',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            background: feedback.status === 'pending' ? 'rgba(255, 165, 0, 0.15)' :
                                        feedback.status === 'reviewed' ? 'rgba(10, 132, 255, 0.15)' :
                                        feedback.status === 'awaiting_response' ? 'rgba(255, 193, 7, 0.15)' :
                                        'rgba(52, 199, 89, 0.15)',
                            color: feedback.status === 'pending' ? '#FFA500' :
                                   feedback.status === 'reviewed' ? '#0A84FF' :
                                   feedback.status === 'awaiting_response' ? '#FFC107' :
                                   '#34C759'
                          }}>
                            {feedback.status.replace('_', ' ').toUpperCase()}
                          </span>
                        </div>
                        {feedback.professorReview?.manualFeedback && (
                          <p style={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.5, marginBottom: '0.5rem' }}>
                            {feedback.professorReview.manualFeedback.substring(0, 100)}...
                          </p>
                        )}
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', fontSize: '0.875rem', color: 'var(--muted)' }}>
                          {feedback.studentResponses?.length > 0 && (
                            <span>💬 {feedback.studentResponses.length} response{feedback.studentResponses.length !== 1 ? 's' : ''}</span>
                          )}
                          <ArrowRight size={16} style={{ marginLeft: 'auto' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <button
                  onClick={() => setSelectedFeedback(null)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '1.5rem',
                    padding: '0.75rem 1.5rem',
                    background: 'rgba(10, 132, 255, 0.15)',
                    border: '1px solid rgba(10, 132, 255, 0.3)',
                    color: 'var(--primary)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                  }}
                >
                  ← Back to Feedback List
                </button>
                <FeedbackViewer
                  evaluationId={selectedFeedback}
                  courseKey={feedbackList.find((f) => f._id === selectedFeedback)?.courseKey}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentDashboard;
