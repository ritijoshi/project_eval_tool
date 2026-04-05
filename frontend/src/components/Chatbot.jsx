import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Bot, User, Sparkles, Trash2, Mic, MicOff } from 'lucide-react';
import axios from 'axios';
import { API_BASE } from '../config/api';
import { useActiveCourse } from '../context/ActiveCourseContext';

const Chatbot = () => {
  const [studentLevel, setStudentLevel] = useState('beginner');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const messagesEndRef = useRef(null);
  const bodyRef = useRef(null);
  const recognitionRef = useRef(null);
  const { activeCourseId, activeCourse } = useActiveCourse();
  const activeCourseKey = useMemo(() => activeCourse?.courseCode || '', [activeCourse]);

  const scrollToBottom = () => {
    const body = bodyRef.current;
    if (!body) return;
    // Only scroll inside the chat message panel (never the whole page).
    requestAnimationFrame(() => {
      body.scrollTop = body.scrollHeight;
    });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event) => {
        let transcript = event.results[0][0].transcript;
        // Make sure transcript isn't undefined
        if (transcript) {
          sendMessageRef.current(transcript);
        }
      };
      recognition.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        if (event.error === 'not-allowed') {
          alert("Microphone permission denied.");
        }
        setIsListening(false);
      };
      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch (err) {
          console.error("Could not start speech recognition", err);
        }
      } else {
        alert("Your browser doesn't support speech recognition.");
      }
    }
  };

  useEffect(() => {
    if (!activeCourseKey) return;
    const loadHistory = async () => {
      try {
        setHistoryLoading(true);
        const token = localStorage.getItem('token');
        const config = { headers: { Authorization: `Bearer ${token}` } };
        const res = await axios.get(
          `${API_BASE}/api/student/chat-history?course_key=${encodeURIComponent(activeCourseKey)}`,
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
  }, [activeCourseKey]);

  const clearHistory = async () => {
    if (!activeCourseKey || loading) return;
    try {
      const token = localStorage.getItem('token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      await axios.delete(
        `${API_BASE}/api/student/chat-history?course_key=${encodeURIComponent(activeCourseKey)}`,
        config
      );
      setMessages([]);
    } catch (err) {
      // Keep UX stable if clear history fails.
    }
  };

  const sendMessageData = async (textOverride = null) => {
    const textToSend = textOverride !== null ? textOverride : input;
    if (!textToSend.trim()) return;
    if (!activeCourseKey) return;

    const userMessage = textToSend;
    setMessages(prev => [...prev, { text: userMessage, sender: 'user' }]);
    if (textOverride === null) {
      setInput(''); // Only clear input if we were sending from the input box
    }
    setLoading(true);

    try {
      const payload = {
        message: userMessage,
        student_level: studentLevel,
        course_id: activeCourseId,
        course_key: activeCourseKey,
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

  const sendMessageRef = useRef(sendMessageData);
  useEffect(() => {
    sendMessageRef.current = sendMessageData;
  });

  const handleSend = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    await sendMessageData();
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
        <button type="button" className="chatgpt-clear" onClick={clearHistory} disabled={!activeCourseKey || loading}>
          <Trash2 size={14} />
          Clear
        </button>
      </div>

      <div className="chatgpt-toolbar">
        <div className="chatgpt-select" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>{activeCourseKey ? `Course: ${activeCourse?.title}` : 'Select a course to begin'}</span>
        </div>
        <select value={studentLevel} onChange={(e) => setStudentLevel(e.target.value)} className="chatgpt-select">
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>

      <div className="chatgpt-body" ref={bodyRef}>
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

      <form className="chatgpt-compose" onSubmit={handleSend} style={{ position: 'relative' }}>
        {isListening && (
          <div style={{ position: 'absolute', top: '-25px', left: '15px', color: '#00B0FF', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <div className="typing-indicator-wrap" style={{ display: 'flex', alignItems: 'center', margin: 0, padding: 0 }}>
              <div className="typing-dot" style={{ backgroundColor: '#00B0FF', width: '4px', height: '4px' }}></div>
              <div className="typing-dot" style={{ backgroundColor: '#00B0FF', width: '4px', height: '4px' }}></div>
              <div className="typing-dot" style={{ backgroundColor: '#00B0FF', width: '4px', height: '4px' }}></div>
            </div>
            Listening...
          </div>
        )}
        <input
          type="text"
          className="chatgpt-input"
          placeholder={activeCourseKey ? 'Ask anything about your module...' : 'Select a course to begin'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!activeCourseKey}
        />
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            type="button" 
            onClick={toggleListening}
            disabled={!activeCourseKey}
            className={`chatgpt-send ${isListening ? 'listening-active' : ''}`}
            style={{ 
              ...(isListening ? { 
                backgroundColor: 'rgba(255, 107, 107, 0.2)', 
                color: '#FF6B6B',
                animation: 'pulse 1.5s infinite' 
              } : {}),
              transition: 'all 0.3s ease'
            }}
            title={isListening ? "Stop listening" : "Start voice input"}
          >
            {isListening ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <button type="submit" disabled={loading || !activeCourseKey || !input.trim()} className="chatgpt-send">
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  );
};

export default Chatbot;
