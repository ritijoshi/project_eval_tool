import { useEffect, useState, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { API_BASE } from '../config/api';

/**
 * Custom React hook for real-time Project Evaluation progress,
 * completion, failures, and leaderboard updates.
 *
 * Joins Socket.io room: project_eval_session_${sessionId}
 *
 * @param {string} sessionId - The ProjectEvalSession ObjectId
 */
export function useProjectEvaluationSocket(sessionId) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('PENDING');
  const [processedRepos, setProcessedRepos] = useState(0);
  const [totalRepos, setTotalRepos] = useState(0);
  const [latestResult, setLatestResult] = useState(null);
  const [results, setResults] = useState([]);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isFailed, setIsFailed] = useState(false);
  const [error, setError] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [totalEvaluated, setTotalEvaluated] = useState(0);
  const [isConnected, setIsConnected] = useState(false);

  const socketRef = useRef(null);

  useEffect(() => {
    if (!sessionId) return;

    const token = localStorage.getItem('token');

    socketRef.current = io(API_BASE, {
      auth: { token },
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current.on('connect', () => {
      setIsConnected(true);
      socketRef.current.emit('join_project_evaluation_room', { sessionId });
    });

    socketRef.current.on('disconnect', () => {
      setIsConnected(false);
    });

    // 1. Progress updates during execution
    socketRef.current.on('project_eval_progress', (data) => {
      if (data.sessionId !== sessionId) return;

      if (data.status) setStatus(data.status);
      if (typeof data.progressPercent === 'number') setProgress(data.progressPercent);
      if (typeof data.processedRepos === 'number') setProcessedRepos(data.processedRepos);
      if (typeof data.totalRepos === 'number') setTotalRepos(data.totalRepos);

      if (data.latestResult) {
        setLatestResult(data.latestResult);
        setResults((prev) => {
          const next = Array.isArray(prev) ? [...prev] : [];
          const idx = next.findIndex((item) => item?._id === data.latestResult._id);
          if (idx >= 0) {
            next[idx] = data.latestResult;
            return next;
          }
          return [data.latestResult, ...next];
        });
      }
    });

    // 2. Session completed event
    socketRef.current.on('project_eval_completed', (data) => {
      if (data.sessionId !== sessionId) return;

      setStatus(data.status || 'COMPLETED');
      setProgress(100);
      setIsCompleted(true);

      if (Array.isArray(data.results)) {
        setResults(data.results);
      }
      if (typeof data.processedRepos === 'number') {
        setProcessedRepos(data.processedRepos);
      }
      if (typeof data.totalRepos === 'number') {
        setTotalRepos(data.totalRepos);
      }
    });

    // 3. Session failed event
    socketRef.current.on('project_eval_failed', (data) => {
      if (data.sessionId !== sessionId) return;

      setStatus('FAILED');
      setIsFailed(true);
      setError(data.error || 'Project evaluation encountered an error');
    });

    // 4. Leaderboard ready event
    socketRef.current.on('project_leaderboard_ready', (data) => {
      if (data.sessionId !== sessionId) return;

      if (Array.isArray(data.leaderboard)) {
        setLeaderboard(data.leaderboard);
      }
      if (typeof data.totalEvaluated === 'number') {
        setTotalEvaluated(data.totalEvaluated);
      }
    });

    socketRef.current.on('connect_error', (err) => {
      console.warn('[ProjectEvalSocket] Connection error:', err.message);
      setError('Live socket update connection interrupted. Retrying in background...');
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.emit('leave_project_evaluation_room', { sessionId });
        socketRef.current.off('project_eval_progress');
        socketRef.current.off('project_eval_completed');
        socketRef.current.off('project_eval_failed');
        socketRef.current.off('project_leaderboard_ready');
        socketRef.current.disconnect();
      }
    };
  }, [sessionId]);

  const clearSocketState = useCallback(() => {
    setProgress(0);
    setStatus('PENDING');
    setProcessedRepos(0);
    setTotalRepos(0);
    setLatestResult(null);
    setResults([]);
    setIsCompleted(false);
    setIsFailed(false);
    setError(null);
    setLeaderboard(null);
    setTotalEvaluated(0);
  }, []);

  return {
    progress,
    status,
    processedRepos,
    totalRepos,
    latestResult,
    results,
    isCompleted,
    isFailed,
    error,
    leaderboard,
    totalEvaluated,
    isConnected,
    clearSocketState,
  };
}

export default useProjectEvaluationSocket;
