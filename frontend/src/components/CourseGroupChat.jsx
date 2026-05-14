import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { API_BASE } from '../config/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { 
  Send, 
  Paperclip, 
  FileText, 
  Image as ImageIcon, 
  File, 
  X, 
  Loader2, 
  Download 
} from 'lucide-react';

const CourseGroupChat = ({ courseId }) => {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [attachments, setAttachments] = useState([]);
  
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const { on, off, emit, isConnected } = useWebSocket();
  const currentUserId = JSON.parse(localStorage.getItem('user') || '{}')._id;

  const fetchMessages = async (pageToFetch = 1) => {
    if (!courseId || courseId === 'all') return;
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_BASE}/api/group-chat/${courseId}?page=${pageToFetch}&limit=30`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const newMessages = res.data.messages || [];
      if (newMessages.length < 30) {
        setHasMore(false);
      }
      
      if (pageToFetch === 1) {
        setMessages(newMessages);
        scrollToBottom();
      } else {
        setMessages(prev => [...newMessages, ...prev]);
      }
    } catch (err) {
      console.error('Failed to fetch group chat messages', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (courseId && courseId !== 'all') {
      setPage(1);
      setHasMore(true);
      fetchMessages(1);
      
      if (isConnected) {
        emit('join-group-chat', courseId);
      }
    }
    
    return () => {
      if (isConnected && courseId && courseId !== 'all') {
        emit('leave-group-chat', courseId);
      }
    };
  }, [courseId, isConnected]);

  useEffect(() => {
    const handleNewMessage = (msg) => {
      if (String(msg.course) === String(courseId)) {
        setMessages((prev) => [...prev, msg]);
        scrollToBottom();
      }
    };

    const handleTyping = (data) => {
      if (data.userId !== currentUserId) {
        setTypingUsers((prev) => {
          const next = new Set(prev);
          next.add(data.userId);
          return next;
        });
      }
    };

    const handleStopTyping = (data) => {
      setTypingUsers((prev) => {
        const next = new Set(prev);
        next.delete(data.userId);
        return next;
      });
    };

    on('new-group-message', handleNewMessage);
    on('group-typing', handleTyping);
    on('group-stop-typing', handleStopTyping);

    return () => {
      off('new-group-message', handleNewMessage);
      off('group-typing', handleTyping);
      off('group-stop-typing', handleStopTyping);
    };
  }, [on, off, courseId, currentUserId]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleScroll = () => {
    if (chatContainerRef.current) {
      const { scrollTop } = chatContainerRef.current;
      if (scrollTop === 0 && hasMore && !loading) {
        const nextPage = page + 1;
        setPage(nextPage);
        fetchMessages(nextPage);
      }
    }
  };

  const handleTypingChange = (e) => {
    setInputText(e.target.value);
    emit('group-typing', courseId);
    
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      emit('group-stop-typing', courseId);
    }, 1500);
  };

  const handleFileChange = (e) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      setAttachments(prev => [...prev, ...filesArray].slice(0, 5)); // max 5 files
    }
  };

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async (e) => {
    e?.preventDefault();
    if ((!inputText.trim() && attachments.length === 0) || !courseId || courseId === 'all') return;

    let uploadedAttachments = [];
    if (attachments.length > 0) {
      setUploading(true);
      try {
        const token = localStorage.getItem('token');
        const formData = new FormData();
        attachments.forEach(file => formData.append('files', file));
        
        const res = await axios.post(`${API_BASE}/api/group-chat/${courseId}/upload`, formData, {
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data'
          }
        });
        uploadedAttachments = res.data.attachments;
      } catch (err) {
        console.error('File upload failed', err);
        setUploading(false);
        return; // Don't send message if upload fails
      }
      setUploading(false);
    }

    const messagePayload = {
      courseId,
      text: inputText.trim(),
      messageType: uploadedAttachments.length > 0 ? 'file' : 'text',
      attachments: uploadedAttachments
    };

    emit('send-group-message', messagePayload);
    setInputText('');
    setAttachments([]);
    emit('group-stop-typing', courseId);
  };

  const formatTime = (dateString) => {
    const options = { hour: '2-digit', minute: '2-digit' };
    return new Date(dateString).toLocaleTimeString([], options);
  };

  const getFileIcon = (kind) => {
    switch(kind) {
      case 'image': return <ImageIcon size={24} style={{ color: 'var(--primary)' }} />;
      case 'document': return <FileText size={24} style={{ color: '#E53935' }} />;
      default: return <File size={24} style={{ color: 'var(--muted)' }} />;
    }
  };

  if (!courseId || courseId === 'all') {
    return (
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '400px' }}>
        <MessageSquare size={48} style={{ color: 'var(--muted)', marginBottom: '1rem' }} />
        <h3 className="text-xl font-bold" style={{ color: 'var(--muted)' }}>Select a Course</h3>
        <p style={{ color: 'var(--muted)', textAlign: 'center', marginTop: '0.5rem' }}>
          Please select a specific course from the top menu to access its group chat.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px', maxHeight: '80vh', padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)', background: 'var(--surface-hover)' }}>
        <h3 className="text-xl font-bold">Course Chat</h3>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Real-time discussion with your professor and classmates.</p>
      </div>

      {/* Messages Area */}
      <div 
        ref={chatContainerRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
      >
        {loading && page > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--primary)' }} />
          </div>
        )}
        
        {messages.length === 0 && !loading && (
          <div style={{ textAlign: 'center', margin: 'auto', color: 'var(--muted)' }}>
            <p>No messages yet. Be the first to start the conversation!</p>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isMe = msg.sender?._id === currentUserId;
          const showSenderInfo = idx === 0 || messages[idx - 1].sender?._id !== msg.sender?._id;
          
          return (
            <div key={msg._id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
              {showSenderInfo && !isMe && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', marginLeft: '0.25rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{msg.sender?.name}</span>
                  <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: msg.sender?.role === 'professor' ? 'rgba(142, 36, 170, 0.15)' : 'rgba(10, 132, 255, 0.1)', color: msg.sender?.role === 'professor' ? '#8E24AA' : 'var(--primary)' }}>
                    {msg.sender?.role === 'professor' ? 'Professor' : 'Student'}
                  </span>
                </div>
              )}
              
              <div style={{ 
                maxWidth: '75%', 
                padding: '0.75rem 1rem', 
                borderRadius: '12px', 
                background: isMe ? 'var(--primary)' : 'var(--surface-hover)',
                color: isMe ? '#fff' : 'var(--text-main)',
                border: isMe ? 'none' : '1px solid var(--border)',
                borderBottomRightRadius: isMe ? '4px' : '12px',
                borderBottomLeftRadius: !isMe ? '4px' : '12px'
              }}>
                {msg.text && <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>{msg.text}</p>}
                
                {msg.attachments && msg.attachments.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: msg.text ? '0.75rem' : '0' }}>
                    {msg.attachments.map((file, i) => (
                      <a 
                        key={i} 
                        href={`${API_BASE}${file.fileUrl}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          padding: '0.75rem',
                          background: isMe ? 'rgba(255, 255, 255, 0.1)' : 'var(--bg-main)',
                          borderRadius: '8px',
                          textDecoration: 'none',
                          color: 'inherit'
                        }}
                      >
                        {getFileIcon(file.kind)}
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                          <p style={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.originalName}</p>
                          <p style={{ fontSize: '0.7rem', opacity: 0.8 }}>{(file.size / 1024).toFixed(1)} KB</p>
                        </div>
                        <Download size={16} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.25rem', marginRight: isMe ? '0.25rem' : '0', marginLeft: !isMe ? '0.25rem' : '0' }}>
                {formatTime(msg.createdAt)}
              </span>
            </div>
          );
        })}
        {typingUsers.size > 0 && (
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)', fontStyle: 'italic', paddingLeft: '1rem' }}>
            Someone is typing...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', background: 'var(--surface-hover)' }}>
        {attachments.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {attachments.map((file, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-main)', padding: '0.4rem 0.75rem', borderRadius: '999px', fontSize: '0.8rem', border: '1px solid var(--border)' }}>
                <span style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                <button onClick={() => removeAttachment(i)} style={{ color: 'var(--error)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSend} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: '0.75rem', borderRadius: '50%' }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={20} />
          </button>
          <input 
            type="file" 
            multiple 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            style={{ display: 'none' }} 
            accept=".pdf,.docx,.xlsx,.pptx,.zip,.jpg,.jpeg,.png,.gif,.mp3,.mp4"
          />
          
          <textarea
            value={inputText}
            onChange={handleTypingChange}
            placeholder="Type a message..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            className="glass-input"
            style={{
              flex: 1,
              resize: 'none',
              height: '46px',
              minHeight: '46px',
              maxHeight: '120px',
              padding: '0.75rem 1rem',
              borderRadius: '24px',
              overflowY: 'auto'
            }}
          />
          
          <button 
            type="submit" 
            className="btn-primary" 
            style={{ padding: '0.75rem', borderRadius: '50%' }}
            disabled={(!inputText.trim() && attachments.length === 0) || uploading}
          >
            {uploading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          </button>
        </form>
      </div>
    </div>
  );
};

// We need to import MessageSquare here
import { MessageSquare } from 'lucide-react';

export default CourseGroupChat;
