import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../../config/api';

const AssignmentEvaluation = () => {
  const [courses, setCourses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [assignmentId, setAssignmentId] = useState('');
  const [sessionLabel, setSessionLabel] = useState('');
  const [assignmentType, setAssignmentType] = useState('text');
  const [rubricFile, setRubricFile] = useState(null);
  const [submissionsZip, setSubmissionsZip] = useState(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [sessionId, setSessionId] = useState('');
  const [sessionInfo, setSessionInfo] = useState(null);
  const [results, setResults] = useState([]);

  const normalizeCriterionScore = (score, maxScore) => {
    const numericScore = Number(score ?? 0);
    const numericMax = Number(maxScore ?? 0);

    if (!Number.isFinite(numericScore)) return '—';
    if (numericMax > 0) return Number(((numericScore / numericMax) * 10).toFixed(1));
    if (numericScore <= 10) return Number(numericScore.toFixed(1));
    return Number(numericScore.toFixed(1));
  };

  const getCriterionScore = (result, names) => {
    const breakdown = result?.scoreBreakdown || {};
    const matchingEntry = Object.entries(breakdown).find(([key]) => names.some((name) => key.toLowerCase() === name.toLowerCase()));

    if (!matchingEntry) return '—';

    const [, criterion] = matchingEntry;
    const score = normalizeCriterionScore(criterion?.score, criterion?.maxScore);
    return score === '—' ? '—' : score;
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

  const criterionNames = Array.from(
    new Set(results.flatMap((result) => Object.keys(result?.scoreBreakdown || {})))
  );

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const token = localStorage.getItem('token');
        const config = { headers: { Authorization: `Bearer ${token}` } };
        const res = await axios.get(`${API_BASE}/api/professor/courses`, config);
        const list = Array.isArray(res.data?.records) ? res.data.records : [];
        setCourses(list);

        if (list.length > 0) {
          const firstCourse = list[0];
          const nextCourseId = firstCourse._id || firstCourse.id || '';
          setCourseId(nextCourseId);
        }
      } catch (error) {
        setCourses([]);
        setStatus('Could not load professor courses.');
      } finally {
        setLoadingMeta(false);
      }
    };

    fetchCourses();
  }, []);

  useEffect(() => {
    if (!courseId) {
      setAssignments([]);
      setAssignmentId('');
      return;
    }

    const fetchAssignments = async () => {
      try {
        const token = localStorage.getItem('token');
        const config = { headers: { Authorization: `Bearer ${token}` } };
        const res = await axios.get(`${API_BASE}/api/professor/assignments?courseId=${courseId}`, config);
        const list = Array.isArray(res.data?.assignments) ? res.data.assignments : [];
        setAssignments(list);

        if (list.length > 0) {
          const firstAssignment = list[0];
          setAssignmentId(firstAssignment._id || firstAssignment.id || '');
        } else {
          setAssignmentId('');
        }
      } catch (error) {
        setAssignments([]);
        setAssignmentId('');
      }
    };

    fetchAssignments();
  }, [courseId]);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    const pollSession = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/api/assignment-eval/${sessionId}/results`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.message || 'Could not load evaluation results.');
        }

        if (!cancelled) {
          setSessionInfo(data.session || null);
          setResults(Array.isArray(data.results) ? data.results : []);
          setStatus(
            data.session?.status
              ? `Session status: ${data.session.status} (${data.session.processedStudents || 0}/${data.session.totalStudents || 0} students)`
              : 'Evaluation started.'
          );
        }

        const finalStates = ['COMPLETED', 'FAILED'];
        if (!cancelled && data.session && finalStates.includes(data.session.status)) {
          return true;
        }
        return false;
      } catch (error) {
        if (!cancelled) {
          setStatus(error.message || 'Could not fetch session results.');
        }
        return true;
      }
    };

    const loop = async () => {
      const done = await pollSession();
      if (done) return;

      const timer = setTimeout(loop, 4000);
      return () => clearTimeout(timer);
    };

    const timer = setTimeout(loop, 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!courseId || !assignmentId) {
      setStatus('Please select a valid course and assignment before starting evaluation.');
      return;
    }
    if (!rubricFile || !submissionsZip) {
      setStatus('Please select both a rubric file and a ZIP file.');
      return;
    }

    setLoading(true);
    setStatus('Preparing assignment evaluation...');
    setResults([]);
    setSessionInfo(null);

    try {
      const formData = new FormData();
      formData.append('courseId', courseId);
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
      if (!res.ok) {
        throw new Error(data?.message || 'Could not start assignment evaluation.');
      }

      setSessionId(data.sessionId);
      setStatus(`Evaluation started. Session ID: ${data.sessionId}`);
    } catch (error) {
      setStatus(error.message || 'Assignment evaluation failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: '2rem auto', padding: '1.5rem', borderRadius: 16, background: 'rgba(17,24,39,0.8)', color: '#f3f4f6' }}>
      <h2 style={{ marginBottom: '1rem' }}>Assignment Evaluation</h2>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
        <select className="glass-input" value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={loadingMeta || courses.length === 0}>
          {!courseId && <option value="">Select a course</option>}
          {courses.map((course) => (
            <option key={course._id || course.id} value={course._id || course.id}>
              {course.title || course.courseCode || course.name || 'Course'}
            </option>
          ))}
        </select>

        <select className="glass-input" value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)} disabled={loadingMeta || !courseId || assignments.length === 0}>
          {!assignmentId && <option value="">Select an assignment</option>}
          {assignments.map((assignment) => (
            <option key={assignment._id || assignment.id} value={assignment._id || assignment.id}>
              {assignment.title || assignment.name || 'Assignment'}
            </option>
          ))}
        </select>

        <input className="glass-input" placeholder="Session label" value={sessionLabel} onChange={(e) => setSessionLabel(e.target.value)} />

        <select className="glass-input" value={assignmentType} onChange={(e) => setAssignmentType(e.target.value)}>
          <option value="text">Text</option>
          <option value="code">Code</option>
          <option value="mixed">Mixed</option>
        </select>

        <label>
          <span>Rubric file (.pdf, .docx, .txt, .md)</span>
          <input type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => setRubricFile(e.target.files?.[0] || null)} style={{ display: 'block', marginTop: 6 }} />
        </label>

        <label>
          <span>Student submissions ZIP</span>
          <input type="file" accept=".zip" onChange={(e) => setSubmissionsZip(e.target.files?.[0] || null)} style={{ display: 'block', marginTop: 6 }} />
        </label>

        <button type="submit" className="btn-primary" disabled={loading || !courseId || !assignmentId}>
          {loading ? 'Starting...' : 'Start Assignment Evaluation'}
        </button>
      </form>

      {status && <p style={{ marginTop: '1rem', color: '#cbd5e1' }}>{status}</p>}

      {(sessionInfo || results.length > 0) && (
        <div style={{ marginTop: '2rem', borderRadius: 12, background: 'rgba(15, 23, 42, 0.8)', padding: '1rem', overflowX: 'auto' }}>
          <h3 style={{ marginBottom: '0.75rem' }}>Evaluation Results</h3>
          <p style={{ marginBottom: '0.75rem', color: '#cbd5e1' }}>
            Session status: <strong>{sessionInfo?.status || 'UNKNOWN'}</strong>
            {' '}| Processed: <strong>{sessionInfo?.processedStudents ?? 0}</strong>
            {' '}| Total: <strong>{sessionInfo?.totalStudents ?? 0}</strong>
          </p>

          <table style={{ width: '100%', borderCollapse: 'collapse', color: '#f8fafc' }}>
              <thead>
                <tr>
                  <th style={{ borderBottom: '1px solid #334155', textAlign: 'left', padding: '0.5rem' }}>Student</th>
                  <th style={{ borderBottom: '1px solid #334155', textAlign: 'left', padding: '0.5rem', whiteSpace: 'nowrap' }}>Submission</th>
                  <th style={{ borderBottom: '1px solid #334155', textAlign: 'left', padding: '0.5rem', whiteSpace: 'nowrap' }}>Overall /100</th>
                  {criterionNames.map((criterion) => (
                    <th key={criterion} style={{ borderBottom: '1px solid #334155', textAlign: 'left', padding: '0.5rem', whiteSpace: 'nowrap' }}>{criterion}</th>
                  ))}
                  <th style={{ borderBottom: '1px solid #334155', textAlign: 'left', padding: '0.5rem', whiteSpace: 'nowrap' }}>Required Concepts</th>
                  <th style={{ borderBottom: '1px solid #334155', textAlign: 'left', padding: '0.5rem' }}>Confidence</th>
                  <th style={{ borderBottom: '1px solid #334155', textAlign: 'left', padding: '0.5rem' }}>Strengths</th>
                  <th style={{ borderBottom: '1px solid #334155', textAlign: 'left', padding: '0.5rem' }}>Mistakes</th>
                  <th style={{ borderBottom: '1px solid #334155', textAlign: 'left', padding: '0.5rem' }}>Missing Concepts</th>
                  <th style={{ borderBottom: '1px solid #334155', textAlign: 'left', padding: '0.5rem' }}>Feedback</th>
                  <th style={{ borderBottom: '1px solid #334155', textAlign: 'left', padding: '0.5rem' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 && (
                  <tr>
                    <td colSpan={10 + criterionNames.length} style={{ padding: '1rem', color: '#fca5a5', textAlign: 'center' }}>
                      {sessionInfo?.failureMetadata?.errorMessage || (
                        sessionInfo?.status === 'COMPLETED'
                          ? 'Session completed, but no student result records were returned.'
                          : 'Evaluation is still processing student results...'
                      )}
                    </td>
                  </tr>
                )}
                {results.map((result) => (
                  <tr key={result._id || `${result.studentName}-${result.rollNumber}`}>
                    <td style={{ borderBottom: '1px solid #1f2937', padding: '0.5rem' }}>{result.studentName || 'Unknown'}</td>
                    <td style={{ borderBottom: '1px solid #1f2937', padding: '0.5rem', whiteSpace: 'nowrap' }}>{result.fileName || result.file_name || `${result.studentName || 'submission'}.txt`}</td>
                    <td style={{ borderBottom: '1px solid #1f2937', padding: '0.5rem', whiteSpace: 'nowrap' }}>
                      {result.evaluationStatus === 'FAILED' || result.overallScore === null || result.overallScore === undefined
                        ? '—'
                        : Number(result.overallScore ?? result.score).toFixed(1)}
                    </td>
                    {criterionNames.map((criterion) => {
                      const entry = result.scoreBreakdown?.[criterion] || {};
                      const score = normalizeCriterionScore(entry.score, entry.maxScore);
                      return <td key={`${result._id || result.studentName}-${criterion}`} style={{ borderBottom: '1px solid #1f2937', padding: '0.5rem' }}>{score === '—' ? '—' : score}</td>;
                    })}
                    <td style={{ borderBottom: '1px solid #1f2937', padding: '0.5rem' }}>{formatList(result.requiredConcepts || result.required_concepts)}</td>
                    <td style={{ borderBottom: '1px solid #1f2937', padding: '0.5rem' }}>
                      {formatConfidence(result.confidence)}
                    </td>
                    <td style={{ borderBottom: '1px solid #1f2937', padding: '0.5rem', minWidth: 180 }}>{result.evaluationStatus === 'FAILED' ? 'N/A' : formatList(result.strengths)}</td>
                    <td style={{ borderBottom: '1px solid #1f2937', padding: '0.5rem', minWidth: 180 }}>{result.evaluationStatus === 'FAILED' ? (result.errorMessage || 'Evaluation failed') : formatList(result.mistakes)}</td>
                    <td style={{ borderBottom: '1px solid #1f2937', padding: '0.5rem', minWidth: 180 }}>{formatList(result.missingConcepts || result.missing_concepts || result.missingKeyPoints || result.missing_key_points)}</td>
                    <td style={{ borderBottom: '1px solid #1f2937', padding: '0.5rem', minWidth: 220 }}>{result.evaluationStatus === 'FAILED' ? (result.errorMessage || 'Evaluation failed') : (result.overallFeedback || result.feedback || 'N/A')}</td>
                    <td style={{ borderBottom: '1px solid #1f2937', padding: '0.5rem', whiteSpace: 'nowrap' }}>{result.evaluationStatus || 'COMPLETED'}</td>
                  </tr>
                ))}
              </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AssignmentEvaluation;
