import React, { useState } from 'react';
import './UploadPanel.css'; // Expect standard Dashboard styles

export default function UploadPanel({ onStartEvaluation }) {
  const [transcript, setTranscript] = useState(null);
  const [zip, setZip] = useState(null);
  const [lectureTopic, setLectureTopic] = useState('');
  const [error, setError] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const handleTranscriptChange = (e) => {
      const file = e.target.files[0];
      if (file && !file.name.endsWith('.txt') && !file.name.endsWith('.vtt')) {
          setError('Transcript must be a .vtt or .txt file');
          setTranscript(null);
          return;
      }
      setError('');
      setTranscript(file);
  };

  const handleZipChange = (e) => {
      const file = e.target.files[0];
      if (file && !file.name.endsWith('.zip')) {
          setError('Student submissions must be a .zip file');
          setZip(null);
          return;
      }
      
      // Basic 50MB safeguard
      if (file && file.size > 50 * 1024 * 1024) {
          setError('ZIP file exceeds 50MB limit.');
          setZip(null);
          return;
      }

      setError('');
      setZip(file);
  };

  const handleSubmit = async (e) => {
      e.preventDefault();
      if (!transcript || !zip) {
          setError('Please provide both the transcript and the student zip file.');
          return;
      }

      setIsUploading(true);
      try {
          await onStartEvaluation(lectureTopic, transcript, zip);
      } catch (err) {
          setError(err.response?.data?.message || err.message || 'Upload failed');
          setIsUploading(false);
      }
  };

  return (
      <div className="upload-panel card">
          <h3>New Lecture Evaluation</h3>
          {error && <div className="error-banner">{error}</div>}
          
          <form onSubmit={handleSubmit} className="upload-form">
              <div className="form-group">
                  <label>Lecture Topic / Focus (Optional)</label>
                  <input 
                      type="text" 
                      placeholder="e.g. Introduction to Machine Learning"
                      value={lectureTopic}
                      onChange={(e) => setLectureTopic(e.target.value)}
                  />
              </div>

              <div className="form-group">
                  <label>Lecture Transcript (.vtt, .txt)</label>
                  <input 
                      type="file" 
                      accept=".vtt,.txt" 
                      onChange={handleTranscriptChange}
                      disabled={isUploading}
                  />
              </div>

              <div className="form-group">
                  <label>Student Submissions (.zip)</label>
                  <input 
                      type="file" 
                      accept=".zip" 
                      onChange={handleZipChange}
                      disabled={isUploading}
                  />
              </div>

              <button 
                  type="submit" 
                  className="btn-primary" 
                  disabled={!transcript || !zip || isUploading}
              >
                  {isUploading ? 'Initializing Cloud Job...' : 'Start AI Evaluation'}
              </button>
          </form>
      </div>
  );
}
