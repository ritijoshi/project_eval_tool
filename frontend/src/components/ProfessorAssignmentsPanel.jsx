import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../config/api';
import { useWebSocket } from '../hooks/useWebSocket';

const ProfessorAssignmentsPanel = () => {
  const [assignments, setAssignments] = useState([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [submissions, setSubmissions] = useState([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [newAssignment, setNewAssignment] = useState({
    title: '',
    course_key: '',
    deadlineDate: '',
    deadlineTime: '',
    description: '',
    rubric: '',
    files: [],
  });

  const [overrideDraft, setOverrideDraft] = useState({
    approved: true,
    totalScore: '',
    maxScore: 100,
    gradeLabel: '',
    feedback: '',
    summary: '',
    correctness: '',
    topicUnderstanding: '',
    completeness: '',
    technicalAccuracy: '',
  });

  const { on, off } = useWebSocket();

  const selectedSubmission = useMemo(
    () => submissions.find((item) => item._id === selectedSubmissionId) || null,
    [submissions, selectedSubmissionId]
  );

  const fetchAssignments = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const config = { headers: { Authorization: `Bearer ${token}` } };
    const res = await axios.get(`${API_BASE}/api/assignments/professor`, config);
    const list = Array.isArray(res.data?.assignments) ? res.data.assignments : [];
    setAssignments(list);
    if (!selectedAssignmentId && list.length) {
      setSelectedAssignmentId(list[0].id);
    }
  };

  const fetchSubmissions = async (assignmentId) => {
    if (!assignmentId) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    const config = { headers: { Authorization: `Bearer ${token}` } };
    const res = await axios.get(`${API_BASE}/api/assignments/${assignmentId}/submissions`, config);
    const list = Array.isArray(res.data?.submissions) ? res.data.submissions : [];
    setSubmissions(list);
    setSelectedSubmissionId(list[0]?._id || '');
  };

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        await fetchAssignments();
      } catch (err) {
        setMessage(err.response?.data?.message || 'Failed to load assignments.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (selectedAssignmentId) {
      fetchSubmissions(selectedAssignmentId).catch(() => {
        setSubmissions([]);
      });
    }
  }, [selectedAssignmentId]);

  useEffect(() => {
    const update = async () => {
      await fetchAssignments();
      if (selectedAssignmentId) {
        await fetchSubmissions(selectedAssignmentId);
      }
    };

    on('assignment-graded', update);
    on('assignment-feedback-updated', update);

    return () => {
      off('assignment-graded', update);
      off('assignment-feedback-updated', update);
    };
  }, [on, off, selectedAssignmentId]);

  const createAssignment = async () => {
    if (!newAssignment.title.trim() || !newAssignment.deadlineDate) {
      setMessage('Title and due date are required.');
      return;
    }

    const deadlineTime = newAssignment.deadlineTime || '23:59';
    const deadlineIso = new Date(`${newAssignment.deadlineDate}T${deadlineTime}`).toISOString();

    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const form = new FormData();
      form.append('title', newAssignment.title);
      form.append('course_key', newAssignment.course_key || 'general');
      form.append('deadline', deadlineIso);
      form.append('description', newAssignment.description);
      form.append('rubric', newAssignment.rubric);
      newAssignment.files.forEach((file) => form.append('files', file));

      const res = await axios.post(`${API_BASE}/api/assignments`, form, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const created = res?.data?.assignment || null;
      setNewAssignment({
        title: '',
        course_key: '',
        deadlineDate: '',
        deadlineTime: '',
        description: '',
        rubric: '',
        files: [],
      });
      setMessage('Assignment created.');

      // Immediately reflect created assignment in UI
      if (created) {
        setAssignments((prev) => [created, ...prev]);
        setSelectedAssignmentId(created.id);
      } else {
        await fetchAssignments();
      }
    } catch (err) {
      setMessage(err.response?.data?.message || 'Failed to create assignment.');
    } finally {
      setLoading(false);
    }
  };

  const applyOverride = async () => {
    if (!selectedSubmission) return;

    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const payload = {
        approved: Boolean(overrideDraft.approved),
        totalScore: overrideDraft.totalScore === '' ? undefined : Number(overrideDraft.totalScore),
        maxScore: Number(overrideDraft.maxScore || 100),
        gradeLabel: overrideDraft.gradeLabel,
        feedback: overrideDraft.feedback,
        summary: overrideDraft.summary,
        scoreBreakdown: {
          correctness: overrideDraft.correctness === '' ? undefined : Number(overrideDraft.correctness),
          topicUnderstanding: overrideDraft.topicUnderstanding === '' ? undefined : Number(overrideDraft.topicUnderstanding),
          completeness: overrideDraft.completeness === '' ? undefined : Number(overrideDraft.completeness),
          technicalAccuracy: overrideDraft.technicalAccuracy === '' ? undefined : Number(overrideDraft.technicalAccuracy),
        },
      };

      await axios.patch(`${API_BASE}/api/assignments/submissions/${selectedSubmission._id}/override`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setMessage('Professor review saved.');
      await fetchSubmissions(selectedAssignmentId);
    } catch (err) {
      setMessage(err.response?.data?.message || 'Failed to save override.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel">
      <h2 className="text-2xl font-bold mb-2">Assignment Evaluation Control</h2>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Create assignments, track AI grading, and approve or edit scores and feedback.
      </p>
      {message && <p style={{ color: 'var(--muted)', marginBottom: '0.75rem' }}>{message}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: '1rem' }}>
        <div className="glass-card" style={{ padding: '1rem' }}>
          <h3 className="font-semibold mb-2">Create Assignment</h3>
          <input className="glass-input" style={{ width: '100%', marginBottom: '0.5rem' }} placeholder="Title" value={newAssignment.title} onChange={(e) => setNewAssignment({ ...newAssignment, title: e.target.value })} />
          <div style={{ marginBottom: '0.75rem' }}>
            <input className="glass-input" style={{ width: '100%', marginBottom: '0.35rem' }} placeholder="Course key" value={newAssignment.course_key} onChange={(e) => setNewAssignment({ ...newAssignment, course_key: e.target.value })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <input
              className="glass-input"
              style={{ width: '100%' }}
              type="date"
              value={newAssignment.deadlineDate}
              onChange={(e) => setNewAssignment({ ...newAssignment, deadlineDate: e.target.value })}
            />
            <input
              className="glass-input"
              style={{ width: '100%' }}
              type="time"
              value={newAssignment.deadlineTime}
              onChange={(e) => setNewAssignment({ ...newAssignment, deadlineTime: e.target.value })}
            />
          </div>
          <textarea className="glass-input" rows="4" style={{ width: '100%', marginBottom: '0.5rem' }} placeholder="Assignment description" value={newAssignment.description} onChange={(e) => setNewAssignment({ ...newAssignment, description: e.target.value })} />
          <textarea className="glass-input" rows="4" style={{ width: '100%', marginBottom: '0.5rem' }} placeholder={"Example rubric:\n1. Clarity (20%)\n2. Technical Accuracy (50%)\n3. Completeness (30%)"} value={newAssignment.rubric} onChange={(e) => setNewAssignment({ ...newAssignment, rubric: e.target.value })} />
          <input type="file" multiple className="glass-input" style={{ width: '100%', marginBottom: '0.5rem' }} onChange={(e) => setNewAssignment({ ...newAssignment, files: Array.from(e.target.files || []) })} />
          <button className="btn-primary" disabled={loading} onClick={createAssignment}>
            Create Assignment
          </button>
        </div>

        <div className="glass-card" style={{ padding: '1rem' }}>
          <h3 className="font-semibold mb-2">Assignments</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '280px', overflow: 'auto' }}>
            {assignments.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedAssignmentId(item.id)}
                style={{
                  textAlign: 'left',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '0.6rem',
                  background: selectedAssignmentId === item.id ? 'rgba(10,132,255,0.15)' : 'var(--surface-hover)',
                  cursor: 'pointer',
                }}
              >
                <strong>{item.title}</strong>
                <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                  {item.courseKey} • {new Date(item.deadline).toLocaleString()}
                </p>
              </button>
            ))}
            {assignments.length === 0 && <p style={{ color: 'var(--muted)' }}>No assignments yet.</p>}
          </div>
        </div>
      </div>

      <div className="glass-card" style={{ padding: '1rem', marginTop: '1rem' }}>
        <h3 className="font-semibold mb-2">Submissions ({submissions.length})</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '320px', overflow: 'auto' }}>
            {submissions.map((item) => (
              <button
                key={item._id}
                onClick={() => setSelectedSubmissionId(item._id)}
                style={{
                  textAlign: 'left',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '0.6rem',
                  background: selectedSubmissionId === item._id ? 'rgba(10,132,255,0.15)' : 'var(--surface-hover)',
                  cursor: 'pointer',
                }}
              >
                <strong>{item.student?.name || 'Student'}</strong>
                <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                  {item.gradingStatus} • {item.gradingSource}
                </p>
              </button>
            ))}
            {submissions.length === 0 && <p style={{ color: 'var(--muted)' }}>No submissions yet.</p>}
          </div>

          <div>
            {!selectedSubmission ? (
              <p style={{ color: 'var(--muted)' }}>Select a submission to review.</p>
            ) : (
              <>
                <h4 className="font-semibold mb-2">AI Evaluation</h4>
                <p style={{ marginBottom: '0.35rem' }}>
                  Score: {selectedSubmission.aiEvaluation?.totalScore}/{selectedSubmission.aiEvaluation?.maxScore}
                </p>
                <p style={{ color: 'var(--muted)', marginBottom: '0.75rem' }}>{selectedSubmission.aiEvaluation?.summary}</p>

                <h4 className="font-semibold mb-2">Professor Override</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(120px, 1fr))', gap: '0.5rem' }}>
                  <input className="glass-input" placeholder="Total score" value={overrideDraft.totalScore} onChange={(e) => setOverrideDraft({ ...overrideDraft, totalScore: e.target.value })} />
                  <input className="glass-input" placeholder="Grade label" value={overrideDraft.gradeLabel} onChange={(e) => setOverrideDraft({ ...overrideDraft, gradeLabel: e.target.value })} />
                  <input className="glass-input" placeholder="Correctness" value={overrideDraft.correctness} onChange={(e) => setOverrideDraft({ ...overrideDraft, correctness: e.target.value })} />
                  <input className="glass-input" placeholder="Topic understanding" value={overrideDraft.topicUnderstanding} onChange={(e) => setOverrideDraft({ ...overrideDraft, topicUnderstanding: e.target.value })} />
                  <input className="glass-input" placeholder="Completeness" value={overrideDraft.completeness} onChange={(e) => setOverrideDraft({ ...overrideDraft, completeness: e.target.value })} />
                  <input className="glass-input" placeholder="Technical accuracy" value={overrideDraft.technicalAccuracy} onChange={(e) => setOverrideDraft({ ...overrideDraft, technicalAccuracy: e.target.value })} />
                </div>
                <textarea className="glass-input" rows="3" style={{ width: '100%', marginTop: '0.5rem' }} placeholder="Feedback" value={overrideDraft.feedback} onChange={(e) => setOverrideDraft({ ...overrideDraft, feedback: e.target.value })} />
                <textarea className="glass-input" rows="2" style={{ width: '100%', marginTop: '0.5rem' }} placeholder="Summary" value={overrideDraft.summary} onChange={(e) => setOverrideDraft({ ...overrideDraft, summary: e.target.value })} />

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', color: 'var(--muted)' }}>
                  <input type="checkbox" checked={overrideDraft.approved} onChange={(e) => setOverrideDraft({ ...overrideDraft, approved: e.target.checked })} />
                  Approve evaluation
                </label>

                <button className="btn-primary" style={{ marginTop: '0.6rem' }} onClick={applyOverride} disabled={loading}>
                  Save Professor Review
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfessorAssignmentsPanel;
