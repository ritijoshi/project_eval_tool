import React, { useState, useMemo } from 'react';
import {
  ExternalLink,
  Search,
  Filter,
  ArrowUpDown,
  ChevronRight,
  Github,
  Award,
  Layers,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import ProjectHealthBadge from './ProjectHealthBadge';

export const ProjectResultsTable = ({
  results = [],
  loading = false,
  onSelectProject,
  emptyMessage = 'No project evaluation results to display yet.',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [healthFilter, setHealthFilter] = useState('ALL');
  const [sortField, setSortField] = useState('overallScore'); // 'overallScore' | 'requirementCoverage' | 'identifier'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc' | 'desc'

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const filteredAndSortedResults = useMemo(() => {
    if (!Array.isArray(results)) return [];

    let list = results.filter((r) => {
      if (!r) return false;

      // Health status filter
      if (healthFilter !== 'ALL') {
        const h = String(r.healthStatus || 'UNKNOWN').toUpperCase();
        if (h !== healthFilter) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const ident = String(r.identifier || '').toLowerCase();
        const team = String(r.teamName || '').toLowerCase();
        const repo = String(r.repoUrl || '').toLowerCase();
        if (!ident.includes(q) && !team.includes(q) && !repo.includes(q)) {
          return false;
        }
      }

      return true;
    });

    // Sorting
    list.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (sortOrder === 'asc') {
        return valA > valB ? 1 : -1;
      }
      return valA < valB ? 1 : -1;
    });

    return list;
  }, [results, healthFilter, searchQuery, sortField, sortOrder]);

  if (loading) {
    return (
      <div
        style={{
          borderRadius: 14,
          background: 'rgba(15,23,42,0.85)',
          border: '1px solid rgba(99,102,241,0.2)',
          padding: '3rem 1.5rem',
          textAlign: 'center',
          color: '#94a3b8',
        }}
      >
        <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto 12px', color: '#818cf8' }} />
        <p style={{ margin: 0, fontSize: '0.9rem', color: '#cbd5e1' }}>Loading project evaluation results…</p>
      </div>
    );
  }

  if (!results || results.length === 0) {
    return (
      <div
        style={{
          borderRadius: 14,
          background: 'rgba(15,23,42,0.85)',
          border: '1px solid rgba(99,102,241,0.2)',
          padding: '3rem 1.5rem',
          textAlign: 'center',
          color: '#64748b',
        }}
      >
        <Layers size={36} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
        <p style={{ margin: '0 0 4px', fontSize: '0.92rem', color: '#94a3b8' }}>{emptyMessage}</p>
        <p style={{ margin: 0, fontSize: '0.78rem' }}>
          Start an evaluation session above to inspect scores, repository evidence, and health status.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        borderRadius: 14,
        background: 'rgba(15,23,42,0.9)',
        border: '1px solid rgba(99,102,241,0.2)',
        overflow: 'hidden',
      }}
      className="shadow-xl"
    >
      {/* Table Toolbar */}
      <div
        style={{
          padding: '1rem 1.25rem',
          background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(168,85,247,0.05))',
          borderBottom: '1px solid rgba(99,102,241,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        {/* Search */}
        <div style={{ position: 'relative', minWidth: 240, flex: 1, maxWidth: 360 }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#64748b',
            }}
          />
          <input
            type="text"
            className="glass-input"
            placeholder="Search team, student, or repo…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', paddingLeft: '2rem', fontSize: '0.8rem', padding: '0.45rem 0.6rem 0.45rem 2rem' }}
          />
        </div>

        {/* Filter & Result Count */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Filter size={14} style={{ color: '#818cf8' }} />
            <select
              className="glass-input"
              value={healthFilter}
              onChange={(e) => setHealthFilter(e.target.value)}
              style={{ fontSize: '0.78rem', padding: '0.4rem 0.65rem' }}
            >
              <option value="ALL">All Health Statuses</option>
              <option value="ON_TRACK">On Track</option>
              <option value="AT_RISK">At Risk</option>
              <option value="BEHIND">Behind</option>
            </select>
          </div>

          <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
            Showing <strong style={{ color: '#f1f5f9' }}>{filteredAndSortedResults.length}</strong> of {results.length} projects
          </span>
        </div>
      </div>

      {/* Table Element */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', color: '#cbd5e1' }}>
          <thead>
            <tr
              style={{
                background: 'rgba(30,41,59,0.7)',
                borderBottom: '1px solid rgba(99,102,241,0.2)',
                color: '#94a3b8',
                fontSize: '0.74rem',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                textAlign: 'left',
              }}
            >
              <th style={{ padding: '0.75rem 1rem', width: 60 }}>Rank</th>
              <th
                onClick={() => handleSort('identifier')}
                style={{ padding: '0.75rem 1rem', cursor: 'pointer', userSelect: 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Team / Project <ArrowUpDown size={11} />
                </div>
              </th>
              <th style={{ padding: '0.75rem 1rem' }}>Repository</th>
              <th
                onClick={() => handleSort('overallScore')}
                style={{ padding: '0.75rem 1rem', cursor: 'pointer', userSelect: 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Score <ArrowUpDown size={11} />
                </div>
              </th>
              <th style={{ padding: '0.75rem 1rem' }}>Grade</th>
              <th
                onClick={() => handleSort('requirementCoverage')}
                style={{ padding: '0.75rem 1rem', cursor: 'pointer', userSelect: 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Coverage <ArrowUpDown size={11} />
                </div>
              </th>
              <th style={{ padding: '0.75rem 1rem' }}>Health Status</th>
              <th style={{ padding: '0.75rem 1rem' }}>Badges</th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedResults.map((r, idx) => {
              const isFailed = r.evaluationStatus === 'FAILED';
              const rankDisplay = isFailed ? '—' : idx + 1;
              const coverage = typeof r.requirementCoverage === 'number' ? Math.round(r.requirementCoverage) : 0;

              return (
                <tr
                  key={r._id || idx}
                  onClick={() => onSelectProject && onSelectProject(r)}
                  style={{
                    borderBottom: '1px solid rgba(99,102,241,0.1)',
                    background: idx % 2 === 0 ? 'transparent' : 'rgba(30,41,59,0.35)',
                    cursor: onSelectProject ? 'pointer' : 'default',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(99,102,241,0.08)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(30,41,59,0.35)';
                  }}
                >
                  {/* Rank */}
                  <td style={{ padding: '0.85rem 1rem', fontWeight: 600, color: '#94a3b8' }}>
                    {rankDisplay === 1 ? '🥇' : rankDisplay === 2 ? '🥈' : rankDisplay === 3 ? '🥉' : `#${rankDisplay}`}
                  </td>

                  {/* Team / Identifier */}
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ fontWeight: 600, color: '#f8fafc' }}>
                      {r.teamName || r.identifier || 'Project'}
                    </div>
                    {r.identifier && (
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        ID: {r.identifier}
                      </div>
                    )}
                  </td>

                  {/* Repo Link */}
                  <td style={{ padding: '0.85rem 1rem' }} onClick={(e) => e.stopPropagation()}>
                    {r.repoUrl ? (
                      <a
                        href={r.repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: '#818cf8',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          textDecoration: 'none',
                          fontSize: '0.76rem',
                        }}
                      >
                        <Github size={13} />
                        <span>{r.repoName || (r.repoOwner ? `${r.repoOwner}/${r.repoName}` : 'GitHub Repo')}</span>
                        <ExternalLink size={11} style={{ opacity: 0.7 }} />
                      </a>
                    ) : (
                      <span style={{ color: '#64748b' }}>—</span>
                    )}
                  </td>

                  {/* Score */}
                  <td style={{ padding: '0.85rem 1rem' }}>
                    {isFailed ? (
                      <span style={{ color: '#f87171', fontWeight: 600, fontSize: '0.78rem' }}>FAILED</span>
                    ) : (
                      <div>
                        <span style={{ color: '#4ade80', fontWeight: 700, fontSize: '0.92rem' }}>
                          {r.overallScore ?? 0}
                        </span>
                        <span style={{ color: '#64748b', fontSize: '0.72rem' }}>
                          /{r.maxScore || 100}
                        </span>
                      </div>
                    )}
                  </td>

                  {/* Grade */}
                  <td style={{ padding: '0.85rem 1rem' }}>
                    {r.gradeLabel ? (
                      <span
                        style={{
                          padding: '2px 7px',
                          borderRadius: 6,
                          background: 'rgba(99,102,241,0.14)',
                          color: '#c084fc',
                          fontWeight: 700,
                          fontSize: '0.78rem',
                        }}
                      >
                        {r.gradeLabel}
                      </span>
                    ) : (
                      <span style={{ color: '#64748b' }}>—</span>
                    )}
                  </td>

                  {/* Requirement Coverage */}
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div
                        style={{
                          width: 48,
                          height: 6,
                          borderRadius: 3,
                          background: 'rgba(30,41,59,0.8)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${coverage}%`,
                            height: '100%',
                            background: coverage >= 70 ? '#10b981' : coverage >= 40 ? '#f59e0b' : '#ef4444',
                            borderRadius: 3,
                          }}
                        />
                      </div>
                      <span style={{ fontSize: '0.76rem', color: '#cbd5e1' }}>{coverage}%</span>
                    </div>
                  </td>

                  {/* Health Status */}
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <ProjectHealthBadge healthStatus={r.healthStatus} size="xs" />
                  </td>

                  {/* Badges */}
                  <td style={{ padding: '0.85rem 1rem' }}>
                    {Array.isArray(r.badges) && r.badges.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {r.badges.slice(0, 2).map((b, bIdx) => {
                          const label = typeof b === 'string' ? b : b?.label || 'Badge';
                          return (
                            <span
                              key={bIdx}
                              style={{
                                background: 'rgba(99,102,241,0.12)',
                                border: '1px solid rgba(99,102,241,0.25)',
                                color: '#a5b4fc',
                                borderRadius: 10,
                                padding: '1px 6px',
                                fontSize: '0.68rem',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span style={{ color: '#64748b', fontSize: '0.75rem' }}>—</span>
                    )}
                  </td>

                  {/* Action */}
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onSelectProject) onSelectProject(r);
                      }}
                      style={{
                        background: 'rgba(99,102,241,0.15)',
                        border: '1px solid rgba(99,102,241,0.3)',
                        color: '#818cf8',
                        borderRadius: 8,
                        padding: '3px 8px',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2,
                      }}
                    >
                      View <ChevronRight size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ProjectResultsTable;
