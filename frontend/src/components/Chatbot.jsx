import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Clock3, FileAudio2, FileText, Mic, MicOff, Paperclip, Send, Sparkles, Trash2, Upload, User, X } from 'lucide-react';
import axios from 'axios';
import { API_BASE } from '../config/api';
import { useActiveCourse } from '../context/ActiveCourseContext';

const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const getAbsoluteUrl = (value) => {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_BASE}${value.startsWith('/') ? '' : '/'}${value}`;
};

const inferFileKind = (file) => {
  const mime = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(name)) return 'image';
  if (mime.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|webm|mp4)$/i.test(name)) return 'audio';
  return 'document';
};

const normalizeServerMessage = (message) => {
  if (!message) return null;
  const metadata = message.metadata && typeof message.metadata === 'object' ? message.metadata : {};
  const files = Array.isArray(metadata.files) ? metadata.files : [];
  return {
    ...message,
    text: message.content || message.text || '',
    content: message.content || message.text || '',
    fileUrl: message.fileUrl || files[0]?.fileUrl || '',
    metadata: { ...metadata, files },
  };
};

const normalizeDraftFile = (file) => ({
  file,
  kind: inferFileKind(file),
  previewUrl: String(file?.type || '').startsWith('image/') ? URL.createObjectURL(file) : '',
});

const Chatbot = () => {
  const [studentLevel, setStudentLevel] = useState('beginner');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [draftFiles, setDraftFiles] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const messagesEndRef = useRef(null);
  const bodyRef = useRef(null);
  const fileInputRef = useRef(null);
  const recorderRef = useRef(null);
  const recordingStreamRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const draftFilesRef = useRef([]);
  const { activeCourseId, activeCourse } = useActiveCourse();
  const activeCourseKey = useMemo(() => activeCourse?.courseCode || '', [activeCourse]);

  const scrollToBottom = () => {
    const body = bodyRef.current;
    if (!body) return;
    requestAnimationFrame(() => {
      body.scrollTop = body.scrollHeight;
    });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  useEffect(() => {
    draftFilesRef.current = draftFiles;
  }, [draftFiles]);

  useEffect(() => () => {
    recordingTimerRef.current && clearInterval(recordingTimerRef.current);
    recordingStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    draftFilesRef.current.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
  }, []);

  useEffect(() => {
    if (!activeCourseKey) return;

    const loadHistory = async () => {
      try {
        setHistoryLoading(true);
        const res = await axios.get(
          `${API_BASE}/api/chat/history?course_key=${encodeURIComponent(activeCourseKey)}`,
          { headers: getAuthHeaders() }
        );
        setMessages(Array.isArray(res.data?.messages) ? res.data.messages.map(normalizeServerMessage).filter(Boolean) : []);
      } catch (err) {
        setMessages([]);
      } finally {
        setHistoryLoading(false);
      }
    };

    loadHistory();
  }, [activeCourseKey]);

  const buildHistory = () => messages.slice(-20).map((message) => ({
    sender: message.sender,
    text: message.content || message.text || '',
  }));

  const clearHistory = async () => {
    if (!activeCourseKey || loading) return;
    try {
      await axios.delete(
        `${API_BASE}/api/chat/history?course_key=${encodeURIComponent(activeCourseKey)}`,
        { headers: getAuthHeaders() }
      );
      setMessages([]);
    } catch (err) {
      // Keep the UI stable if clearing history fails.
    }
  };

  const clearDraftFiles = () => {
    setDraftFiles((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const appendConversation = (userMessage, agentMessage) => {
    setMessages((prev) => [...prev, userMessage, agentMessage].filter(Boolean));
  };

  const submitTextMessage = async () => {
    const textToSend = input.trim();
    if (!textToSend || !activeCourseKey || loading) return;

    setLoading(true);
    setErrorMessage('');

    try {
      const res = await axios.post(`${API_BASE}/api/chat`, {
        message: textToSend,
        student_level: studentLevel,
        course_id: activeCourseId,
        course_key: activeCourseKey,
        history: buildHistory(),
      }, {
        headers: getAuthHeaders(),
      });

      appendConversation(
        normalizeServerMessage(res.data?.message) || { sender: 'user', type: 'text', content: textToSend, text: textToSend, metadata: {} },
        normalizeServerMessage(res.data?.response) || { sender: 'agent', type: 'text', content: res.data?.reply || '', text: res.data?.reply || '', metadata: {} }
      );
      setInput('');
    } catch (err) {
      appendConversation(
        { sender: 'user', type: 'text', content: textToSend, text: textToSend, metadata: {} },
        { sender: 'agent', type: 'text', content: 'Sorry, I am currently offline.', text: 'Sorry, I am currently offline.', metadata: {} }
      );
      setErrorMessage(err.response?.data?.message || 'Failed to send message.');
    } finally {
      setLoading(false);
    }
  };

  const submitUploadMessage = async () => {
    if (!activeCourseKey || loading || draftFiles.length === 0) return;

    const formData = new FormData();
    formData.append('course_id', activeCourseId || '');
    formData.append('course_key', activeCourseKey);
    formData.append('student_level', studentLevel);
    formData.append('message', input.trim());
    formData.append('history', JSON.stringify(buildHistory()));
    draftFiles.forEach((item) => formData.append('files', item.file));

    setLoading(true);
    setErrorMessage('');

    try {
      const res = await axios.post(`${API_BASE}/api/chat/upload`, formData, {
        headers: getAuthHeaders(),
      });

      appendConversation(
        normalizeServerMessage(res.data?.message) || {
          sender: 'user',
          type: draftFiles.some((item) => item.kind === 'image') ? 'image' : 'document',
          content: input.trim() || 'Uploaded file(s).',
          text: input.trim() || 'Uploaded file(s).',
          metadata: {
            files: draftFiles.map((item) => ({
              originalName: item.file.name,
              fileUrl: item.previewUrl || '',
              mimeType: item.file.type,
              kind: item.kind,
            })),
          },
        },
        normalizeServerMessage(res.data?.response) || { sender: 'agent', type: 'text', content: res.data?.reply || '', text: res.data?.reply || '', metadata: {} }
      );

      setInput('');
      clearDraftFiles();
    } catch (err) {
      setErrorMessage(err.response?.data?.message || 'Failed to upload files.');
    } finally {
      setLoading(false);
    }
  };

  const stopRecordingStream = () => {
    recordingTimerRef.current && clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    recordingStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  };

  const submitVoiceMessage = async (audioBlob) => {
    if (!activeCourseKey || loading || !audioBlob) return;

    const file = new File([audioBlob], `voice-${Date.now()}.webm`, { type: audioBlob.type || 'audio/webm' });
    const formData = new FormData();
    formData.append('course_id', activeCourseId || '');
    formData.append('course_key', activeCourseKey);
    formData.append('student_level', studentLevel);
    formData.append('message', input.trim());
    formData.append('history', JSON.stringify(buildHistory()));
    formData.append('audio', file);

    setLoading(true);
    setErrorMessage('');

    try {
      const res = await axios.post(`${API_BASE}/api/chat/voice`, formData, {
        headers: getAuthHeaders(),
      });

      appendConversation(
        normalizeServerMessage(res.data?.message) || {
          sender: 'user',
          type: 'voice',
          content: res.data?.transcript || input.trim() || 'Voice message',
          text: res.data?.transcript || input.trim() || 'Voice message',
          fileUrl: res.data?.attachments?.[0]?.fileUrl || '',
          metadata: {
            transcript: res.data?.transcript || '',
            files: res.data?.attachments || [],
          },
        },
        normalizeServerMessage(res.data?.response) || { sender: 'agent', type: 'text', content: res.data?.reply || '', text: res.data?.reply || '', metadata: {} }
      );
      setInput('');
    } catch (err) {
      setErrorMessage(err.response?.data?.message || 'Failed to transcribe voice message.');
    } finally {
      setLoading(false);
    }
  };

  const startRecording = async () => {
    if (!activeCourseKey || loading || isRecording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErrorMessage('This browser does not support audio recording.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stopRecordingStream();
        setIsRecording(false);
        const blob = new Blob(recordingChunksRef.current, { type: mimeType || 'audio/webm' });
        recordingChunksRef.current = [];
        if (blob.size > 0) {
          await submitVoiceMessage(blob);
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      recordingStreamRef.current = stream;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setErrorMessage(err.message || 'Unable to access the microphone.');
      stopRecordingStream();
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    recorderRef.current?.stop();
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
      return;
    }
    startRecording();
  };

  const handleFileSelection = (selectedFiles) => {
    const nextFiles = Array.from(selectedFiles || [])
      .filter((file) => file && file.size <= MAX_UPLOAD_SIZE)
      .map(normalizeDraftFile);

    if (nextFiles.length !== Array.from(selectedFiles || []).length) {
      setErrorMessage('One or more files exceeded the 25MB limit and were skipped.');
    } else {
      setErrorMessage('');
    }

    setDraftFiles((prev) => [...prev, ...nextFiles]);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    handleFileSelection(event.dataTransfer.files);
  };

  const removeDraftFile = (index) => {
    setDraftFiles((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  };

  const handleSend = async (event) => {
    if (event && event.preventDefault) event.preventDefault();
    if (loading || isRecording) return;
    if (draftFiles.length > 0) {
      await submitUploadMessage();
      return;
    }
    await submitTextMessage();
  };

  const renderAttachment = (attachment, index) => {
    const fileName = attachment.originalName || attachment.filename || `Attachment ${index + 1}`;
    const kind = String(attachment.kind || attachment.file_type || '').toLowerCase();
    const url = getAbsoluteUrl(attachment.fileUrl || attachment.url || '');

    if (kind === 'image') {
      return (
        <div key={`${fileName}-${index}`} className="chatgpt-attachment chatgpt-attachment--image">
          <img src={url} alt={fileName} className="chatgpt-image-preview" />
          <span>{fileName}</span>
        </div>
      );
    }

    if (kind === 'voice' || kind === 'audio') {
      return (
        <div key={`${fileName}-${index}`} className="chatgpt-attachment chatgpt-attachment--audio">
          <div className="chatgpt-file-icon"><FileAudio2 size={16} /></div>
          <div>
            <strong>{fileName}</strong>
            <audio controls src={url} className="chatgpt-audio-player" />
          </div>
        </div>
      );
    }

    return (
      <div key={`${fileName}-${index}`} className="chatgpt-attachment chatgpt-attachment--document">
        <div className="chatgpt-file-icon"><FileText size={16} /></div>
        <div>
          <strong>{fileName}</strong>
          <p>{attachment.text || attachment.content || 'Document attachment'}</p>
        </div>
      </div>
    );
  };

  const renderMessage = (message, idx) => {
    const attachments = Array.isArray(message?.metadata?.files) ? message.metadata.files : [];
    const kind = String(message?.type || 'text').toLowerCase();
    const text = message?.content || message?.text || '';
    const isUser = message?.sender === 'user';

    return (
      <div key={`${idx}-${kind}`} className={`chatgpt-row ${isUser ? 'is-user' : 'is-agent'}`}>
        <div className="chatgpt-avatar">{isUser ? <User size={14} /> : <Bot size={14} />}</div>
        <div className="chatgpt-bubble chatgpt-bubble--rich">
          {(kind === 'voice' || attachments.some((item) => String(item.kind || item.file_type).toLowerCase() === 'audio')) && (
            <div className="chatgpt-voice-block">
              {message?.fileUrl ? <audio controls src={getAbsoluteUrl(message.fileUrl)} className="chatgpt-audio-player" /> : null}
              {text ? <p>{text}</p> : null}
            </div>
          )}

          {kind === 'image' || attachments.some((item) => String(item.kind || item.file_type).toLowerCase() === 'image') ? (
            <div className="chatgpt-attachment-grid">
              {attachments.filter((item) => String(item.kind || item.file_type).toLowerCase() === 'image').map(renderAttachment)}
            </div>
          ) : null}

          {kind === 'document' || attachments.some((item) => String(item.kind || item.file_type).toLowerCase() === 'document') ? (
            <div className="chatgpt-attachment-grid">
              {attachments.filter((item) => String(item.kind || item.file_type).toLowerCase() !== 'image').map(renderAttachment)}
            </div>
          ) : null}

          {text && kind === 'text' ? <div>{text}</div> : null}
          {text && kind !== 'text' ? <div className="chatgpt-message-caption">{text}</div> : null}
        </div>
      </div>
    );
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
          messages.map((message, idx) => renderMessage(message, idx))
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

      {draftFiles.length > 0 && (
        <div className="chatgpt-draft-panel">
          {draftFiles.map((item, index) => (
            <div key={`${item.file.name}-${index}`} className="chatgpt-draft-card">
              {item.kind === 'image' ? (
                <img src={item.previewUrl} alt={item.file.name} className="chatgpt-draft-thumb" />
              ) : (
                <div className="chatgpt-file-icon">
                  {item.kind === 'audio' ? <FileAudio2 size={16} /> : <FileText size={16} />}
                </div>
              )}
              <div className="chatgpt-draft-meta">
                <strong>{item.file.name}</strong>
                <span>{item.kind.toUpperCase()}</span>
              </div>
              <button type="button" className="chatgpt-draft-remove" onClick={() => removeDraftFile(index)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        className={`chatgpt-compose ${dragActive ? 'is-drag-active' : ''}`}
        onSubmit={handleSend}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragActive(false);
          handleFileSelection(event.dataTransfer.files);
        }}
        style={{ position: 'relative' }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.docx,audio/*"
          className="chatgpt-file-input"
          onChange={(event) => handleFileSelection(event.target.files)}
        />

        <div className="chatgpt-input-shell">
          <textarea
            className="chatgpt-input chatgpt-input--multiline"
            placeholder={activeCourseKey ? 'Ask anything about your module, or attach files and audio...' : 'Select a course to begin'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!activeCourseKey || loading}
            rows={2}
          />

          <div className="chatgpt-compose-actions">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!activeCourseKey || loading}
              className="chatgpt-send chatgpt-send--secondary"
              title="Attach files"
            >
              <Paperclip size={16} />
            </button>
            <button
              type="button"
              onClick={toggleRecording}
              disabled={!activeCourseKey || loading}
              className={`chatgpt-send ${isRecording ? 'is-recording' : ''}`}
              title={isRecording ? 'Stop recording' : 'Record voice message'}
            >
              {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button type="submit" disabled={loading || !activeCourseKey || (!input.trim() && draftFiles.length === 0 && !isRecording)} className="chatgpt-send">
              <Send size={16} />
            </button>
          </div>
        </div>

        {isRecording && (
          <div className="chatgpt-recording-bar">
            <span className="chatgpt-recording-dot" />
            Recording voice message
            <span className="chatgpt-recording-time">
              <Clock3 size={13} />
              {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}
            </span>
          </div>
        )}

        {dragActive && <div className="chatgpt-drop-hint"><Upload size={16} /> Drop files to attach them to the chat</div>}

        {errorMessage && <div className="chatgpt-error">{errorMessage}</div>}
      </form>
    </div>
  );
};

export default Chatbot;