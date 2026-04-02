import React, { useState, useEffect } from 'react';
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
import { API_BASE } from '../config/api';

const StudentDashboard = () => {
  const navigate = useNavigate();
  const [isDark, setIsDark] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [learningPath, setLearningPath] = useState(null);
  const [error, setError] = useState('');
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
  const [todos, setTodos] = useState([]);
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const [newTodoPriority, setNewTodoPriority] = useState('normal');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setIsDark(savedTheme === 'dark');
    document.documentElement.setAttribute('data-theme', savedTheme);

    const user = JSON.parse(localStorage.getItem('user') || '{}');
    setUserName(user.name || 'Student');
    setEvaluationCourseKey((user.courseKey || 'general').toLowerCase());

    // Load todos from localStorage
    const savedTodos = JSON.parse(localStorage.getItem('studentTodos') || '[]');
    setTodos(savedTodos);

    const fetchData = async () => {
      try {
        const token = localStorage.getItem('token');
        const config = { headers: { Authorization: `Bearer ${token}` } };
        const pathRes = await axios.get(`${API_BASE}/api/student/learning-path`, config);
        setLearningPath(pathRes.data);
      } catch (err) {
        console.error(err);
        setError('Failed to fetch learning path.');
      }
    };
    fetchData();
  }, []);

  const saveTodosToLocalStorage = (updatedTodos) => {
    localStorage.setItem('studentTodos', JSON.stringify(updatedTodos));
  };

  const addTodo = () => {
    if (!newTodoTitle.trim()) return;
    const newTodo = {
      id: Date.now(),
      title: newTodoTitle.trim(),
      done: false,
      priority: newTodoPriority,
      createdAt: new Date().toISOString(),
    };
    const updatedTodos = [...todos, newTodo];
    setTodos(updatedTodos);
    saveTodosToLocalStorage(updatedTodos);
    setNewTodoTitle('');
    setNewTodoPriority('normal');
  };

  const toggleTodo = (id) => {
    const updatedTodos = todos.map(todo =>
      todo.id === id ? { ...todo, done: !todo.done } : todo
    );
    setTodos(updatedTodos);
    saveTodosToLocalStorage(updatedTodos);
  };

  const deleteTodo = (id) => {
    const updatedTodos = todos.filter(todo => todo.id !== id);
    setTodos(updatedTodos);
    saveTodosToLocalStorage(updatedTodos);
  };

  const completedCount = todos.filter(todo => todo.done).length;
  const totalCount = todos.length;

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('user');
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
      const res = await axios.get(`${API_BASE}/api/feedback`, config);
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
      const res = await axios.get(`${API_BASE}/api/student/leaderboard`, config);
      setLeaderboard(Array.isArray(res.data?.leaderboard) ? res.data.leaderboard : []);
    } catch (err) {
      console.error(err);
      setLeaderboard([]);
    } finally {
      setLeaderboardLoading(false);
    }
  };

  return (
    <div className="dashboard-layout">
      {/* Sidebar */}
      <div className="dashboard-sidebar">
        <h2 className="text-xl mb-8"><span className="text-gradient">Student Hub</span></h2>
        
        <div style={{ flex: 1, marginTop: '20px' }} className="flex flex-col gap-4 w-full">
          <button 
            className={`flex items-center gap-4 w-full ${activeTab === 'dashboard' ? 'btn-primary shadow-lg' : 'btn-secondary border-none opacity-70 hover:opacity-100'}`} 
            style={{ justifyContent: 'flex-start', padding: '14px 20px' }}
            onClick={() => setActiveTab('dashboard')}
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
            onClick={() => setActiveTab('courses')}
          >
            <Book size={20} />
            <span className="font-medium">Course Modules</span>
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
          
          <button 
            className="flex items-center gap-4 btn-secondary w-full" 
            style={{ border: 'none', justifyContent: 'flex-start', color: 'var(--error)' }} 
            onClick={handleLogout}
          >
            <LogOut size={20} />
            <span>Logout</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="dashboard-content">
        <div className="glass-panel" style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 className="text-3xl font-bold mb-2">Welcome back, {userName} 👋</h1>
            <p className="text-muted">Ready to learn today?</p>
          </div>
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
        </div>

        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {[
                  { title: 'Database Design Project', daysLeft: 2, course: 'CSE 202', progress: 37, urgent: true },
                  { title: 'Algorithm Challenge', daysLeft: 5, course: 'CSE 301', progress: 0, urgent: false },
                ].map((deadline, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-lg border"
                    style={{
                      background: 'var(--surface-hover)',
                      borderColor: 'var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', alignItems: 'center' }}>
                      <div>
                        <h3 className="font-semibold">{deadline.title}</h3>
                        <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>{deadline.course}</p>
                      </div>
                      <span
                        style={{
                          padding: '0.5rem 0.75rem',
                          borderRadius: '9999px',
                          fontSize: '0.75rem',
                          fontWeight: 500,
                          background: deadline.urgent ? 'rgba(255, 59, 48, 0.15)' : 'rgba(255, 193, 7, 0.15)',
                          color: deadline.urgent ? '#FF3B30' : '#FFC107',
                        }}
                      >
                        {deadline.daysLeft} days left
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ flex: 1, height: '8px', borderRadius: '9999px', background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${deadline.progress}%`,
                            height: '100%',
                            background: 'var(--primary)',
                            transition: 'width 0.3s ease'
                          }}
                        />
                      </div>
                      <span style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>{deadline.progress}%</span>
                    </div>
                  </div>
                ))}
              </div>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {[
                    { title: 'Base: Lectures', completion: 87, topic: 'Normalization' },
                    { title: 'Advanced MongoDB', completion: 30, topic: 'Indexing' },
                  ].map((test, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: '0.5rem',
                        background: 'var(--surface-hover)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        <span
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.75rem',
                            fontWeight: 'bold',
                            background: test.completion > 70 ? '#34C759' : 'var(--primary)',
                            color: 'white'
                          }}
                        >
                          {test.completion > 0 && '✓'}
                        </span>
                        <div style={{ flex: 1 }}>
                          <h3 className="font-semibold text-sm">{test.title}</h3>
                          <p style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{test.topic}</p>
                        </div>
                        <span style={{ color: 'var(--muted)', fontSize: '0.875rem', fontWeight: 500 }}>
                          {test.completion}%
                        </span>
                      </div>
                      <div style={{ height: '8px', borderRadius: '9999px', background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${test.completion}%`,
                            height: '100%',
                            background: 'var(--primary)',
                            transition: 'width 0.3s ease'
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  style={{
                    width: '100%',
                    marginTop: '1.5rem',
                    padding: '0.75rem',
                    borderRadius: '0.5rem',
                    fontWeight: 500,
                    background: 'rgba(10, 132, 255, 0.1)',
                    color: 'var(--primary)',
                    border: '1px solid var(--primary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem'
                  }}
                >
                  <Plus size={18} />
                  Start Quiz
                </button>
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
                  minHeight: '560px',
                  width: '100%',
                  borderRadius: '0.5rem',
                  padding: '0.25rem',
                  background: 'transparent',
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

              {/* Add New Todo */}
              <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.75rem' }}>
                <input
                  type="text"
                  placeholder="Add a new task..."
                  value={newTodoTitle}
                  onChange={(e) => setNewTodoTitle(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addTodo()}
                  className="glass-input"
                  style={{
                    flex: 1,
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
                    minWidth: '120px',
                  }}
                >
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
                <button
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
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                >
                  <Plus size={18} />
                  Add
                </button>
              </div>

              {/* Todo List */}
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
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = task.done
                          ? 'rgba(52, 199, 89, 0.12)'
                          : 'var(--surface-hover)';
                        e.currentTarget.style.borderColor = 'var(--primary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = task.done ? 'rgba(52, 199, 89, 0.08)' : 'var(--surface-hover)';
                        e.currentTarget.style.borderColor = task.priority === 'urgent'
                          ? 'rgba(255, 59, 48, 0.3)'
                          : task.priority === 'high'
                          ? 'rgba(255, 193, 7, 0.3)'
                          : 'var(--border)';
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
                        onMouseEnter={(e) => {
                          if (!task.done) {
                            e.currentTarget.style.borderColor = 'var(--primary)';
                            e.currentTarget.style.background = 'rgba(10, 132, 255, 0.1)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!task.done) {
                            e.currentTarget.style.borderColor = 'var(--border)';
                            e.currentTarget.style.background = 'transparent';
                          }
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
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = 'var(--error)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = 'var(--muted)';
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Progress Bar */}
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
                <label className="block text-sm font-semibold mb-3">Rubric</label>
                <textarea
                  className="glass-input"
                  style={{ width: '100%', minHeight: '100px', padding: '12px' }}
                  value={rubricText}
                  onChange={(e) => setRubricText(e.target.value)}
                  placeholder="1. Clarity (20%)&#10;2. Accuracy (50%)&#10;3. Originality (30%)"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-3">Course Key</label>
                <input
                  className="glass-input"
                  style={{ width: '100%', padding: '12px' }}
                  value={evaluationCourseKey}
                  onChange={(e) => setEvaluationCourseKey(e.target.value)}
                  placeholder="e.g., cs310-database-management-system"
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
                    <div
                      className="glass-card"
                      style={{ padding: '1.5rem' }}
                    >
                      <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                        Final Score
                      </p>
                      <p className="text-3xl font-bold" style={{ color: 'var(--primary)' }}>
                        {evaluationData.score}%
                      </p>
                    </div>
                    <div
                      className="glass-card"
                      style={{ padding: '1.5rem' }}
                    >
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

        {/* OTHER TABS */}
        {activeTab === 'learning' && (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
            <TrendingUp size={48} style={{ margin: '0 auto 1rem', color: 'var(--primary)' }} />
            <h2 className="text-2xl font-bold mb-2">Learning Path</h2>
            <p style={{ color: 'var(--muted)' }}>Your personalized learning journey coming soon</p>
          </div>
        )}

        {activeTab === 'courses' && (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
            <Book size={48} style={{ margin: '0 auto 1rem', color: 'var(--secondary)' }} />
            <h2 className="text-2xl font-bold mb-2">Course Modules</h2>
            <p style={{ color: 'var(--muted)' }}>Access course materials and modules here</p>
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
                        onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(10, 132, 255, 0.5)'}
                        onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(10, 132, 255, 0.2)'}
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
                  courseKey={feedbackList.find(f => f._id === selectedFeedback)?.courseKey}
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

