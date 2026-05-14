import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { API_BASE } from '../config/api';

/**
 * Subscribes to live leaderboard_update events for a given evaluation session.
 * Automatically joins/leaves the leaderboard_session_${sessionId} Socket.io room.
 */
export function useLeaderboardSocket(sessionId) {
    const [liveLeaderboard, setLiveLeaderboard] = useState([]);
    const [totalEvaluated, setTotalEvaluated] = useState(0);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [isLive, setIsLive] = useState(false);
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
            setIsLive(true);
            socketRef.current.emit('join_leaderboard_room', { sessionId });
        });

        socketRef.current.on('disconnect', () => {
            setIsLive(false);
        });

        socketRef.current.on('leaderboard_update', (data) => {
            if (data.sessionId !== sessionId) return;
            if (Array.isArray(data.leaderboard)) {
                setLiveLeaderboard(data.leaderboard);
            }
            if (typeof data.totalEvaluated === 'number') {
                setTotalEvaluated(data.totalEvaluated);
            }
            setLastUpdated(new Date());
        });

        socketRef.current.on('connect_error', (err) => {
            console.warn('Leaderboard socket error:', err.message);
            setIsLive(false);
        });

        return () => {
            if (socketRef.current) {
                socketRef.current.emit('leave_leaderboard_room', { sessionId });
                socketRef.current.off('leaderboard_update');
                socketRef.current.disconnect();
            }
        };
    }, [sessionId]);

    const clearLive = useCallback(() => {
        setLiveLeaderboard([]);
        setTotalEvaluated(0);
        setLastUpdated(null);
    }, []);

    return { liveLeaderboard, totalEvaluated, lastUpdated, isLive, clearLive };
}
