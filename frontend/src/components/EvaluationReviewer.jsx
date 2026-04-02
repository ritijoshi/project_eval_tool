import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, AlertCircle, CheckCircle, User } from 'lucide-react';
import axios from 'axios';
import { API_BASE } from '../config/api';

const EvaluationReviewer = ({ feedbackId }) => {
  const [evaluation, setEvaluation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedSections, setExpandedSections] = useState({
    ai: true,
    submission: true,
    feedback: true,
    responses: true,
  });
  const [feedbackForm, setFeedbackForm] = useState({
    manualFeedback: '',
    scoreAdjustment: 0,
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchEvaluation = async () => {
      try {
        const token = localStorage.getItem('token');
        const config = { headers: { Authorization: `Bearer ${token}` } };
        const res = await axios.get(
          `${API_BASE}/api/feedback/evaluations/${feedbackId}`,
          config
        );
        setEvaluation(res.data);
        if (res.data.professorReview?.reviewed) {
          setFeedbackForm({
            manualFeedback: res.data.professorReview.manualFeedback || '',
            scoreAdjustment: res.data.professorReview.scoreAdjustment || 0,
          });
        }
      } catch (err) {
        console.error('Error fetching evaluation:', err);
        setError('Failed to load evaluation');
      } finally {
        setLoading(false);
      }
    };

    if (feedbackId) {
      fetchEvaluation();
    }
  }, [feedbackId]);

  const handleSubmitFeedback = async (e) => {
    e.preventDefault();
    if (!feedbackForm.manualFeedback.trim()) {
      setError('Please provide feedback');
      return;
    }

    setSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.post(
        `${API_BASE}/api/feedback/evaluations/${feedbackId}/feedback`,
        feedbackForm,
        config
      );
      setEvaluation(res.data.feedback);
      setError('');
      alert('Feedback submitted successfully!');
    } catch (err) {
      console.error('Error submitting feedback:', err);
      setError('Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="eval-reviewer-loader">
        <div className="loader-spinner"></div>
        <p>Loading evaluation...</p>
      </div>
    );
  }

  if (error && !evaluation) {
    return (
      <div className="eval-reviewer-error">
        <AlertCircle size={24} />
        <p>{error}</p>
      </div>
    );
  }

  if (!evaluation) {
    return <div className="eval-reviewer-not-found">Evaluation not found</div>;
  }

  const getStatusColor = (status) => {
    const colors = {
      pending: '#FFA500',
      reviewed: '#0A84FF',
      awaiting_response: '#FFC107',
      resolved: '#34C759',
    };
    return colors[status] || '#888';
  };

  const calculateFinalScore = () => {
    const scoreStr = evaluation.aiEvaluation.score || '0/100';
    const match = scoreStr.match(/(\d+)/);
    const baseScore = match ? parseInt(match[1]) : 0;
    return baseScore + (feedbackForm.scoreAdjustment || 0);
  };

  return (
    <div className="eval-reviewer">
      {/* Header */}
      <div className="eval-reviewer-header">
        <div className="eval-student-info">
          <div className="eval-student-avatar">
            {evaluation.student?.name?.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="eval-student-name">{evaluation.student?.name}</h2>
            <p className="eval-course-key">{evaluation.courseKey}</p>
          </div>
        </div>
        <div
          className="eval-status-badge"
          style={{ borderColor: getStatusColor(evaluation.status) }}
        >
          <CheckCircle size={16} style={{ color: getStatusColor(evaluation.status) }} />
          <span style={{ color: getStatusColor(evaluation.status) }}>
            {evaluation.status.charAt(0).toUpperCase() + evaluation.status.slice(1)}
          </span>
        </div>
      </div>

      {/* AI Evaluation Section */}
      <div className="eval-section">
        <button
          className="eval-section-header"
          onClick={() =>
            setExpandedSections({
              ...expandedSections,
              ai: !expandedSections.ai,
            })
          }
        >
          <h3>AI Evaluation</h3>
          {expandedSections.ai ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>
        {expandedSections.ai && (
          <div className="eval-section-content">
            <div className="eval-score-display">
              <span className="eval-score-label">AI Score</span>
              <span className="eval-score-value">{evaluation.aiEvaluation.score}</span>
            </div>
            <div className="eval-feedback-text">
              <p>{evaluation.aiEvaluation.feedback}</p>
            </div>
          </div>
        )}
      </div>

      {/* Submission Section */}
      {evaluation.submissionContent?.text && (
        <div className="eval-section">
          <button
            className="eval-section-header"
            onClick={() =>
              setExpandedSections({
                ...expandedSections,
                submission: !expandedSections.submission,
              })
            }
          >
            <h3>Student Submission</h3>
            {expandedSections.submission ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
          {expandedSections.submission && (
            <div className="eval-section-content">
              <div className="eval-submission-content">
                {evaluation.submissionContent.text}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add/View Feedback Section */}
      <div className="eval-section">
        <button
          className="eval-section-header"
          onClick={() =>
            setExpandedSections({
              ...expandedSections,
              feedback: !expandedSections.feedback,
            })
          }
        >
          <h3>Your Feedback Review</h3>
          {expandedSections.feedback ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>
        {expandedSections.feedback && (
          <div className="eval-section-content">
            <form className="eval-feedback-form" onSubmit={handleSubmitFeedback}>
              <div className="eval-form-group">
                <label className="eval-form-label">Professional Feedback</label>
                <textarea
                  value={feedbackForm.manualFeedback}
                  onChange={(e) =>
                    setFeedbackForm({
                      ...feedbackForm,
                      manualFeedback: e.target.value,
                    })
                  }
                  placeholder="Provide your detailed feedback, suggestions, and guidance for the student..."
                  className="glass-input eval-textarea"
                  rows="6"
                  disabled={submitting}
                />
                <p className="eval-form-hint">
                  Be specific and constructive to help the student improve
                </p>
              </div>

              <div className="eval-form-group">
                <label className="eval-form-label">Score Adjustment</label>
                <div className="eval-score-adjustment">
                  <div className="eval-adjustment-input">
                    <input
                      type="number"
                      min="-50"
                      max="50"
                      value={feedbackForm.scoreAdjustment}
                      onChange={(e) =>
                        setFeedbackForm({
                          ...feedbackForm,
                          scoreAdjustment: parseInt(e.target.value) || 0,
                        })
                      }
                      className="glass-input"
                      placeholder="0"
                      disabled={submitting}
                    />
                    <span className="eval-adjustment-label">points (optional)</span>
                  </div>
                  <div className="eval-final-score">
                    <span className="eval-final-label">Final Score:</span>
                    <span className="eval-final-value">{calculateFinalScore()}</span>
                  </div>
                </div>
                <p className="eval-form-hint">
                  Add or subtract points from AI score if needed (range: -50 to +50)
                </p>
              </div>

              {error && <div className="eval-error">{error}</div>}

              <button
                type="submit"
                className="btn-primary"
                disabled={submitting}
                style={{ width: '100%' }}
              >
                {submitting ? 'Submitting...' : 'Submit Feedback'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Student Responses Section */}
      {evaluation.studentResponses && evaluation.studentResponses.length > 0 && (
        <div className="eval-section">
          <button
            className="eval-section-header"
            onClick={() =>
              setExpandedSections({
                ...expandedSections,
                responses: !expandedSections.responses,
              })
            }
          >
            <h3>Student Questions & Responses ({evaluation.studentResponses.length})</h3>
            {expandedSections.responses ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
          {expandedSections.responses && (
            <div className="eval-section-content">
              <div className="eval-responses-list">
                {evaluation.studentResponses.map((response, idx) => (
                  <div key={idx} className="eval-response-item">
                    <div className="eval-response-header">
                      <span className="eval-response-type">
                        {response.isQuestion ? '❓ Question' : '💭 Response'}
                      </span>
                      <span className="eval-response-time">
                        {new Date(response.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="eval-response-text">{response.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EvaluationReviewer;
