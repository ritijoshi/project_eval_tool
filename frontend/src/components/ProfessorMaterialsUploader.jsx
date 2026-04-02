import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../config/api';

function fileAccepts(file) {
  const name = (file?.name || '').toLowerCase();
  return (
    name.endsWith('.pdf') ||
    name.endsWith('.docx') ||
    name.endsWith('.pptx') ||
    name.endsWith('.mp3') ||
    name.endsWith('.wav') ||
    name.endsWith('.m4a')
  );
}

function normalizeCourseKey(courseKey) {
  return String(courseKey || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function ProfessorMaterialsUploader({ onUploaded }) {
  const [courseKeyInput, setCourseKeyInput] = useState('');
  const courseKey = useMemo(() => normalizeCourseKey(courseKeyInput), [courseKeyInput]);

  const [existingCourses, setExistingCourses] = useState([]);
  const [coursesLoading, setCoursesLoading] = useState(false);

  const [teachingStyle, setTeachingStyle] = useState('');

  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState([]); // { id, file }
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const fileInputRef = useRef(null);

  const token = localStorage.getItem('token');

  useEffect(() => {
    setError('');
    setProgress(0);
  }, [courseKey]);

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        setCoursesLoading(true);
        const config = { headers: { Authorization: `Bearer ${token}` } };
        const res = await axios.get(`${API_BASE}/api/professor/courses`, config);
        setExistingCourses(res.data?.courses || []);
      } catch (err) {
        setExistingCourses([]);
      } finally {
        setCoursesLoading(false);
      }
    };
    if (token) fetchCourses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acceptHint = 'PDF, DOCX, PPTX, MP3/WAV/M4A';

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const valid = incoming.filter(fileAccepts);
    const invalid = incoming.filter((f) => !fileAccepts(f));

    if (invalid.length) {
      setError(`Some files were skipped (unsupported types). Accepted: ${acceptHint}.`);
    } else {
      setError('');
    }

    const mapped = valid.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      file,
    }));

    setFiles((prev) => {
      const seen = new Set(prev.map((x) => x.id));
      const merged = [...prev];
      mapped.forEach((m) => {
        if (!seen.has(m.id)) merged.push(m);
      });
      return merged;
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    addFiles(e.dataTransfer?.files);
  };

  const handleChoose = () => fileInputRef.current?.click();

  const handleUpload = async () => {
    setError('');
    setSuccessMsg('');

    if (!courseKey) {
      setError('Please enter a course_key (e.g., cs501-modern-web-dev).');
      return;
    }

    if (!teachingStyle.trim()) {
      setError('Please provide teaching style guidelines.');
      return;
    }

    if (!files.length) {
      setError('Drag files into the drop zone (or click to select) before uploading.');
      return;
    }

    setIsUploading(true);
    setProgress(0);

    try {
      const form = new FormData();
      form.append('course_key', courseKey);
      form.append('teaching_style', teachingStyle);

      files.forEach(({ file }) => {
        form.append('files', file);
      });

      const config = {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (evt) => {
          if (!evt.total) return;
          const percent = Math.round((evt.loaded / evt.total) * 100);
          setProgress(Math.min(100, percent));
        },
      };

      const res = await axios.post(`${API_BASE}/api/professor/materials`, form, config);

      setFiles([]);
      setProgress(100);
      setSuccessMsg(res.data?.message || 'Course materials processed successfully.');
      setTimeout(() => setSuccessMsg(''), 2500);
      if (onUploaded) onUploaded(res.data);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="pmu-wrap animate-fade-in">
      <div className="pmu-topline">
        <h2 className="pmu-title">Course Materials Ingestion</h2>
        <p className="pmu-subtitle text-muted">
          Drag-and-drop materials to train a course-aware assistant that mimics the professor’s teaching style.
        </p>
      </div>

      <div className="pmu-grid">
        <div className="pmu-card">
          <label className="pmu-label">Course Key</label>
          <input
            className="glass-input pmu-input"
            value={courseKeyInput}
            onChange={(e) => setCourseKeyInput(e.target.value)}
            placeholder="e.g., cs501-modern-web-dev"
            list="pmu-course-list"
          />
          <datalist id="pmu-course-list">
            {!coursesLoading &&
              existingCourses.map((c) => (
                <option key={c} value={c} />
              ))}
          </datalist>
          <div className="pmu-help text-muted">Used to create a dedicated vector index for this course.</div>
        </div>

        <div className="pmu-card">
          <label className="pmu-label">Teaching Style Guidelines</label>
          <textarea
            className="glass-input pmu-textarea"
            value={teachingStyle}
            onChange={(e) => setTeachingStyle(e.target.value)}
            placeholder="Tone, explanation style, examples, pacing, do/don't..."
          />
        </div>
      </div>

      <div
        className={`pmu-dropzone ${dragActive ? 'pmu-dropzone--active' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleChoose();
        }}
        onClick={handleChoose}
        aria-label="Drag and drop course files"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.pptx,.mp3,.wav,.m4a"
          style={{ display: 'none' }}
          onChange={(e) => addFiles(e.target.files)}
        />

        <div className="pmu-dropzone-inner">
          <div className="pmu-dropzone-title">
            Drop files here or click to browse
          </div>
          <div className="pmu-dropzone-hint text-muted">{acceptHint}</div>
        </div>
      </div>

      {files.length > 0 && (
        <div className="pmu-files">
          {files.map(({ id, file }, idx) => (
            <div className="pmu-file-row" key={id}>
              <div className="pmu-file-rank">{idx + 1}</div>
              <div className="pmu-file-name">{file.name}</div>
              <div className="pmu-file-size text-muted">{Math.round(file.size / 1024)} KB</div>
            </div>
          ))}
        </div>
      )}

      {successMsg && (
        <div className="auth-alert auth-alert--success" style={{ marginTop: 14 }}>
          {successMsg}
        </div>
      )}
      {error && <div className="auth-alert auth-alert--error" style={{ marginTop: 14 }}>{error}</div>}

      <div className="pmu-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setFiles([]);
            setError('');
          }}
          disabled={isUploading}
          style={{ minWidth: 160 }}
        >
          Clear
        </button>

        <button
          type="button"
          className="btn-primary"
          onClick={handleUpload}
          disabled={isUploading}
          style={{ minWidth: 220 }}
        >
          {isUploading ? `Uploading... ${progress}%` : 'Process & Train'}
        </button>
      </div>

      {isUploading && (
        <div className="pmu-progress">
          <div className="pmu-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

