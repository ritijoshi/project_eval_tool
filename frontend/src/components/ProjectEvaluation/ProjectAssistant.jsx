import React, { useState, useRef, useEffect } from 'react';
import {
  Bot,
  User,
  Send,
  Sparkles,
  Trash2,
  HelpCircle,
  AlertCircle,
  Loader2,
  X,
  MessageSquare,
  CheckCircle2,
} from 'lucide-react';
import axios from 'axios';
import { API_BASE } from '../../config/api';
import ProjectHealthBadge from './ProjectHealthBadge';

const SUGGESTED_QUESTIONS = [
  'What should I work on next?',
  'Why did I lose marks in architecture?',
  'How can I improve my requirement coverage?',
  'What should I complete this week?',
];

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Normalizes input value to an array of non-empty strings.
 */
const ensureArray = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val
      .map((item) => (typeof item === 'string' ? item.trim() : JSON.stringify(item)))
      .filter(Boolean);
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      } catch {
        // Fall back
      }
    }
    return trimmed.split(/\r?\n/).map((s) => s.replace(/^[-*•\d.]+\s*/, '').trim()).filter(Boolean);
  }
  return [];
};

/**
 * Builds a contextual system prompt summary for LLM queries based on supplied project props.
 */
const formatProjectContextPrompt = (context) => {
  const lines = ['You are a dedicated Project Evaluation Assistant. Answer the question specifically using this project context:'];

  if (context.identifier || context.teamName) {
    lines.push(`- Project: ${context.teamName || context.identifier} (ID: ${context.identifier || 'N/A'})`);
  }
  if (context.projectGoal) {
    lines.push(`- Stated Goal: ${context.projectGoal}`);
  }
  if (context.overallScore !== undefined && context.overallScore !== null) {
    lines.push(`- Overall Score: ${context.overallScore}/${context.maxScore || 100} (Grade: ${context.gradeLabel || 'N/A'}, Health: ${context.healthStatus || 'UNKNOWN'})`);
  }
  if (context.requirementCoverage !== undefined && context.requirementCoverage !== null) {
    lines.push(`- Requirement Coverage: ${context.requirementCoverage}%`);
  }
  if (context.missingRequirements && context.missingRequirements.length > 0) {
    lines.push(`- Missing Requirements: ${context.missingRequirements.join('; ')}`);
  }
  if (context.missingConcepts && context.missingConcepts.length > 0) {
    lines.push(`- Missing Concepts: ${context.missingConcepts.join('; ')}`);
  }
  if (context.nextWeekTasks && context.nextWeekTasks.length > 0) {
    lines.push(`- Recommended Next Tasks: ${context.nextWeekTasks.join('; ')}`);
  }
  if (context.evaluationFeedback) {
    lines.push(`- Evaluator Feedback: ${context.evaluationFeedback}`);
  }
  if (context.strengths && context.strengths.length > 0) {
    lines.push(`- Key Strengths: ${context.strengths.join('; ')}`);
  }

  return lines.join('\n');
};

/**
 * ProjectAssistant
 * Reusable AI evaluation assistant for answering student & instructor queries about project evaluations.
 */
export const ProjectAssistant = ({
  project = null,
  projectIdentifier = '',
  teamName = '',
  projectGoal = '',
  evaluationFeedback = '',
  missingRequirements = null,
  missingConcepts = null,
  nextWeekTasks = null,
  weeklyProgress = null,
  onSendMessage = null,
  courseKey = '',
  courseId = '',
  compact = false,
  onClose = null,
}) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Assemble full context object strictly from supplied props without inventing data
  const projectContext = {
    identifier: projectIdentifier || project?.identifier || '',
    teamName: teamName || project?.teamName || '',
    repoUrl: project?.repoUrl || '',
    overallScore: project?.overallScore,
    maxScore: project?.maxScore || 100,
    gradeLabel: project?.gradeLabel || '',
    healthStatus: project?.healthStatus || 'UNKNOWN',
    requirementCoverage: project?.requirementCoverage,
    projectGoal: projectGoal || project?.projectGoal || '',
    evaluationFeedback: evaluationFeedback || project?.feedback || '',
    missingRequirements: missingRequirements !== null ? ensureArray(missingRequirements) : ensureArray(project?.missingRequirements),
    missingConcepts: missingConcepts !== null ? ensureArray(missingConcepts) : ensureArray(project?.missingConcepts),
    nextWeekTasks: nextWeekTasks !== null ? ensureArray(nextWeekTasks) : ensureArray(project?.nextWeekTasks),
    strengths: ensureArray(project?.strengths),
    criterionScores: project?.criterionScores || [],
    weeklyProgress: weeklyProgress || project?.weeklyClaims || {},
  };

  const displayName = projectContext.teamName || projectContext.identifier || 'Project';

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const clearChat = () => {
    setMessages([]);
    setErrorMessage('');
    if (inputRef.current) inputRef.current.focus();
  };

  const handleSendQuery = async (queryText) => {
    const textToSend = String(queryText || input || '').trim();
    if (!textToSend || loading) return;

    const userMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setErrorMessage('');

    try {
      let replyText = '';

      if (typeof onSendMessage === 'function') {
        // Preferred parent-provided handler
        const result = await onSendMessage(textToSend, projectContext);
        if (typeof result === 'string') {
          replyText = result;
        } else if (result && typeof result === 'object') {
          replyText = result.reply || result.content || result.message || result.text || '';
        }
      } else {
        // Fall back to existing general course chatbot API endpoint with enriched prompt
        const promptContext = formatProjectContextPrompt(projectContext);
        const combinedMessage = `${promptContext}\n\nUser Question:\n${textToSend}`;

        const historyPayload = messages.slice(-10).map((m) => ({
          sender: m.sender === 'user' ? 'user' : 'agent',
          text: m.text,
        }));

        const res = await axios.post(
          `${API_BASE}/api/chat`,
          {
            message: combinedMessage,
            course_key: courseKey || 'general',
            course_id: courseId || '',
            student_level: 'intermediate',
            history: historyPayload,
          },
          {
            headers: getAuthHeaders(),
          }
        );

        replyText = res.data?.reply || res.data?.response?.content || res.data?.message || '';
      }

      const assistantMessage = {
        id: `bot-${Date.now()}`,
        sender: 'assistant',
        text: replyText || "I reviewed your project evaluation. Let me know if you'd like guidance on a specific rubric criterion or milestone task.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      // Do not expose internal server errors or auth tokens
      const friendlyError = err?.response?.data?.message || 'The assistant is temporarily unavailable. Please try again or ask your instructor.';
      setErrorMessage(friendlyError);

      const errorFallback = {
        id: `bot-err-${Date.now()}`,
        sender: 'assistant',
        text: "I couldn't process your question at this moment. You can still review your rubric scores and recommended action items above.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isError: true,
      };

      setMessages((prev) => [...prev, errorFallback]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendQuery();
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: compact ? '480px' : '560px',
        maxHeight: '85vh',
        background: 'rgba(15, 23, 42, 0.94)',
        border: '1px solid rgba(99, 102, 241, 0.3)',
        borderRadius: 16,
        backdropFilter: 'blur(16px)',
        overflow: 'hidden',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.45)',
      }}
    >
      {/* ─── Header ────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.85rem 1.15rem',
          borderBottom: '1px solid rgba(99, 102, 241, 0.2)',
          background: 'rgba(30, 41, 59, 0.45)',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.3) 0%, rgba(168, 85, 247, 0.3) 100%)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#c7d2fe',
              flexShrink: 0,
            }}
          >
            <Sparkles size={16} />
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h4 style={{ margin: 0, color: '#f8fafc', fontSize: '0.98rem', fontWeight: 700 }}>
                Project AI Assistant
              </h4>
              <ProjectHealthBadge healthStatus={projectContext.healthStatus} size="xs" />
            </div>
            <p
              style={{
                margin: 0,
                color: '#94a3b8',
                fontSize: '0.74rem',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Advising for {displayName}
              {projectContext.overallScore !== undefined && projectContext.overallScore !== null ? ` • ${projectContext.overallScore}/${projectContext.maxScore} pts` : ''}
            </p>
          </div>
        </div>

        {/* Header Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              title="Clear conversation"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#94a3b8',
                padding: '4px 8px',
                borderRadius: 6,
                fontSize: '0.74rem',
                cursor: 'pointer',
              }}
            >
              <Trash2 size={13} />
              <span>Clear</span>
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Close assistant"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#94a3b8',
                width: 28,
                height: 28,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* ─── Body / Message History ────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem',
        }}
      >
        {/* Welcome State when no messages yet */}
        {messages.length === 0 ? (
          <div
            style={{
              margin: 'auto',
              maxWidth: 420,
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '1rem',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#818cf8',
              }}
            >
              <Bot size={24} />
            </div>

            <h4 style={{ margin: 0, color: '#f8fafc', fontSize: '1.05rem', fontWeight: 600 }}>
              Ask anything about your project evaluation
            </h4>

            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.5 }}>
              I can explain score deductions, suggest improvements for missing requirements, or guide your team on next week's milestones.
            </p>

            {/* Quick Question Chips */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.45rem',
                width: '100%',
                marginTop: '0.5rem',
              }}
            >
              {SUGGESTED_QUESTIONS.map((question, idx) => (
                <button
                  key={`welcome-chip-${idx}`}
                  type="button"
                  onClick={() => handleSendQuery(question)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'rgba(30, 41, 59, 0.6)',
                    border: '1px solid rgba(99, 102, 241, 0.25)',
                    borderRadius: 10,
                    padding: '0.55rem 0.85rem',
                    color: '#c7d2fe',
                    fontSize: '0.8rem',
                    fontWeight: 500,
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <HelpCircle size={14} style={{ color: '#818cf8', flexShrink: 0 }} />
                  <span>{question}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.sender === 'user';

            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  flexDirection: isUser ? 'row-reverse' : 'row',
                }}
              >
                {/* Avatar */}
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: isUser ? 'rgba(168, 85, 247, 0.25)' : 'rgba(99, 102, 241, 0.25)',
                    border: `1px solid ${isUser ? 'rgba(168, 85, 247, 0.4)' : 'rgba(99, 102, 241, 0.4)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isUser ? '#d8b4fe' : '#c7d2fe',
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  {isUser ? <User size={13} /> : <Bot size={13} />}
                </div>

                {/* Message Bubble */}
                <div
                  style={{
                    maxWidth: '82%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div
                    style={{
                      background: isUser
                        ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.3) 0%, rgba(168, 85, 247, 0.25) 100%)'
                        : msg.isError
                        ? 'rgba(239, 68, 68, 0.12)'
                        : 'rgba(30, 41, 59, 0.75)',
                      border: `1px solid ${
                        isUser
                          ? 'rgba(99, 102, 241, 0.4)'
                          : msg.isError
                          ? 'rgba(239, 68, 68, 0.35)'
                          : 'rgba(99, 102, 241, 0.22)'
                      }`,
                      borderRadius: 12,
                      padding: '0.65rem 0.9rem',
                      color: isUser ? '#f1f5f9' : msg.isError ? '#fca5a5' : '#e2e8f0',
                      fontSize: '0.86rem',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                    }}
                  >
                    {msg.text}
                  </div>

                  <span
                    style={{
                      fontSize: '0.68rem',
                      color: '#64748b',
                      marginTop: 3,
                      padding: '0 4px',
                    }}
                  >
                    {msg.timestamp}
                  </span>
                </div>
              </div>
            );
          })
        )}

        {/* Loading / Typing Indicator */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                background: 'rgba(99, 102, 241, 0.25)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#c7d2fe',
                flexShrink: 0,
              }}
            >
              <Bot size={13} />
            </div>

            <div
              style={{
                background: 'rgba(30, 41, 59, 0.65)',
                border: '1px solid rgba(99, 102, 241, 0.22)',
                borderRadius: 12,
                padding: '0.6rem 0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: '#94a3b8',
                fontSize: '0.82rem',
              }}
            >
              <Loader2 className="animate-spin" size={14} style={{ color: '#818cf8' }} />
              <span>Analyzing project context...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ─── Error Notification Banner (if any) ─────────────────────────────── */}
      {errorMessage && (
        <div
          style={{
            margin: '0 0.85rem 0.5rem 0.85rem',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 8,
            padding: '0.45rem 0.75rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            color: '#fca5a5',
            fontSize: '0.78rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={13} />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage('')}
            style={{
              background: 'none',
              border: 'none',
              color: '#fca5a5',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* ─── Compact Suggestion Chips above Input (when chatting) ───────────── */}
      {messages.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            padding: '0.35rem 0.85rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.04)',
            background: 'rgba(15, 23, 42, 0.6)',
          }}
        >
          {SUGGESTED_QUESTIONS.map((q, i) => (
            <button
              key={`chip-${i}`}
              type="button"
              onClick={() => handleSendQuery(q)}
              style={{
                background: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.2)',
                borderRadius: 14,
                padding: '2px 8px',
                color: '#c7d2fe',
                fontSize: '0.72rem',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* ─── Input & Send Form ──────────────────────────────────────────────── */}
      <div
        style={{
          padding: '0.75rem 0.85rem',
          borderTop: '1px solid rgba(99, 102, 241, 0.2)',
          background: 'rgba(15, 23, 42, 0.8)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Ask about ${displayName}'s evaluation...`}
          disabled={loading}
          style={{
            flex: 1,
            background: 'rgba(30, 41, 59, 0.7)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: 10,
            padding: '0.6rem 0.85rem',
            color: '#f8fafc',
            fontSize: '0.85rem',
            outline: 'none',
          }}
        />

        <button
          type="button"
          onClick={() => handleSendQuery()}
          disabled={!input.trim() || loading}
          title="Send question"
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: input.trim() && !loading
              ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'
              : 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            color: input.trim() && !loading ? '#fff' : '#64748b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
            flexShrink: 0,
            transition: 'all 0.2s ease',
          }}
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
};

export default ProjectAssistant;
