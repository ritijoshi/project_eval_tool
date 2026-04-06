import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../config/api';
import { useWebSocket } from '../hooks/useWebSocket';

const toDateTimeLocal = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  // datetime-local expects YYYY-MM-DDTHH:mm
  return date.toISOString().slice(0, 16);
};

const fromDateTimeLocal = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

const normalizeAttachmentLines = (text) => {
  const urls = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return urls;
};

export default function AnnouncementsPanel({ role, activeCourseId, activeCourse }) {
  const { on, off } = useWebSocket();

  const [announcements, setAnnouncements] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Professor form state
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState({
    title: '',
    content: '',
    attachmentsText: '',
    scheduledAt: '',
    isPinned: false,
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const isCourseSelected = Boolean(activeCourseId) && activeCourseId !== 'all';

  const getAuthConfig = () => {
    const token = localStorage.getItem('token');
    return { headers: { Authorization: `Bearer ${token}` } };
  };

  const fetchAnnouncements = useCallback(
    async ({ reset = false } = {}) => {
      if (!isCourseSelected) {
        setAnnouncements([]);
        setNextCursor(null);
        return;
      }

      try {
        setLoading(true);
        setError('');

        const cursorParam = reset ? '' : nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : '';
        const includeScheduled = role === 'professor' ? '&includeScheduled=true' : '';
        const url = `${API_BASE}/api/announcements?courseId=${encodeURIComponent(activeCourseId)}&limit=10${cursorParam}${includeScheduled}`;
        const res = await axios.get(url, getAuthConfig());

        const list = Array.isArray(res.data?.announcements) ? res.data.announcements : [];
        const cursor = res.data?.nextCursor || null;

        setAnnouncements((prev) => (reset ? list : [...(Array.isArray(prev) ? prev : []), ...list]));
        setNextCursor(cursor);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load announcements.');
        if (reset) {
          setAnnouncements([]);
          setNextCursor(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [activeCourseId, isCourseSelected, nextCursor, role]
  );

  useEffect(() => {
    setAnnouncements([]);
    setNextCursor(null);
    setError('');
    fetchAnnouncements({ reset: true });
  }, [activeCourseId, fetchAnnouncements]);

  useEffect(() => {
    const handler = (data) => {
      if (!data?.courseId) return;
      if (!activeCourseId || activeCourseId === 'all') return;
      if (String(data.courseId) !== String(activeCourseId)) return;
      fetchAnnouncements({ reset: true });
    };

    on('announcements-updated', handler);
    return () => off('announcements-updated', handler);
  }, [on, off, activeCourseId, fetchAnnouncements]);

  const toggleRead = async (announcement) => {
    if (!announcement?._id) return;
    try {
      await axios.post(
        `${API_BASE}/api/announcements/${announcement._id}/read`,
        { isRead: !announcement.isRead },
        getAuthConfig()
      );
      setAnnouncements((prev) =>
        (Array.isArray(prev) ? prev : []).map((a) =>
          a._id === announcement._id ? { ...a, isRead: !announcement.isRead } : a
        )
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update read state.');
    }
  };

  const startEdit = (announcement) => {
    setStatus('');
    setEditingId(String(announcement?._id || ''));
    setForm({
      title: String(announcement?.title || ''),
      content: String(announcement?.content || ''),
      attachmentsText: Array.isArray(announcement?.attachments) ? announcement.attachments.join('\n') : '',
      scheduledAt: toDateTimeLocal(announcement?.scheduledAt || ''),
      isPinned: Boolean(announcement?.isPinned),
    });
  };

  const resetForm = () => {
    setEditingId('');
    setForm({ title: '', content: '', attachmentsText: '', scheduledAt: '', isPinned: false });
  };

  const submit = async () => {
    if (!isCourseSelected) {
      setStatus('Select a course first.');
      return;
    }
    if (!form.title.trim()) {
      setStatus('Title is required.');
      return;
    }

    const payload = {
      courseId: activeCourseId,
      title: form.title.trim(),
      content: form.content,
      attachments: normalizeAttachmentLines(form.attachmentsText),
      isPinned: Boolean(form.isPinned),
    };

    const scheduledIso = fromDateTimeLocal(form.scheduledAt);
    if (scheduledIso === undefined) {
      setStatus('Scheduled time is invalid.');
      return;
    }
    if (scheduledIso) payload.scheduledAt = scheduledIso;

    try {
      setSaving(true);
      setStatus('');

      if (editingId) {
        await axios.patch(`${API_BASE}/api/announcements/${editingId}`, payload, getAuthConfig());
        setStatus('Announcement updated.');
      } else {
        await axios.post(`${API_BASE}/api/announcements`, payload, getAuthConfig());
        setStatus(scheduledIso ? 'Announcement scheduled.' : 'Announcement posted.');
      }

      resetForm();
      await fetchAnnouncements({ reset: true });
    } catch (err) {
      setStatus(err.response?.data?.message || 'Failed to save announcement.');
    } finally {
      setSaving(false);
    }
  };

  const togglePinned = async (announcement) => {
    if (!announcement?._id) return;
    try {
      await axios.patch(
        `${API_BASE}/api/announcements/${announcement._id}`,
        { isPinned: !announcement.isPinned },
        getAuthConfig()
      );
      setAnnouncements((prev) =>
        (Array.isArray(prev) ? prev : []).map((a) =>
          a._id === announcement._id ? { ...a, isPinned: !announcement.isPinned } : a
        )
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update pin status.');
    }
  };

  const publishNow = async (announcement) => {
    if (!announcement?._id) return;
    try {
      await axios.patch(`${API_BASE}/api/announcements/${announcement._id}`, { scheduledAt: null }, getAuthConfig());
      await fetchAnnouncements({ reset: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to publish announcement.');
    }
  };

  const remove = async (announcement) => {
    if (!announcement?._id) return;
    if (!window.confirm('Delete this announcement?')) return;
    try {
      await axios.delete(`${API_BASE}/api/announcements/${announcement._id}`, getAuthConfig());
      await fetchAnnouncements({ reset: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete announcement.');
    }
  };

  if (!isCourseSelected) {
    return (
      <div className="glass-panel">
        <h2 className="text-xl font-semibold">Announcements</h2>
        <p className="text-muted" style={{ marginTop: '0.5rem' }}>
          Select a course to view announcements.
        </p>
      </div>
    );
  }

  const courseLabel = activeCourse?.title
    ? `${activeCourse.title}${activeCourse.courseCode ? ` (${activeCourse.courseCode})` : ''}`
    : activeCourse?.courseCode || 'Course';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {role === 'professor' && (
        <div className="glass-panel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h2 className="text-xl font-semibold">Create Announcement</h2>
              <p className="text-muted" style={{ marginTop: '0.25rem' }}>
                Posting to {courseLabel}
              </p>
            </div>
            {editingId && (
              <button className="btn-secondary" onClick={resetForm} disabled={saving}>
                Cancel edit
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem', marginTop: '1rem' }}>
            <input
              className="glass-input"
              placeholder="Title"
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            />
            <textarea
              className="glass-input"
              rows={5}
              placeholder="Content"
              value={form.content}
              onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
            />
            <textarea
              className="glass-input"
              rows={3}
              placeholder="Attachments (one URL per line)"
              value={form.attachmentsText}
              onChange={(e) => setForm((p) => ({ ...p, attachmentsText: e.target.value }))}
            />
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={form.isPinned}
                  onChange={(e) => setForm((p) => ({ ...p, isPinned: e.target.checked }))}
                />
                <span>Pin</span>
              </label>
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span className="text-muted">Schedule</span>
                <input
                  type="datetime-local"
                  className="glass-input"
                  style={{ width: 240 }}
                  value={form.scheduledAt}
                  onChange={(e) => setForm((p) => ({ ...p, scheduledAt: e.target.value }))}
                />
              </label>
              <button className="btn-primary" onClick={submit} disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Update' : 'Post'}
              </button>
            </div>
            {status && <p className="text-muted">{status}</p>}
          </div>
        </div>
      )}

      <div className="glass-panel">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h2 className="text-xl font-semibold">Announcements</h2>
            <p className="text-muted" style={{ marginTop: '0.25rem' }}>
              {courseLabel}
            </p>
          </div>
          <button className="btn-secondary" onClick={() => fetchAnnouncements({ reset: true })} disabled={loading}>
            Refresh
          </button>
        </div>

        {error && (
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ color: 'var(--error)' }}>{error}</p>
          </div>
        )}

        {loading && announcements.length === 0 ? (
          <p className="text-muted" style={{ marginTop: '1rem' }}>Loading announcements…</p>
        ) : announcements.length === 0 ? (
          <p className="text-muted" style={{ marginTop: '1rem' }}>No announcements yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            {announcements.map((a) => {
              const published = Boolean(a.publishedAt);
              const scheduled = Boolean(a.scheduledAt) && !published;
              return (
                <div
                  key={a._id}
                  className="p-4 rounded-lg border"
                  style={{ background: 'var(--surface-hover)', borderColor: 'var(--border)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <h3 className="font-semibold" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {a.title}
                        </h3>
                        {a.isPinned && (
                          <span className="px-2 py-1 rounded" style={{ background: 'rgba(10,132,255,0.15)', color: 'var(--primary)', fontSize: 12 }}>
                            Pinned
                          </span>
                        )}
                        {role === 'student' && (
                          <span className="px-2 py-1 rounded" style={{ background: a.isRead ? 'rgba(52,199,89,0.15)' : 'rgba(255,149,0,0.15)', color: a.isRead ? '#34C759' : '#FF9500', fontSize: 12 }}>
                            {a.isRead ? 'Read' : 'Unread'}
                          </span>
                        )}
                        {scheduled && (
                          <span className="px-2 py-1 rounded" style={{ background: 'rgba(94,53,177,0.15)', color: 'var(--secondary)', fontSize: 12 }}>
                            Scheduled
                          </span>
                        )}
                      </div>
                      {(published || scheduled) && (
                        <p className="text-muted" style={{ marginTop: '0.25rem', fontSize: '0.875rem' }}>
                          {published
                            ? `Published ${new Date(a.publishedAt).toLocaleString()}`
                            : `Scheduled for ${new Date(a.scheduledAt).toLocaleString()}`}
                        </p>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {role === 'student' ? (
                        <button className="btn-secondary" onClick={() => toggleRead(a)}>
                          Mark {a.isRead ? 'unread' : 'read'}
                        </button>
                      ) : (
                        <>
                          <button className="btn-secondary" onClick={() => togglePinned(a)}>
                            {a.isPinned ? 'Unpin' : 'Pin'}
                          </button>
                          {scheduled && (
                            <button className="btn-secondary" onClick={() => publishNow(a)}>
                              Publish now
                            </button>
                          )}
                          <button className="btn-secondary" onClick={() => startEdit(a)}>
                            Edit
                          </button>
                          <button className="btn-secondary" style={{ color: 'var(--error)' }} onClick={() => remove(a)}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {a.content && (
                    <div style={{ marginTop: '0.75rem', whiteSpace: 'pre-wrap' }}>{a.content}</div>
                  )}

                  {Array.isArray(a.attachments) && a.attachments.length > 0 && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <p className="text-muted" style={{ marginBottom: '0.25rem' }}>Attachments</p>
                      <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                        {a.attachments.map((url) => (
                          <li key={url}>
                            <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>
                              {url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}

            {nextCursor && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.5rem' }}>
                <button className="btn-secondary" onClick={() => fetchAnnouncements({ reset: false })} disabled={loading}>
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
