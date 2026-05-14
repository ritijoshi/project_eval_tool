import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

export function useEvaluationSocket(sessionId) {
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('PENDING');
    const [processedStudents, setProcessedStudents] = useState(0);
    const [totalStudents, setTotalStudents] = useState(0);
    const [recentResults, setRecentResults] = useState([]);
    const [isCompleted, setIsCompleted] = useState(false);
    const [error, setError] = useState(null);

    const socketRef = useRef(null);

    useEffect(() => {
        if (!sessionId) return;

        const token = localStorage.getItem('token');

        // Connect specifically for this widget
        socketRef.current = io('http://localhost:5001', {
            auth: { token },
            transports: ['websocket'],
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });

        // The socket automatically connects.
        // In this architecture, the Node backend will automatically emit entirely to the room,
        // but we need to tell Node we are joining this room if needed, OR we can listen to global 
        // events that specifically mention our sessionId. 
        // Given our EvaluationController emits directly to `evaluation_session_${sessionId}`,
        // we must emit a join request to the Node server socket configuration.
        socketRef.current.emit('join_evaluation_room', { sessionId });

        // Listen for stream progress
        socketRef.current.on('evaluation_progress', (data) => {
            if (data.sessionId !== sessionId) return;

            setStatus(data.status);
            if (data.progressPercent !== undefined) setProgress(data.progressPercent);
            if (data.processedStudents !== undefined) setProcessedStudents(data.processedStudents);
            if (data.totalStudents !== undefined) setTotalStudents(data.totalStudents);

            if (data.recentResult) {
                setRecentResults(prev => [data.recentResult, ...prev].slice(0, 10)); // keep last 10 in ephemeral stream
            }
        });

        // Listen for completion
        // Listen for completion
        socketRef.current.on('evaluation_completed', (data) => {
            console.log('COMPLETED EVENT RECEIVED:', data);

            if (data.sessionId !== sessionId) return;

            setStatus(data.status);
            setIsCompleted(true);

            if (data.evaluations) {
                setRecentResults(data.evaluations);
            }
        });
        socketRef.current.on('connect_error', (err) => {
            console.error('Socket connection error:', err.message);
            setError('Lost connection to realtime updates. The job will continue in the background.');
        });

        return () => {
            if (socketRef.current) {
                // Safeguard against ghost listener duplicate triggers across renders
                socketRef.current.emit('leave_evaluation_room', { sessionId });
                socketRef.current.off('evaluation_progress');
                socketRef.current.off('evaluation_completed');
                socketRef.current.disconnect();
            }
        };
    }, [sessionId]);

    return {
        progress,
        status,
        processedStudents,
        totalStudents,
        recentResults,
        isCompleted,
        error
    };
}
