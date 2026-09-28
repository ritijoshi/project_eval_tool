import { useEffect, useState, useCallback } from 'react';
import { listCourseReports, downloadSavedReport, deleteSavedReport } from '../../services/assignmentEvalApi';

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const ReportHistoryPanel = ({ courseId, courseCode }) => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null); // report._id pending confirm
  const [deletingId, setDeletingId] = useState(null);

  const fetchReports = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    setError('');
    try {
      const data = await listCourseReports(courseId);
      setReports(Array.isArray(data.reports) ? data.reports : []);
    } catch {
      setError('Could not load report history.');
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleDownload = async (report) => {
    setDownloadingId(report._id);
    try {
      await downloadSavedReport(report._id, report.fileName);
    } catch {
      // silent
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteConfirm = async (reportId) => {
    setDeletingId(reportId);
    setConfirmDeleteId(null);
    try {
      await deleteSavedReport(reportId);
      setReports((prev) => prev.filter((r) => r._id !== reportId));
    } catch {
      setError('Could not delete report. Try again.');
    } finally {
      setDeletingId(null);
    }
  };

  if (!courseId) return null;

  return (
    <div
      className="report-history-panel"
      style={{
        marginTop: '2rem',
        borderRadius: 14,
        background: 'rgba(15, 23, 42, 0.85)',
        border: '1px solid rgba(99,102,241,0.25)',
        padding: '1.25rem',
        backdropFilter: 'blur(10px)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: '1rem', fontWeight: 600 }}>
          📁 Report History{courseCode ? ` — ${courseCode}` : ''}
        </h3>
        <button
          onClick={fetchReports}
          disabled={loading}
          style={{
            background: 'rgba(99,102,241,0.15)',
            border: '1px solid rgba(99,102,241,0.35)',
            color: '#a5b4fc',
            borderRadius: 8,
            padding: '4px 12px',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          {loading ? '↻ Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</p>
      )}

      {!loading && reports.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: '0.85rem', textAlign: 'center', padding: '1rem 0' }}>
          No saved reports yet. Reports are auto-generated when a session completes.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', color: '#cbd5e1' }}>
            <thead>
              <tr>
                {['Assignment', 'Generated At', 'Students', 'Avg Score', 'Actions'].map((h) => (
                  <th
                    key={h}
                    style={{
                      borderBottom: '1px solid rgba(99,102,241,0.25)',
                      padding: '0.5rem 0.75rem',
                      textAlign: h === 'Actions' ? 'right' : 'left',
                      color: '#94a3b8',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => {
                const isConfirming = confirmDeleteId === report._id;
                const isDeleting   = deletingId === report._id;

                return (
                  <tr
                    key={report._id}
                    style={{ transition: 'background 0.15s' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(99,102,241,0.06)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Assignment */}
                    <td style={cell}>
                      <div style={{ fontWeight: 500 }}>{report.assignmentTitle || '—'}</div>
                      {report.fileName && (
                        <div style={{ color: '#64748b', fontSize: '0.72rem', marginTop: 2 }}>{report.fileName}</div>
                      )}
                    </td>

                    {/* Date */}
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>{formatDate(report.generatedAt)}</td>

                    {/* Students */}
                    <td style={{ ...cell, textAlign: 'center' }}>{report.studentCount ?? '—'}</td>

                    {/* Avg Score */}
                    <td style={{ ...cell, textAlign: 'center' }}>
                      {report.averageScore != null ? Number(report.averageScore).toFixed(1) : '—'}
                    </td>

                    {/* Actions */}
                    <td style={{ ...cell, textAlign: 'right' }}>
                      {isConfirming ? (
                        // Inline confirmation
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: '#fbbf24', fontSize: '0.78rem' }}>Delete?</span>
                          <button
                            onClick={() => handleDeleteConfirm(report._id)}
                            style={actionBtn('#ef4444', '#7f1d1d')}
                          >
                            Yes, delete
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            style={actionBtn('#475569', '#1e293b')}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {/* Download */}
                          <button
                            onClick={() => handleDownload(report)}
                            disabled={downloadingId === report._id}
                            title={`Download ${report.fileName}`}
                            style={actionBtn('#6366f1', '#3730a3')}
                          >
                            {downloadingId === report._id ? '…' : '⬇ Download'}
                          </button>

                          {/* Delete trigger */}
                          <button
                            onClick={() => setConfirmDeleteId(report._id)}
                            disabled={isDeleting}
                            title="Delete this report"
                            style={actionBtn('#64748b', '#334155')}
                          >
                            {isDeleting ? '…' : '🗑 Delete'}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const cell = {
  padding: '0.55rem 0.75rem',
  borderBottom: '1px solid rgba(30,41,59,0.8)',
  verticalAlign: 'middle',
};

const actionBtn = (bg, hoverBg) => ({
  background: `linear-gradient(135deg, ${bg}, ${hoverBg})`,
  border: 'none',
  color: '#fff',
  borderRadius: 7,
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: '0.78rem',
  fontWeight: 600,
  transition: 'opacity 0.2s',
  lineHeight: 1.4,
});

export default ReportHistoryPanel;
