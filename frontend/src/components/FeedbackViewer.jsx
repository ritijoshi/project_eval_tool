import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, MessageSquare, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import axios from 'axios';
import { API_BASE } from '../config/api';

const FeedbackViewer = ({ evaluationId, onClose = null }) => {
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedSections, setExpandedSections] = useState({
    ai: true,
    professor: true,
    responses: true,
  });
  const [newResponse, setNewResponse] = useState('');
  const [isQuestion, setIsQuestion] = useState(false);
  const [submittingResponse, setSubmittingResponse] = useState(false);

  useEffect(() => {
    const fetchFeedback = async () => {
      try {
        const token = localStorage.getItem('token');
        const config = { headers: { Authorization: `Bearer ${token}` } };
        const res = await axios.get(
          `${API_BASE}/api/feedback/${evaluationId}`,
          config
        );
        setFeedback(res.data);
      } catch (err) {
        console.error('Error fetching feedback:', err);
        setError('Failed to load feedback');
      } finally {
        setLoading(false);
      }
    };

    if (evaluationId) {
      fetchFeedback();
    }
  }, [evaluationId]);

  const handleAddResponse = async (e) => {
    e.preventDefault();
    if (!newResponse.trim()) return;

    setSubmittingResponse(true);
    try {
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.post(
        `${API_BASE}/api/feedback/${evaluationId}/response`,
        { message: newResponse, isQuestion },
        config
      );
      setFeedback(res.data.feedback);
      setNewResponse('');
      setIsQuestion(false);
    } catch (err) {
      console.error('Error adding response:', err);
      setError('Failed to add response');
    } finally {
      setSubmittingResponse(false);
    }
  };

  if (loading) {
    return (
      <div className="feedback-loader">
        <div className="loader-spinner"></div>
        <p>Loading feedback...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="feedback-error">
        <AlertCircle size={24} />
        <p>{error}</p>
      </div>
    );
  }

  if (!feedback) {
    return <div className="feedback-not-found">No feedback found</div>;
  }

  const getStatusBadge = (status) => {
    const statusMap = {
      pending: { color: '#FFA500', icon: Clock, label: 'Pending Review' },
      reviewed: { color: '#0A84FF', icon: CheckCircle, label: 'Reviewed' },
      awaiting_response: { color: '#FFC107', icon: MessageSquare, label: 'Awaiting Response' },
      resolved: { color: '#34C759', icon: CheckCircle, label: 'Resolved' },
    };
    const statusInfo = statusMap[status] || statusMap.pending;
    const Icon = statusInfo.icon;
    return (
      <div className="feedback-status-badge" style={{ borderColor: statusInfo.color }}>
        <Icon size={16} style={{ color: statusInfo.color }} />
        <span style={{ color: statusInfo.color }}>{statusInfo.label}</span>
      </div>
    );
  };

  return (
    <div className="feedback-viewer">
      {onClose && (
        <button className="feedback-close" onClick={onClose}>
          ✕
        </button>
      )}

      {/* Header */}
      <div className="feedback-header">
        <h2 className="feedback-title">Evaluation & Feedback</h2>
        {getStatusBadge(feedback.status)}
      </div>

      {/* AI Evaluation Section */}
      <div className="feedback-section">
        <button
          className="feedback-section-header"
          onClick={() =>
            setExpandedSections({
              ...expandedSections,
              ai: !expandedSections.ai,
            })
          }
        >
          <div className="feedback-section-title">
            <div className="feedback-icon" style={{ background: 'rgba(10, 132, 255, 0.2)' }}>
              🤖
            </div>
            <div>
              <h3>AI Evaluation</h3>
              <p className="feedback-section-desc">Automated assessment by AI system</p>
            </div>
          </div>
          {expandedSections.ai ? (
            <ChevronUp size={20} />
          ) : (
            <ChevronDown size={20} />
          )}
        </button>

        {expandedSections.ai && (
          <div className="feedback-section-content">
            <div className="feedback-score-display">
              <span className="feedback-score-label">Score</span>
              <span className="feedback-score-value">{feedback.aiEvaluation.score}</span>
            </div>
            <div className="feedback-text">
              <p>{feedback.aiEvaluation.feedback}</p>
            </div>
            {feedback.submissionContent?.text && (
              <div className="feedback-submission">
                <p className="feedback-label">Your Submission:</p>
                <div className="feedback-submission-content">
                  {feedback.submissionContent.text}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Professor Feedback Section */}
      {feedback.professorReview?.reviewed && (
        <div className="feedback-section">
          <button
            className="feedback-section-header"
            onClick={() =>
              setExpandedSections({
                ...expandedSections,
                professor: !expandedSections.professor,
              })
            }
          >
            <div className="feedback-section-title">
              <div
                className="feedback-icon"
                style={{ background: 'rgba(142, 36, 170, 0.2)' }}
              >
                👨‍🏫
              </div>
              <div>
                <h3>Professor's Review</h3>
                <p className="feedback-section-desc">
                  {feedback.professor?.name || 'Professor'}'s feedback on your work
                </p>
              </div>
            </div>
            {expandedSections.professor ? (
              <ChevronUp size={20} />
            ) : (
              <ChevronDown size={20} />
            )}
          </button>

          {expandedSections.professor && (
            <div className="feedback-section-content">
              {feedback.professorReview.manualFeedback && (
                <div className="feedback-text">
                  <p>{feedback.professorReview.manualFeedback}</p>
                </div>
              )}
              {feedback.professorReview.scoreAdjustment !== 0 && (
                <div className="feedback-adjustment">
                  <span className="feedback-label">Score Adjustment:</span>
                  <span
                    className="feedback-adjustment-value"
                    style={{
                      color:
                        feedback.professorReview.scoreAdjustment > 0 ? '#34C759' : '#FF3B30',
                    }}
                  >
                    {feedback.professorReview.scoreAdjustment > 0 ? '+' : ''}
                    {feedback.professorReview.scoreAdjustment}%
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Student Responses Section */}
      <div className="feedback-section">
        <button
          className="feedback-section-header"
          onClick={() =>
            setExpandedSections({
              ...expandedSections,
              responses: !expandedSections.responses,
            })
          }
        >
          <div className="feedback-section-title">
            <div className="feedback-icon" style={{ background: 'rgba(52, 199, 89, 0.2)' }}>
              💬
            </div>
            <div>
              <h3>
                Your Responses ({feedback.studentResponses?.length || 0})
              </h3>
              <p className="feedback-section-desc">Questions or clarifications you've asked</p>
            </div>
          </div>
          {expandedSections.responses ? (
            <ChevronUp size={20} />
          ) : (
            <ChevronDown size={20} />
          )}
        </button>

        {expandedSections.responses && (
          <div className="feedback-section-content">
            {feedback.studentResponses && feedback.studentResponses.length > 0 ? (
              <div className="feedback-responses-list">
                {feedback.studentResponses.map((response, idx) => (
                  <div key={idx} className="feedback-response-item">
                    <div className="feedback-response-header">
                      <span className="feedback-response-type">
                        {response.isQuestion ? '❓ Question' : '💭 Response'}
                      </span>
                      <span className="feedback-response-time">
                        {new Date(response.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="feedback-response-text">{response.message}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="feedback-empty">No responses yet. Ask a question below!</p>
            )}
          </div>
        )}
      </div>

      {/* Add Response Form */}
      {feedback.status !== 'resolved' && (
        <form className="feedback-response-form" onSubmit={handleAddResponse}>
          <h3 className="feedback-form-title">Ask a Question or Respond</h3>
          <textarea
            value={newResponse}
            onChange={(e) => setNewResponse(e.target.value)}
            placeholder="Type your question or response here..."
            className="feedback-textarea"
            rows="4"
          />
          <div className="feedback-form-actions">
            <div className="feedback-form-checkbox">
              <input
                type="checkbox"
                id="isQuestion"
                checked={isQuestion}
                onChange={(e) => setIsQuestion(e.target.checked)}
              />
              <label htmlFor="isQuestion">This is a question requiring professor response</label>
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={!newResponse.trim() || submittingResponse}
            >
              {submittingResponse ? 'Sending...' : 'Send Response'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default FeedbackViewer;
