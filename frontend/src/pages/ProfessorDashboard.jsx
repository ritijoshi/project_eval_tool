import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Upload, LayoutDashboard, Target, Book, MessagesSquare, LogOut, Filter, BarChart3, TrendingUp, Sun, Moon, ChevronDown, AlertCircle, HelpCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line, ResponsiveContainer, Cell, ScatterChart, Scatter } from 'recharts';
import axios from 'axios';
import ProfessorMaterialsUploader from '../components/ProfessorMaterialsUploader';
import QuickGuide from '../components/QuickGuide';
import EvaluationReviewer from '../components/EvaluationReviewer';
import { API_BASE } from '../config/api';

const ProfessorDashboard = () => {
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState(null);
  const [filterCourse, setFilterCourse] = useState('All');
  const [filterTopic, setFilterTopic] = useState('All');
  const [filterStudent, setFilterStudent] = useState('All');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [isDark, setIsDark] = useState(true);
  const [activeTab, setActiveTab] = useState('analytics');
  const [rubrics, setRubrics] = useState([]);
  const [newRubric, setNewRubric] = useState({ name: '', courseKey: '', criteria: '', maxScore: 100 });
  const [rubricMessage, setRubricMessage] = useState('');
  const [rubricSaving, setRubricSaving] = useState(false);
  const [agentSettings, setAgentSettings] = useState({ responseStyle: 'balanced', knowledgeDepth: 'comprehensive', language: 'English' });
  const [evaluations, setEvaluations] = useState([]);
  const [selectedEvaluation, setSelectedEvaluation] = useState(null);
  const [evaluationFilter, setEvaluationFilter] = useState('pending');
  const [weeklyUpdateForm, setWeeklyUpdateForm] = useState({
    courseKey: '',
    weekLabel: '',
    newTopics: '',
    announcements: '',
    revisedExpectations: '',
    updateText: '',
  });
  const [weeklyUpdateHistory, setWeeklyUpdateHistory] = useState([]);
  const [weeklyUpdateMessage, setWeeklyUpdateMessage] = useState('');
  const [weeklyUpdateSaving, setWeeklyUpdateSaving] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setIsDark(savedTheme === 'dark');
    document.documentElement.setAttribute('data-theme', savedTheme);
      
    const fetchAnalytics = async () => {
      try {
        const token = localStorage.getItem('token');
        const config = { headers: { Authorization: `Bearer ${token}` } };
        const res = await axios.get(`${API_BASE}/api/professor/analytics`, config);
        setAnalytics(res.data);
      } catch (err) {
        console.error("Failed to fetch analytics", err);
      }
    };
    const fetchRubrics = async () => {
      try {
        const token = localStorage.getItem('token');
        const config = { headers: { Authorization: `Bearer ${token}` } };
        const res = await axios.get(`${API_BASE}/api/professor/rubrics`, config);
        setRubrics(Array.isArray(res.data?.rubrics) ? res.data.rubrics : []);
      } catch (err) {
        setRubrics([]);
      }
    };

    const fetchWeeklyUpdates = async () => {
      try {
        const token = localStorage.getItem('token');
        const config = { headers: { Authorization: `Bearer ${token}` } };
        const res = await axios.get(`${API_BASE}/api/professor/weekly-updates?limit=8`, config);
        setWeeklyUpdateHistory(Array.isArray(res.data?.updates) ? res.data.updates : []);
      } catch (err) {
        setWeeklyUpdateHistory([]);
      }
    };

    fetchAnalytics();
    fetchRubrics();
    fetchWeeklyUpdates();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const fetchEvaluations = async (status = 'pending') => {
    try {
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.get(`${API_BASE}/api/feedback/evaluations?status=${status}`, config);
      const normalizedEvaluations = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.evaluations)
          ? res.data.evaluations
          : [];

      setEvaluations(normalizedEvaluations);
      setSelectedEvaluation(null);
    } catch (err) {
      console.error("Failed to fetch evaluations", err);
      setEvaluations([]);
    }
  };

  const saveRubric = async () => {
    if (!newRubric.name.trim() || !newRubric.criteria.trim() || !newRubric.courseKey.trim()) {
      setRubricMessage('Please provide course key, rubric name, and criteria.');
      return;
    }

    try {
      setRubricSaving(true);
      setRubricMessage('');
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };

      await axios.post(
        `${API_BASE}/api/professor/rubrics`,
        {
          name: newRubric.name,
          course_key: newRubric.courseKey,
          criteriaList: newRubric.criteria,
          maxScore: newRubric.maxScore,
        },
        config
      );

      const listRes = await axios.get(`${API_BASE}/api/professor/rubrics`, config);
      setRubrics(Array.isArray(listRes.data?.rubrics) ? listRes.data.rubrics : []);
      setNewRubric({ name: '', courseKey: newRubric.courseKey, criteria: '', maxScore: 100 });
      setRubricMessage('Rubric saved.');
    } catch (err) {
      setRubricMessage(err.response?.data?.message || 'Failed to save rubric.');
    } finally {
      setRubricSaving(false);
    }
  };

  const submitWeeklyUpdate = async () => {
    if (!weeklyUpdateForm.courseKey.trim()) {
      setWeeklyUpdateMessage('Course key is required for weekly updates.');
      return;
    }

    if (!weeklyUpdateForm.newTopics.trim() && !weeklyUpdateForm.announcements.trim() && !weeklyUpdateForm.revisedExpectations.trim() && !weeklyUpdateForm.updateText.trim()) {
      setWeeklyUpdateMessage('Please add at least one update item.');
      return;
    }

    try {
      setWeeklyUpdateSaving(true);
      setWeeklyUpdateMessage('');
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };

      await axios.post(
        `${API_BASE}/api/professor/weekly-updates`,
        {
          course_key: weeklyUpdateForm.courseKey,
          week_label: weeklyUpdateForm.weekLabel,
          new_topics: weeklyUpdateForm.newTopics,
          announcements: weeklyUpdateForm.announcements,
          revised_expectations: weeklyUpdateForm.revisedExpectations,
          update_text: weeklyUpdateForm.updateText,
        },
        config
      );

      const listRes = await axios.get(`${API_BASE}/api/professor/weekly-updates?limit=8`, config);
      setWeeklyUpdateHistory(Array.isArray(listRes.data?.updates) ? listRes.data.updates : []);
      setWeeklyUpdateMessage('Weekly update published and knowledge base refreshed.');
      setWeeklyUpdateForm((prev) => ({
        ...prev,
        weekLabel: '',
        newTopics: '',
        announcements: '',
        revisedExpectations: '',
        updateText: '',
      }));
    } catch (err) {
      setWeeklyUpdateMessage(err.response?.data?.message || 'Failed to publish weekly update.');
    } finally {
      setWeeklyUpdateSaving(false);
    }
  };

  const COLORS = ['#0A84FF', '#2D1B4E', '#5E35B1', '#00B0FF'];
  const professorName = JSON.parse(localStorage.getItem('user') || '{}').name || 'Professor';
  const leaderboardRows = (analytics?.students || [])
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .map((row, idx) => ({ ...row, rank: idx + 1 }));

  return (
    <div className="dashboard-layout">
      {/* Sidebar */}
      <div className="prof-sidebar hidden md:flex">
        <div className="prof-sidebar-inner">
          <div className="prof-logo-wrap">
            <div className="prof-logo-badge">
              <Book className="text-secondary" size={20} />
            </div>
            <div>
              <h2 className="prof-logo-text">EduAgent</h2>
              <p className="prof-logo-sub">Faculty Portal</p>
            </div>
          </div>
          
          <nav className="prof-nav">
            <button 
              className={`prof-nav-btn ${activeTab === 'analytics' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              <BarChart3 size={18} />
              <span>Analytics & Insights</span>
            </button>
            <button 
              className={`prof-nav-btn ${activeTab === 'materials' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('materials')}
            >
              <Upload size={18} />
              <span>Material Ingestion</span>
            </button>
            <button 
              className={`prof-nav-btn ${activeTab === 'rubrics' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('rubrics')}
            >
              <Target size={18} />
              <span>Rubric Builder</span>
            </button>
            <button 
              className={`prof-nav-btn ${activeTab === 'agent' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('agent')}
            >
              <MessagesSquare size={18} />
              <span>Agent Console</span>
            </button>
            <button 
              className={`prof-nav-btn ${activeTab === 'evaluations' ? 'is-active' : ''}`}
              onClick={() => {
                setActiveTab('evaluations');
                fetchEvaluations(evaluationFilter);
              }}
            >
              <BarChart3 size={18} />
              <span>Student Evaluations</span>
            </button>
          </nav>

          <div className="prof-sidebar-footer">
            <button 
              className="prof-nav-footer-btn"
              onClick={() => {
                const newTheme = isDark ? 'light' : 'dark';
                setIsDark(!isDark);
                document.documentElement.setAttribute('data-theme', newTheme);
                localStorage.setItem('theme', newTheme);
              }}
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
              <span>{isDark ? 'Light' : 'Dark'}</span>
            </button>
            <button className="prof-nav-footer-btn logout" onClick={handleLogout}>
              <LogOut size={16} />
              <span>Exit</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="prof-main">
        <header className="prof-header">
          <div>
            <h1 className="prof-title">Intelligence Hub</h1>
            <p className="prof-subtitle">Welcome back, {professorName}</p>
          </div>
          
          <div className="prof-filters">
            <div className="prof-filter-group">
              <Filter size={13} />
              <select 
                value={filterCourse} 
                onChange={(e) => setFilterCourse(e.target.value)} 
                className="prof-select"
              >
                <option>All Courses</option>
                <option>CS501</option>
              </select>
            </div>
            <div className="prof-filter-group">
              <Filter size={13} />
              <select 
                value={filterStudent} 
                onChange={(e) => setFilterStudent(e.target.value)} 
                className="prof-select"
              >
                <option>All Students</option>
                {analytics?.students?.map((s) => (<option key={s.id}>{s.name}</option>))}
              </select>
            </div>
            <div className="prof-filter-group">
              <Filter size={13} />
              <select 
                value={filterTopic} 
                onChange={(e) => setFilterTopic(e.target.value)} 
                className="prof-select"
              >
                <option>All Topics</option>
                {analytics?.topicPerformance?.map((t) => (<option key={t.topic}>{t.topic}</option>))}
              </select>
            </div>
          </div>
        </header>

        <div className="prof-tabs" role="tablist">
          <button
            type="button"
            className={`prof-tab ${activeTab === 'analytics' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            <BarChart3 size={16} />
            Analytics & Insights
          </button>
          <button
            type="button"
            className={`prof-tab ${activeTab === 'materials' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('materials')}
          >
            <Upload size={16} />
            Material Ingestion
          </button>
          <button
            type="button"
            className={`prof-tab ${activeTab === 'rubrics' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('rubrics')}
          >
            <Target size={16} />
            Rubric Builder
          </button>
          <button
            type="button"
            className={`prof-tab ${activeTab === 'agent' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('agent')}
          >
            <MessagesSquare size={16} />
            Agent Console
          </button>
          <button
            type="button"
            className={`prof-tab ${activeTab === 'evaluations' ? 'is-active' : ''}`}
            onClick={() => {
              setActiveTab('evaluations');
              fetchEvaluations(evaluationFilter);
            }}
          >
            <BarChart3 size={16} />
            Student Evaluations
          </button>
          <button
            type="button"
            className={`prof-tab ${activeTab === 'guide' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('guide')}
          >
            <HelpCircle size={16} />
            Quick Guide
          </button>
        </div>

        {activeTab === 'analytics' ? (
          analytics ? (
            <>
            <div className="prof-stats-grid">
                <div className="prof-stat-card">
                    <div className="prof-stat-header">
                        <Users size={20} className="text-primary" />
                        <p className="prof-stat-label">Active Students</p>
                    </div>
                    <h2 className="prof-stat-value">{analytics.overview.totalStudents}</h2>
                    <p className="prof-stat-detail">Currently enrolled</p>
                </div>
                <div className="prof-stat-card">
                    <div className="prof-stat-header">
                        <Target size={20} className="text-secondary" />
                        <p className="prof-stat-label">Average Score</p>
                    </div>
                    <h2 className="prof-stat-value">{analytics.overview.avgScore}%</h2>
                    <p className="prof-stat-detail">{analytics.overview.avgScore > 75 ? '✓ Exceeding' : analytics.overview.avgScore > 60 ? '⚠ Meeting' : '✗ Below'} target</p>
                </div>
                <div className="prof-stat-card">
                    <div className="prof-stat-header">
                        <TrendingUp size={20} className="text-primary" />
                        <p className="prof-stat-label">Active Projects</p>
                    </div>
                    <h2 className="prof-stat-value">{analytics.overview.activeProjects}</h2>
                    <p className="prof-stat-detail">In progress</p>
                </div>
            </div>

            <div className="prof-charts-grid">
              {/* Line Chart: Class Progress Trend */}
              <div className="prof-chart-panel">
                <div className="prof-chart-header">
                  <div>
                    <h3 className="prof-chart-title">Class Progress Trend</h3>
                    <p className="prof-chart-desc">Weekly performance tracking</p>
                  </div>
                  <TrendingUp size={18} className="text-primary" />
                </div>
                <div style={{ width: '100%', height: 280 }}>
                  <ResponsiveContainer>
                    <LineChart data={analytics.progressTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2D1B4E" vertical={false} />
                      <XAxis dataKey="week" stroke="#888" tick={{fill: '#888'}} />
                      <YAxis stroke="#888" tick={{fill: '#888'}} domain={[0, 100]} />
                      <Tooltip contentStyle={{ backgroundColor: '#1A1A2E', borderColor: '#2D1B4E', borderRadius: '8px' }} />
                      <Line type="monotone" dataKey="progress" stroke="#0A84FF" strokeWidth={3} dot={{ r: 4, fill: '#0A84FF' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Bar Chart: Topic Performance */}
              <div className="prof-chart-panel">
                <div className="prof-chart-header">
                  <div>
                    <h3 className="prof-chart-title">Topic Performance</h3>
                    <p className="prof-chart-desc">Average scores by subject</p>
                  </div>
                  <Target size={18} className="text-secondary" />
                </div>
                <div style={{ width: '100%', height: 280 }}>
                  <ResponsiveContainer>
                    <BarChart data={analytics.topicPerformance || []} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2D1B4E" horizontal={true} vertical={false} />
                      <XAxis dataKey="topic" stroke="#888" angle={-45} textAnchor="end" height={80} />
                      <YAxis stroke="#888" tick={{fill: '#888'}} />
                      <Tooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} contentStyle={{ backgroundColor: '#1A1A2E', borderColor: '#2D1B4E', borderRadius: '8px' }} />
                      <Bar dataKey="avgScore" radius={[4, 4, 0, 0]} fill="#0A84FF" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="prof-charts-grid">
              <div className="prof-chart-panel">
                <div className="prof-chart-header">
                  <div>
                    <h3 className="prof-chart-title">Weak Areas Density</h3>
                    <p className="prof-chart-desc">Topics needing attention</p>
                  </div>
                  <AlertCircle size={18} style={{ color: '#FF6B6B' }} />
                </div>
                <div style={{ width: '100%', height: 280 }}>
                  <ResponsiveContainer>
                    <BarChart data={analytics.weakAreas} layout="vertical" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2D1B4E" horizontal={false} />
                      <XAxis type="number" stroke="#888" />
                      <YAxis dataKey="topic" type="category" stroke="#888" width={90} />
                      <Tooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} contentStyle={{ backgroundColor: '#1A1A2E', borderColor: '#2D1B4E', borderRadius: '8px' }} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="#FF6B6B" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Score Distribution */}
              <div className="prof-chart-panel">
                <div className="prof-chart-header">
                  <div>
                    <h3 className="prof-chart-title">Score Distribution</h3>
                    <p className="prof-chart-desc">Student performance breakdown</p>
                  </div>
                  <BarChart3 size={18} className="text-primary" />
                </div>
                <div className="prof-distribution">
                  {[
                    { label: 'Excellent (90+)', color: 'bg-green-500', count: analytics.students?.filter(s => s.score >= 90).length || 0 },
                    { label: 'Good (80-89)', color: 'bg-blue-500', count: analytics.students?.filter(s => s.score >= 80 && s.score < 90).length || 0 },
                    { label: 'Average (70-79)', color: 'bg-yellow-500', count: analytics.students?.filter(s => s.score >= 70 && s.score < 80).length || 0 },
                    { label: 'Below Average (<70)', color: 'bg-red-500', count: analytics.students?.filter(s => s.score < 70).length || 0 },
                  ].map((range) => (
                    <div key={range.label} className="prof-distribution-item">
                      <div className="prof-distribution-label">
                        <span>{range.label}</span>
                        <span className="prof-distribution-count">{range.count}</span>
                      </div>
                      <div className="prof-distribution-bar">
                        <div className={`h-full ${range.color}`} style={{ width: `${(range.count / (analytics.overview.totalStudents || 1)) * 100}%`, borderRadius: '6px' }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Selected Student Detail View */}
            {selectedStudent && (
              <div className="prof-student-detail">
                <div className="prof-student-detail-header">
                  <h3 className="prof-student-detail-title">Student Profile: {selectedStudent.name}</h3>
                  <button onClick={() => setSelectedStudent(null)} className="prof-student-detail-close">✕</button>
                </div>
                <div className="prof-student-metrics">
                  <div className="prof-student-metric">
                    <p className="prof-student-metric-label">Overall Score</p>
                    <p className="prof-student-metric-value">{selectedStudent.score}%</p>
                  </div>
                  <div className="prof-student-metric">
                    <p className="prof-student-metric-label">Progress</p>
                    <p className="prof-student-metric-value">{Math.round(selectedStudent.progress)}%</p>
                  </div>
                  <div className="prof-student-metric">
                    <p className="prof-student-metric-label">Interactions</p>
                    <p className="prof-student-metric-value">{selectedStudent.interactionCount || 0}</p>
                  </div>
                  <div className="prof-student-metric">
                    <p className="prof-student-metric-label">Weak Areas</p>
                    <p className="prof-student-metric-value">{selectedStudent.weakAreas?.length || 0}</p>
                  </div>
                </div>
                {selectedStudent.weakAreas && selectedStudent.weakAreas.length > 0 && (
                  <div className="prof-student-weak-areas">
                    <p className="prof-student-weak-title">Topics Needing Attention</p>
                    <div className="prof-student-weak-tags">
                      {selectedStudent.weakAreas.map((area, idx) => (
                        <span key={idx} className="prof-student-weak-tag">{area}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Student Performance Table */}
            {/* Student Performance Table */}
            <div className="prof-table-panel">
              <h3 className="prof-table-header">Leaderboard</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '1rem' }}>
                {leaderboardRows.slice(0, 5).map((entry) => (
                  <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '56px 1fr 100px', alignItems: 'center', padding: '0.65rem 0.75rem', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--surface-hover)' }}>
                    <strong style={{ color: entry.rank <= 3 ? 'var(--primary)' : 'var(--text-main)' }}>#{entry.rank}</strong>
                    <span>{entry.name}</span>
                    <span>{entry.score}%</span>
                  </div>
                ))}
              </div>

              <h3 className="prof-table-header">Student Performance Overview</h3>
              <div className="prof-table-wrapper">
                <table className="prof-table">
                  <thead>
                    <tr className="prof-table-header-row">
                      <th className="prof-table-cell">Student Name</th>
                      <th className="prof-table-cell">Score</th>
                      <th className="prof-table-cell">Progress</th>
                      <th className="prof-table-cell">Interactions</th>
                      <th className="prof-table-cell">Status</th>
                      <th className="prof-table-cell">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.students.map((student) => (
                      <tr key={student.id} className="prof-table-body-row">
                        <td className="prof-table-cell prof-table-name">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-xs font-bold">
                              {student.name.charAt(0)}
                            </div>
                            <span>{student.name}</span>
                          </div>
                        </td>
                        <td className="prof-table-cell">
                          <span className="prof-score-badge" style={{
                            background: student.score >= 80 ? 'rgba(34, 197, 94, 0.1)' : student.score >= 60 ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                            color: student.score >= 80 ? '#22c55e' : student.score >= 60 ? '#3b82f6' : '#ef4444'
                          }}>
                            {student.score}%
                          </span>
                        </td>
                        <td className="prof-table-cell">
                          <div className="prof-progress-bar">
                            <div className="prof-progress-fill" style={{width: `${student.progress}%`}}></div>
                          </div>
                          <span className="prof-progress-text">{Math.round(student.progress)}%</span>
                        </td>
                        <td className="prof-table-cell">{student.interactionCount || 0}</td>
                        <td className="prof-table-cell">
                          <span className={`prof-status-badge prof-status-${student.score >= 80 ? 'excellent' : student.score >= 60 ? 'good' : 'needs-help'}`}>
                            {student.score >= 80 ? 'Excellent' : student.score >= 60 ? 'Good' : 'Needs Help'}
                          </span>
                        </td>
                        <td className="prof-table-cell">
                          <button 
                            onClick={() => setSelectedStudent(student)}
                            className="prof-table-action"
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            
          </>
          ) : (
            <div className="flex items-center justify-center h-64">
               <div className="w-8 h-8 rounded-full border-r-2 border-primary animate-spin"></div>
            </div>
          )
        ) : activeTab === 'materials' ? (
          <ProfessorMaterialsUploader />
        ) : activeTab === 'rubrics' ? (
          <div className="prof-rubric-builder">
            <div className="prof-rubric-container">
              <div className="prof-rubric-panel">
                <h2 className="prof-rubric-title">Create New Rubric</h2>
                <div className="prof-rubric-form">
                  <div className="prof-form-group">
                    <label className="prof-form-label">Rubric Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g., Project Evaluation Rubric" 
                      value={newRubric.name}
                      onChange={(e) => setNewRubric({...newRubric, name: e.target.value})}
                      className="glass-input"
                    />
                  </div>
                  <div className="prof-form-group">
                    <label className="prof-form-label">Course Key</label>
                    <input
                      type="text"
                      placeholder="e.g., cs310-database-management-system"
                      value={newRubric.courseKey}
                      onChange={(e) => setNewRubric({...newRubric, courseKey: e.target.value})}
                      className="glass-input"
                    />
                  </div>
                  <div className="prof-form-group">
                    <label className="prof-form-label">Evaluation Criteria</label>
                    <textarea 
                      placeholder="Define your grading criteria (e.g., Code Quality: 30%, Functionality: 40%, Documentation: 30%)" 
                      value={newRubric.criteria}
                      onChange={(e) => setNewRubric({...newRubric, criteria: e.target.value})}
                      className="glass-input prof-textarea"
                      rows="6"
                    />
                  </div>
                  <div className="prof-form-group">
                    <label className="prof-form-label">Maximum Score</label>
                    <input 
                      type="number" 
                      min="10" 
                      max="200" 
                      value={newRubric.maxScore}
                      onChange={(e) => setNewRubric({...newRubric, maxScore: parseInt(e.target.value)})}
                      className="glass-input"
                    />
                  </div>
                  <button 
                    onClick={saveRubric}
                    className="btn-primary"
                    style={{width: '100%', marginTop: '10px', opacity: rubricSaving ? 0.7 : 1}}
                    disabled={rubricSaving}
                  >
                    {rubricSaving ? 'Saving...' : 'Save Rubric'}
                  </button>
                  {rubricMessage && <p style={{ marginTop: '10px', color: 'var(--muted)', fontSize: '0.9rem' }}>{rubricMessage}</p>}
                </div>
              </div>

              <div className="prof-rubric-list">
                <h2 className="prof-rubric-title">Your Rubrics ({rubrics.length})</h2>
                {rubrics.length === 0 ? (
                  <div className="prof-empty-state">
                    <Target size={48} style={{color: 'var(--muted)', opacity: 0.4}}/>
                    <p>No rubrics created yet. Start by creating your first rubric above.</p>
                  </div>
                ) : (
                  <div className="prof-rubric-items">
                    {rubrics.map((rubric) => (
                      <div key={rubric._id || rubric.id} className="prof-rubric-item">
                        <div className="prof-rubric-item-header">
                          <h3 className="prof-rubric-item-name">{rubric.name}</h3>
                          <span className="prof-rubric-score">{rubric.courseKey || 'general'} • Max: {rubric.maxScore}</span>
                        </div>
                        <p className="prof-rubric-item-criteria">
                          {Array.isArray(rubric.criteria)
                            ? rubric.criteria.map((c) => `${c.title} (${c.weight}%)`).join(', ')
                            : rubric.criteria}
                        </p>
                        <div className="prof-rubric-item-actions">
                          <button className="prof-btn-small">Edit</button>
                          <button className="prof-btn-small prof-btn-danger" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>Delete (soon)</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'agent' ? (
          <div className="prof-agent-console">
            <div className="prof-agent-container">
              <div className="prof-agent-settings">
                <h2 className="prof-agent-title">Agent Configuration</h2>
                <p className="prof-agent-subtitle">Customize how the AI Course Agent responds to your students</p>
                
                <div className="prof-agent-settings-grid">
                  <div className="prof-agent-setting">
                    <label className="prof-setting-label">Response Style</label>
                    <div className="prof-setting-options">
                      {['Concise', 'Balanced', 'Detailed'].map((style) => (
                        <button
                          key={style}
                          className={`prof-setting-option ${agentSettings.responseStyle === style.toLowerCase() ? 'is-active' : ''}`}
                          onClick={() => setAgentSettings({...agentSettings, responseStyle: style.toLowerCase()})}
                        >
                          {style}
                        </button>
                      ))}
                    </div>
                    <p className="prof-setting-hint">Choose how detailed the AI's responses should be</p>
                  </div>

                  <div className="prof-agent-setting">
                    <label className="prof-setting-label">Knowledge Depth</label>
                    <div className="prof-setting-options">
                      {['Basic', 'Comprehensive', 'Advanced'].map((depth) => (
                        <button
                          key={depth}
                          className={`prof-setting-option ${agentSettings.knowledgeDepth === depth.toLowerCase() ? 'is-active' : ''}`}
                          onClick={() => setAgentSettings({...agentSettings, knowledgeDepth: depth.toLowerCase()})}
                        >
                          {depth}
                        </button>
                      ))}
                    </div>
                    <p className="prof-setting-hint">Set the complexity level of explanations</p>
                  </div>

                  <div className="prof-agent-setting">
                    <label className="prof-setting-label">Language</label>
                    <select 
                      value={agentSettings.language}
                      onChange={(e) => setAgentSettings({...agentSettings, language: e.target.value})}
                      className="glass-input"
                    >
                      <option>English</option>
                      <option>Spanish</option>
                      <option>French</option>
                      <option>German</option>
                      <option>Mandarin</option>
                    </select>
                    <p className="prof-setting-hint">Select the language for AI responses</p>
                  </div>
                </div>

                <button className="btn-primary" style={{marginTop: '20px', width: '100%'}}>
                  Apply Settings
                </button>
              </div>

              <div className="prof-agent-preview">
                <h2 className="prof-agent-title">Configuration Summary</h2>
                <div className="prof-agent-summary">
                  <div className="prof-summary-item">
                    <span className="prof-summary-label">Response Style:</span>
                    <span className="prof-summary-value">{agentSettings.responseStyle.charAt(0).toUpperCase() + agentSettings.responseStyle.slice(1)}</span>
                  </div>
                  <div className="prof-summary-item">
                    <span className="prof-summary-label">Knowledge Depth:</span>
                    <span className="prof-summary-value">{agentSettings.knowledgeDepth.charAt(0).toUpperCase() + agentSettings.knowledgeDepth.slice(1)}</span>
                  </div>
                  <div className="prof-summary-item">
                    <span className="prof-summary-label">Language:</span>
                    <span className="prof-summary-value">{agentSettings.language}</span>
                  </div>
                </div>
                <p className="prof-agent-note">These settings will apply to all student interactions with your course materials.</p>
              </div>
            </div>

            <div className="glass-panel" style={{ marginTop: '1.5rem' }}>
              <h2 className="text-xl font-bold mb-2">Weekly Agent Update</h2>
              <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
                Publish weekly topics, announcements, and revised expectations. This updates the agent knowledge base and notifies students.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                <input
                  className="glass-input"
                  placeholder="Course key"
                  value={weeklyUpdateForm.courseKey}
                  onChange={(e) => setWeeklyUpdateForm({ ...weeklyUpdateForm, courseKey: e.target.value })}
                />
                <input
                  className="glass-input"
                  placeholder="Week label (e.g., Week 4)"
                  value={weeklyUpdateForm.weekLabel}
                  onChange={(e) => setWeeklyUpdateForm({ ...weeklyUpdateForm, weekLabel: e.target.value })}
                />
              </div>

              <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                <textarea
                  className="glass-input"
                  rows="4"
                  placeholder="New topics (one per line)"
                  value={weeklyUpdateForm.newTopics}
                  onChange={(e) => setWeeklyUpdateForm({ ...weeklyUpdateForm, newTopics: e.target.value })}
                />
                <textarea
                  className="glass-input"
                  rows="4"
                  placeholder="Announcements (one per line)"
                  value={weeklyUpdateForm.announcements}
                  onChange={(e) => setWeeklyUpdateForm({ ...weeklyUpdateForm, announcements: e.target.value })}
                />
              </div>

              <textarea
                className="glass-input"
                rows="4"
                style={{ marginTop: '1rem', width: '100%' }}
                placeholder="Revised expectations (one per line)"
                value={weeklyUpdateForm.revisedExpectations}
                onChange={(e) => setWeeklyUpdateForm({ ...weeklyUpdateForm, revisedExpectations: e.target.value })}
              />

              <textarea
                className="glass-input"
                rows="4"
                style={{ marginTop: '1rem', width: '100%' }}
                placeholder="Additional update notes"
                value={weeklyUpdateForm.updateText}
                onChange={(e) => setWeeklyUpdateForm({ ...weeklyUpdateForm, updateText: e.target.value })}
              />

              <button
                className="btn-primary"
                style={{ marginTop: '1rem', width: '100%', opacity: weeklyUpdateSaving ? 0.7 : 1 }}
                onClick={submitWeeklyUpdate}
                disabled={weeklyUpdateSaving}
              >
                {weeklyUpdateSaving ? 'Publishing...' : 'Publish Weekly Update'}
              </button>

              {weeklyUpdateMessage && (
                <p style={{ marginTop: '0.75rem', color: 'var(--muted)' }}>{weeklyUpdateMessage}</p>
              )}

              {weeklyUpdateHistory.length > 0 && (
                <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                  <h3 className="font-semibold mb-2">Recent Updates</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {weeklyUpdateHistory.map((item) => (
                      <div key={item._id} style={{ padding: '0.75rem', border: '1px solid var(--border)', borderRadius: '10px', background: 'var(--surface-hover)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                          <strong>{item.weekLabel || 'Weekly Update'}</strong>
                          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{item.courseKey}</span>
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                          {new Date(item.createdAt).toLocaleString()} • {item.embedded ? 'Ingested' : 'Stored'} • Chunks: {item.chunksAdded || 0}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'evaluations' ? (
          <div>
            {!selectedEvaluation ? (
              <div className="glass-panel">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                  <div>
                    <h2 className="text-2xl font-bold mb-2">Student Evaluations</h2>
                    <p style={{ color: 'var(--muted)' }}>Review AI evaluations and provide manual feedback</p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {['pending', 'reviewed', 'awaiting_response', 'resolved'].map((status) => (
                      <button
                        key={status}
                        onClick={() => {
                          setEvaluationFilter(status);
                          fetchEvaluations(status);
                        }}
                        style={{
                          padding: '0.5rem 1rem',
                          borderRadius: '8px',
                          border: '1px solid',
                          background: evaluationFilter === status ? 'rgba(10, 132, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                          borderColor: evaluationFilter === status ? 'rgba(10, 132, 255, 0.5)' : 'rgba(10, 132, 255, 0.2)',
                          color: 'var(--text-main)',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          textTransform: 'capitalize',
                          transition: 'all 0.25s ease'
                        }}
                      >
                        {status.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>

                {evaluations.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
                    <BarChart3 size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
                    <p>No evaluations in {evaluationFilter} status</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {evaluations.map((evaluation) => (
                      <div
                        key={evaluation._id}
                        onClick={() => setSelectedEvaluation(evaluation._id)}
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
                            <h3 className="font-semibold text-lg">{evaluation.student?.name || 'Student'}</h3>
                            <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                              {evaluation.courseKey} • AI Score: {evaluation.aiEvaluation?.score}%
                            </p>
                          </div>
                          <span style={{
                            padding: '0.5rem 0.75rem',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            background: evaluation.status === 'pending' ? 'rgba(255, 165, 0, 0.15)' :
                                        evaluation.status === 'reviewed' ? 'rgba(10, 132, 255, 0.15)' :
                                        evaluation.status === 'awaiting_response' ? 'rgba(255, 193, 7, 0.15)' :
                                        'rgba(52, 199, 89, 0.15)',
                            color: evaluation.status === 'pending' ? '#FFA500' :
                                   evaluation.status === 'reviewed' ? '#0A84FF' :
                                   evaluation.status === 'awaiting_response' ? '#FFC107' :
                                   '#34C759'
                          }}>
                            {evaluation.status.replace('_', ' ').toUpperCase()}
                          </span>
                        </div>
                        {evaluation.aiEvaluation?.feedback && (
                          <p style={{ fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '1rem' }}>
                            {evaluation.aiEvaluation.feedback.substring(0, 120)}...
                          </p>
                        )}
                        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: 'var(--muted)' }}>
                          {evaluation.studentResponses?.length > 0 && (
                            <span>💬 {evaluation.studentResponses.length} response{evaluation.studentResponses.length !== 1 ? 's' : ''}</span>
                          )}
                          <span style={{ marginLeft: 'auto' }}>→</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <button
                  onClick={() => setSelectedEvaluation(null)}
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
                  ← Back to Evaluations
                </button>
                <EvaluationReviewer feedbackId={selectedEvaluation} />
              </div>
            )}
          </div>
        ) : activeTab === 'guide' ? (
          <div className="prof-guide-section">
            <QuickGuide role="professor" />
          </div>
        ) : (
          <ProfessorMaterialsUploader />
        )}

      </div>
    </div>
  );
};

export default ProfessorDashboard;
