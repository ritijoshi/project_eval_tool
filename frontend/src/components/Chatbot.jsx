import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, Trash2 } from 'lucide-react';
import axios from 'axios';
import { API_BASE } from '../config/api';

const Chatbot = () => {
  const [studentLevel, setStudentLevel] = useState('beginner');
  const [courses, setCourses] = useState([]);
  const [selectedCourseKey, setSelectedCourseKey] = useState('');
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  useEffect(() => {
    const fetchCourses = async () => {
      if (coursesLoading) return;

      try {
        const token = localStorage.getItem('token');
        const config = { headers: { Authorization: `Bearer ${token}` } };
        setCoursesLoading(true);
        const res = await axios.get(`${API_BASE}/api/student/courses`, config);
        setCourses(res.data?.courses || []);
        setSelectedCourseKey((prev) => {
          if (prev) return prev;
          const first = (res.data?.courses || [])[0] || '';
          return first;
        });
      } catch (err) {
        setCourses([]);
      } finally {
        setCoursesLoading(false);
      }
    };

    fetchCourses();
  }, []);

  useEffect(() => {
    if (!selectedCourseKey) return;
    const loadHistory = async () => {
      try {
        setHistoryLoading(true);
        const token = localStorage.getItem('token');
        const config = { headers: { Authorization: `Bearer ${token}` } };
        const res = await axios.get(
          `${API_BASE}/api/student/chat-history?course_key=${encodeURIComponent(selectedCourseKey)}`,
          config
        );
        setMessages(Array.isArray(res.data?.messages) ? res.data.messages : []);
      } catch (err) {
        setMessages([]);
      } finally {
        setHistoryLoading(false);
      }
    };

    loadHistory();
  }, [selectedCourseKey]);

  const clearHistory = async () => {
    if (!selectedCourseKey || loading) return;
    try {
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      await axios.delete(
        `${API_BASE}/api/student/chat-history?course_key=${encodeURIComponent(selectedCourseKey)}`,
        config
      );
      setMessages([]);
    } catch (err) {
      // Keep UX stable if clear history fails.
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    if (!selectedCourseKey) return;

    const userMessage = input;
    setMessages(prev => [...prev, { text: userMessage, sender: 'user' }]);
    setInput('');
    setLoading(true);

    try {
      const payload = {
        message: userMessage,
        student_level: studentLevel,
        course_key: selectedCourseKey,
        history: messages.slice(-20),
      };

      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.post(`${API_BASE}/api/student/course-chat`, payload, config);
      setMessages(prev => [...prev, { text: res.data.reply, sender: 'agent' }]);
    } catch (err) {
      setMessages(prev => [...prev, { text: "Sorry, I am currently offline.", sender: 'agent' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chatgpt-shell">
      <div className="chatgpt-header">
        <div className="chatgpt-title-wrap">
          <div className="chatgpt-logo">
            <Sparkles size={16} />
          </div>
          <div>
            <h3 className="chatgpt-title">Course Agent</h3>
            <p className="chatgpt-subtitle">Ask doubts anytime, with context-aware RAG answers</p>
          </div>
        </div>
        <button type="button" className="chatgpt-clear" onClick={clearHistory} disabled={!selectedCourseKey || loading}>
          <Trash2 size={14} />
          Clear
        </button>
      </div>

      <div className="chatgpt-toolbar">
        <select
          value={selectedCourseKey}
          onChange={(e) => setSelectedCourseKey(e.target.value)}
          disabled={coursesLoading || !courses.length}
          className="chatgpt-select"
        >
          {coursesLoading && <option value="">Loading courses...</option>}
          {!coursesLoading && courses.length === 0 && <option value="">No courses uploaded</option>}
          {courses.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select value={studentLevel} onChange={(e) => setStudentLevel(e.target.value)} className="chatgpt-select">
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>

      <div className="chatgpt-body">
        {historyLoading ? (
          <div className="chatgpt-empty">Loading chat history...</div>
        ) : messages.length === 0 ? (
          <div className="chatgpt-empty">
            <Bot size={20} />
            <p>Start asking about your course content. Answers use your professor's uploaded material.</p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={`chatgpt-row ${msg.sender === 'user' ? 'is-user' : 'is-agent'}`}>
              <div className="chatgpt-avatar">{msg.sender === 'user' ? <User size={14} /> : <Bot size={14} />}</div>
              <div className="chatgpt-bubble">{msg.text}</div>
            </div>
          ))
        )}

        {loading && (
          <div className="chatgpt-row is-agent chat-message-anim">
            <div className="chatgpt-avatar">
              <Bot size={14} />
            </div>
            <div className="chatgpt-bubble typing-indicator-wrap">
              <div className="typing-dot"></div>
              <div className="typing-dot"></div>
              <div className="typing-dot"></div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="chatgpt-compose" onSubmit={handleSend}>
        <input
          type="text"
          className="chatgpt-input"
          placeholder={selectedCourseKey ? 'Ask anything about your module...' : 'Select a course to begin'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!selectedCourseKey}
        />
        <button type="submit" disabled={loading || !selectedCourseKey || !input.trim()} className="chatgpt-send">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
};

export default Chatbot;
