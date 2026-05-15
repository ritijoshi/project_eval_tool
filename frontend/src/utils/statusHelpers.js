export const getStatusConfig = (status) => {
  const configs = {
      UPLOADED: {
          label: 'Uploading Files',
          color: 'var(--accent-blue, #3b82f6)',
          icon: '☁️',
          pulse: true
      },
      EXTRACTING: {
          label: 'Extracting ZIP securely',
          color: 'var(--accent-indigo, #6366f1)',
          icon: '📦',
          pulse: true
      },
      ANALYZING_TRANSCRIPT: {
          label: 'AI reading Transcript',
          color: 'var(--accent-purple, #8b5cf6)',
          icon: '🧠',
          pulse: true
      },
      EVALUATING: {
          label: 'Grading Students',
          color: 'var(--accent-orange, #f59e0b)',
          icon: '⚖️',
          pulse: true
      },
      COMPLETED: {
          label: 'Evaluation Complete',
          color: 'var(--success-color, #10b981)',
          icon: '✅',
          pulse: false
      },
      FAILED: {
          label: 'Evaluation Failed',
          color: 'var(--error-color, #ef4444)',
          icon: '❌',
          pulse: false
      },
      PENDING: {
          label: 'Waiting...',
          color: 'var(--text-muted, #9ca3af)',
          icon: '⏳',
          pulse: false
      }
  };

  return configs[status] || configs.PENDING;
};

export const getScoreColor = (score) => {
  if (score >= 9) return 'var(--success-color, #10b981)'; // Green
  if (score >= 7) return 'var(--accent-blue, #3b82f6)';    // Blue
  if (score >= 5) return 'var(--warning-color, #f59e0b)';  // Yellow
  return 'var(--error-color, #ef4444)';                    // Red
};
