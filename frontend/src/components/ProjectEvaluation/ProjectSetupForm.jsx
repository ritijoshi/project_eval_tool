import React, { useState, useEffect } from 'react';
import {
  Upload,
  Plus,
  Trash2,
  FolderGit2,
  Github,
  Play,
  AlertCircle,
  FileText,
  Layers,
  Sparkles,
  ClipboardList,
} from 'lucide-react';
import { startProjectEval } from '../../services/projectEvalApi';
import { useActiveCourse } from '../../context/ActiveCourseContext';

export const ProjectSetupForm = ({ onSessionCreated, courseId: propCourseId }) => {
  const { courses, activeCourseId } = useActiveCourse();

  // Basic Information
  const [selectedCourseId, setSelectedCourseId] = useState(propCourseId || activeCourseId || '');
  const [sessionLabel, setSessionLabel] = useState('');
  const [projectGoal, setProjectGoal] = useState('');
  const [projectType, setProjectType] = useState('individual'); // 'individual' | 'team'
  const [mode, setMode] = useState('batch'); // 'batch' | 'individual'
  const [totalMaxScore, setTotalMaxScore] = useState(100);

  // Rubric
  const [rubricFile, setRubricFile] = useState(null);
  const [rubricCriteriaText, setRubricCriteriaText] = useState('');
  const [useCustomCriteria, setUseCustomCriteria] = useState(false);

  // Technical Requirements & Milestones
  const [techRequirements, setTechRequirements] = useState('');
  const [weeklyDocFile, setWeeklyDocFile] = useState(null);

  // Repositories
  const [repoLinks, setRepoLinks] = useState([
    { url: '', identifier: '', teamName: '' },
  ]);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkUrlText, setBulkUrlText] = useState('');

  // Submission State
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (propCourseId) {
      setSelectedCourseId(propCourseId);
    } else if (activeCourseId && activeCourseId !== 'all') {
      setSelectedCourseId(activeCourseId);
    }
  }, [propCourseId, activeCourseId]);

  // Adjust repos when toggling between individual and batch
  const handleModeChange = (newMode) => {
    setMode(newMode);
    if (newMode === 'individual') {
      setRepoLinks((prev) => [prev[0] || { url: '', identifier: '', teamName: '' }]);
      setBulkMode(false);
    }
  };

  const handleAddRepoRow = () => {
    setRepoLinks((prev) => [...prev, { url: '', identifier: '', teamName: '' }]);
  };

  const handleRemoveRepoRow = (index) => {
    setRepoLinks((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRepoChange = (index, field, value) => {
    setRepoLinks((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleApplyBulkUrls = () => {
    const lines = bulkUrlText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const parsed = lines.map((line, i) => {
      // Support comma or whitespace separated: URL, Identifier, TeamName
      const parts = line.split(/[,\t]/).map((p) => p.trim());
      const url = parts[0] || '';
      const identifier = parts[1] || `project-${i + 1}`;
      const teamName = parts[2] || identifier;
      return { url, identifier, teamName };
    });

    if (parsed.length > 0) {
      setRepoLinks(parsed);
      setBulkMode(false);
      setBulkUrlText('');
    }
  };

  const validate = () => {
    if (!selectedCourseId || selectedCourseId === 'all') {
      return 'Please select a specific course for this evaluation.';
    }
    if (!projectGoal.trim()) {
      return 'Please enter a project goal or summary.';
    }
    if (!rubricFile && !rubricCriteriaText.trim()) {
      return 'Please provide a rubric file (.pdf, .docx, .txt, .md) or specify rubric criteria.';
    }

    const validRepos = repoLinks.filter((r) => r.url.trim().length > 0);
    if (validRepos.length === 0) {
      return 'Please enter at least one repository link.';
    }

    for (const r of validRepos) {
      if (!/^https?:\/\/(www\.)?github\.com\//i.test(r.url.trim())) {
        return `Invalid GitHub URL: "${r.url}". Must be a valid github.com link.`;
      }
    }

    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }

    setSubmitting(true);

    try {
      const activeRepos = repoLinks
        .filter((r) => r.url.trim())
        .map((r, idx) => ({
          url: r.url.trim(),
          identifier: r.identifier.trim() || `project-${idx + 1}`,
          teamName: r.teamName.trim() || (projectType === 'team' ? `Team ${idx + 1}` : `Student ${idx + 1}`),
        }));

      // Parse criteria if provided as custom text
      let parsedCriteria = [];
      if (useCustomCriteria && rubricCriteriaText.trim()) {
        const lines = rubricCriteriaText.split('\n').filter(Boolean);
        parsedCriteria = lines.map((line) => {
          const match = line.match(/^([^:(]+)(?:\(([^)]+)\))?:?(.*)$/);
          if (match) {
            return {
              name: match[1].trim(),
              title: match[1].trim(),
              maxScore: Number(match[2]) || 10,
              description: match[3]?.trim() || '',
            };
          }
          return { name: line.trim(), title: line.trim(), maxScore: 10, description: '' };
        });
      }

      // Parse tech requirements
      const techList = techRequirements
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const payload = {
        courseId: selectedCourseId,
        sessionLabel: sessionLabel.trim() || `${projectType === 'team' ? 'Team' : 'Individual'} Project Evaluation`,
        projectGoal: projectGoal.trim(),
        projectType,
        mode,
        totalMaxScore: Number(totalMaxScore) || 100,
        rubricCriteria: parsedCriteria,
        techRequirements: techList,
        repoLinks: activeRepos,
        rubricFile,
        weeklyDocFile,
      };

      const result = await startProjectEval(payload);

      if (onSessionCreated) {
        onSessionCreated(result);
      }
    } catch (err) {
      console.error('Failed to start project evaluation:', err);
      const msg = err.response?.data?.message || err.message || 'Failed to start evaluation.';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        borderRadius: 16,
        background: 'rgba(17,24,39,0.85)',
        border: '1px solid rgba(99,102,241,0.2)',
        padding: '1.75rem',
        backdropFilter: 'blur(10px)',
      }}
      className="shadow-xl"
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div
            style={{
              padding: '0.5rem',
              borderRadius: 10,
              background: 'rgba(99,102,241,0.15)',
              color: '#818cf8',
            }}
          >
            <FolderGit2 size={22} />
          </div>
          <div>
            <h3 style={{ margin: 0, color: '#f1f5f9', fontSize: '1.1rem', fontWeight: 600 }}>
              Start Project Evaluation
            </h3>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.8rem' }}>
              Configure rubric, milestones, and repositories for automated AI project evaluation
            </p>
          </div>
        </div>

        {/* Mode Toggle Buttons */}
        <div
          style={{
            display: 'flex',
            background: 'rgba(15,23,42,0.8)',
            padding: 3,
            borderRadius: 10,
            border: '1px solid rgba(99,102,241,0.2)',
          }}
        >
          <button
            type="button"
            onClick={() => handleModeChange('batch')}
            style={{
              padding: '4px 12px',
              fontSize: '0.78rem',
              fontWeight: 600,
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              background: mode === 'batch' ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent',
              color: mode === 'batch' ? '#ffffff' : '#94a3b8',
              transition: 'all 0.2s',
            }}
          >
            Batch Mode
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('individual')}
            style={{
              padding: '4px 12px',
              fontSize: '0.78rem',
              fontWeight: 600,
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              background: mode === 'individual' ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent',
              color: mode === 'individual' ? '#ffffff' : '#94a3b8',
              transition: 'all 0.2s',
            }}
          >
            Single Project
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1.25rem' }}>
        {/* Row 1: Course Selection, Session Label, Project Type */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: '0.82rem', fontWeight: 500 }}>
              Course <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              className="glass-input"
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              style={{ width: '100%', padding: '0.55rem 0.75rem' }}
              disabled={submitting}
            >
              <option value="">Select course…</option>
              {courses.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.title || c.courseCode} ({c.courseCode || 'Course'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: '0.82rem', fontWeight: 500 }}>
              Session Label (optional)
            </label>
            <input
              type="text"
              className="glass-input"
              placeholder="e.g. Capstone Milestone 1"
              value={sessionLabel}
              onChange={(e) => setSessionLabel(e.target.value)}
              style={{ width: '100%', padding: '0.55rem 0.75rem' }}
              disabled={submitting}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: '0.82rem', fontWeight: 500 }}>
              Project Type
            </label>
            <select
              className="glass-input"
              value={projectType}
              onChange={(e) => setProjectType(e.target.value)}
              style={{ width: '100%', padding: '0.55rem 0.75rem' }}
              disabled={submitting}
            >
              <option value="individual">Individual Project</option>
              <option value="team">Team / Group Project</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: '0.82rem', fontWeight: 500 }}>
              Total Max Score
            </label>
            <input
              type="number"
              min="10"
              max="1000"
              className="glass-input"
              value={totalMaxScore}
              onChange={(e) => setTotalMaxScore(Number(e.target.value) || 100)}
              style={{ width: '100%', padding: '0.55rem 0.75rem' }}
              disabled={submitting}
            />
          </div>
        </div>

        {/* Row 2: Project Goal & Tech Requirements */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: '0.82rem', fontWeight: 500 }}>
              Project Goal / Description <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <textarea
              className="glass-input"
              placeholder="Describe the expected goals, problem statement, and key deliverables of this project..."
              value={projectGoal}
              onChange={(e) => setProjectGoal(e.target.value)}
              rows={2}
              style={{ width: '100%', padding: '0.55rem 0.75rem', resize: 'vertical' }}
              disabled={submitting}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: '0.82rem', fontWeight: 500 }}>
              Tech Requirements (comma-separated)
            </label>
            <input
              type="text"
              className="glass-input"
              placeholder="e.g. React, Node.js, MongoDB"
              value={techRequirements}
              onChange={(e) => setTechRequirements(e.target.value)}
              style={{ width: '100%', padding: '0.55rem 0.75rem' }}
              disabled={submitting}
            />
          </div>
        </div>

        {/* Row 3: Rubric & Weekly Progress Files */}
        <div
          style={{
            padding: '1rem',
            borderRadius: 12,
            background: 'rgba(15,23,42,0.6)',
            border: '1px solid rgba(99,102,241,0.15)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1rem',
          }}
        >
          {/* Rubric File Upload */}
          <div>
            <span style={{ display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: '0.82rem', fontWeight: 500 }}>
              📄 Rubric Document (.pdf, .docx, .txt, .md)
            </span>
            <div
              style={{
                border: '1px dashed rgba(99,102,241,0.35)',
                borderRadius: 8,
                padding: '0.75rem',
                textAlign: 'center',
                background: 'rgba(99,102,241,0.04)',
                cursor: 'pointer',
              }}
            >
              <input
                type="file"
                id="rubric-upload-input"
                accept=".pdf,.docx,.txt,.md"
                onChange={(e) => setRubricFile(e.target.files?.[0] || null)}
                style={{ display: 'none' }}
                disabled={submitting}
              />
              <label htmlFor="rubric-upload-input" style={{ cursor: 'pointer', display: 'block' }}>
                <Upload size={18} style={{ margin: '0 auto 4px', color: '#818cf8' }} />
                <span style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                  {rubricFile ? rubricFile.name : 'Choose Rubric File'}
                </span>
              </label>
            </div>
            {rubricFile && (
              <span style={{ display: 'block', marginTop: 4, fontSize: '0.75rem', color: '#4ade80' }}>
                ✓ Selected: {rubricFile.name} ({(rubricFile.size / 1024).toFixed(1)} KB)
              </span>
            )}
          </div>

          {/* Weekly Progress Report Upload */}
          <div>
            <span style={{ display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: '0.82rem', fontWeight: 500 }}>
              📅 Weekly Progress Template / Doc (.pdf, .docx, .txt) (optional)
            </span>
            <div
              style={{
                border: '1px dashed rgba(168,85,247,0.35)',
                borderRadius: 8,
                padding: '0.75rem',
                textAlign: 'center',
                background: 'rgba(168,85,247,0.04)',
                cursor: 'pointer',
              }}
            >
              <input
                type="file"
                id="weekly-upload-input"
                accept=".pdf,.docx,.txt"
                onChange={(e) => setWeeklyDocFile(e.target.files?.[0] || null)}
                style={{ display: 'none' }}
                disabled={submitting}
              />
              <label htmlFor="weekly-upload-input" style={{ cursor: 'pointer', display: 'block' }}>
                <FileText size={18} style={{ margin: '0 auto 4px', color: '#c084fc' }} />
                <span style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                  {weeklyDocFile ? weeklyDocFile.name : 'Choose Weekly Progress File'}
                </span>
              </label>
            </div>
            {weeklyDocFile && (
              <span style={{ display: 'block', marginTop: 4, fontSize: '0.75rem', color: '#4ade80' }}>
                ✓ Selected: {weeklyDocFile.name} ({(weeklyDocFile.size / 1024).toFixed(1)} KB)
              </span>
            )}
          </div>
        </div>

        {/* Optional Custom Rubric Criteria Section */}
        <div>
          <button
            type="button"
            onClick={() => setUseCustomCriteria(!useCustomCriteria)}
            style={{
              background: 'none',
              border: 'none',
              color: '#818cf8',
              fontSize: '0.8rem',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Sparkles size={14} />
            {useCustomCriteria ? 'Hide custom criteria overrides' : 'Configure custom rubric criteria lines'}
          </button>
          {useCustomCriteria && (
            <div style={{ marginTop: '0.5rem' }}>
              <textarea
                className="glass-input"
                placeholder={'Architecture (20): Clean modularity and layer separation\nCode Quality (20): PEP8 standards and meaningful naming\nTesting (20): Unit test coverage and test suite passing'}
                value={rubricCriteriaText}
                onChange={(e) => setRubricCriteriaText(e.target.value)}
                rows={3}
                style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.8rem' }}
                disabled={submitting}
              />
            </div>
          )}
        </div>

        {/* Row 4: Repositories Input */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <label style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600 }}>
              Repositories to Evaluate <span style={{ color: '#ef4444' }}>*</span>
            </label>
            {mode === 'batch' && (
              <button
                type="button"
                onClick={() => setBulkMode(!bulkMode)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <ClipboardList size={13} />
                {bulkMode ? 'Row-by-row mode' : 'Bulk paste URLs'}
              </button>
            )}
          </div>

          {bulkMode && mode === 'batch' ? (
            <div
              style={{
                padding: '0.75rem',
                borderRadius: 10,
                background: 'rgba(15,23,42,0.9)',
                border: '1px solid rgba(99,102,241,0.2)',
              }}
            >
              <p style={{ margin: '0 0 6px', color: '#94a3b8', fontSize: '0.75rem' }}>
                Paste one GitHub URL per line (e.g. <code>https://github.com/user/repo, Student1, TeamAlpha</code>):
              </p>
              <textarea
                className="glass-input"
                rows={4}
                placeholder="https://github.com/org/repo-1, roll-101, Alpha&#10;https://github.com/org/repo-2, roll-102, Beta"
                value={bulkUrlText}
                onChange={(e) => setBulkUrlText(e.target.value)}
                style={{ width: '100%', fontSize: '0.8rem', padding: '0.5rem' }}
              />
              <button
                type="button"
                onClick={handleApplyBulkUrls}
                className="btn-secondary"
                style={{ marginTop: 6, fontSize: '0.75rem', padding: '4px 12px' }}
              >
                Apply URLs
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              {repoLinks.map((repo, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: mode === 'batch' ? '3fr 1.5fr 1.5fr auto' : '3fr 1.5fr 1.5fr',
                    gap: '0.5rem',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ position: 'relative' }}>
                    <Github
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
                      type="url"
                      className="glass-input"
                      placeholder="https://github.com/owner/repository"
                      value={repo.url}
                      onChange={(e) => handleRepoChange(idx, 'url', e.target.value)}
                      style={{ width: '100%', paddingLeft: '2rem' }}
                      disabled={submitting}
                    />
                  </div>

                  <input
                    type="text"
                    className="glass-input"
                    placeholder="Roll No / Student ID"
                    value={repo.identifier}
                    onChange={(e) => handleRepoChange(idx, 'identifier', e.target.value)}
                    disabled={submitting}
                  />

                  <input
                    type="text"
                    className="glass-input"
                    placeholder="Team / Project Name"
                    value={repo.teamName}
                    onChange={(e) => handleRepoChange(idx, 'teamName', e.target.value)}
                    disabled={submitting}
                  />

                  {mode === 'batch' && repoLinks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveRepoRow(idx)}
                      style={{
                        background: 'rgba(239,68,68,0.1)',
                        border: '1px solid rgba(239,68,68,0.3)',
                        color: '#f87171',
                        borderRadius: 8,
                        padding: '0.45rem',
                        cursor: 'pointer',
                      }}
                      title="Remove repository"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}

              {mode === 'batch' && (
                <button
                  type="button"
                  onClick={handleAddRepoRow}
                  style={{
                    background: 'rgba(99,102,241,0.08)',
                    border: '1px dashed rgba(99,102,241,0.3)',
                    color: '#818cf8',
                    borderRadius: 8,
                    padding: '0.45rem 1rem',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    justifyContent: 'center',
                    marginTop: 4,
                  }}
                  disabled={submitting}
                >
                  <Plus size={14} /> Add Another Repository
                </button>
              )}
            </div>
          )}
        </div>

        {/* Error Banner */}
        {formError && (
          <div
            style={{
              padding: '0.65rem 0.9rem',
              borderRadius: 8,
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#f87171',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertCircle size={16} />
            <span>{formError}</span>
          </div>
        )}

        {/* Submit Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="submit"
            className="btn-primary"
            disabled={submitting}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0.65rem 1.6rem',
              fontSize: '0.88rem',
              fontWeight: 600,
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? (
              <>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    border: '2px solid #ffffff',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }}
                />
                Starting Evaluation…
              </>
            ) : (
              <>
                <Play size={16} /> Start Project Evaluation
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ProjectSetupForm;
