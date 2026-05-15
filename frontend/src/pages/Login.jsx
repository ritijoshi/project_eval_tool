import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE } from '../config/api';

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" className="auth-password-icon" aria-hidden="true">
    <path
      d="M2.5 12S6 5.5 12 5.5S21.5 12 21.5 12S18 18.5 12 18.5S2.5 12 2.5 12Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" className="auth-password-icon" aria-hidden="true">
    <path
      d="M3 3L21 21"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10.6 5.7C11.05 5.57 11.52 5.5 12 5.5C18 5.5 21.5 12 21.5 12C21.08 12.74 20.56 13.43 19.96 14.04"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M14.12 14.12C13.58 14.66 12.83 15 12 15C10.34 15 9 13.66 9 12C9 11.17 9.34 10.42 9.88 9.88"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M6.02 6.02C4.63 7.04 3.45 8.39 2.5 12C2.5 12 6 18.5 12 18.5C13.62 18.5 15.03 18.03 16.24 17.31"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Login = () => {
  const navigate = useNavigate();

  const [role, setRole] = useState('student'); // student | professor
  const [authMode, setAuthMode] = useState('login'); // login | signup

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const roleLabel = useMemo(
    () => (role === 'student' ? 'Student Access' : 'Faculty Access'),
    [role]
  );

  const authAnimKey = `${role}:${authMode}`;

  useEffect(() => {
    // Keep modal inputs fresh when switching role
    setResetEmail('');
    setNewPassword('');
    setShowNewPassword(false);
    setError('');
    setSuccessMsg('');
  }, [role]);

  useEffect(() => {
    setShowPassword(false);
    setError('');
  }, [authMode]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    try {
      const endpointRoot = role === 'student' ? '/api/auth/student' : '/api/auth/professor';
      const endpoint = authMode === 'login' ? `${endpointRoot}/login` : `${endpointRoot}/register`;

      const payload =
        authMode === 'login' ? { email, password } : { name, email, password };

      const response = await axios.post(`${API_BASE}${endpoint}`, payload);
      const { token, name: userName, _id, role: userRole } = response.data;

      localStorage.setItem('token', token);
      localStorage.setItem('role', userRole);
      localStorage.setItem(
        'user',
        JSON.stringify({ name: userName, email, role: userRole, _id })
      );

      window.dispatchEvent(new Event('auth-changed'));

      navigate(userRole === 'professor' ? '/professor' : '/student');
    } catch (err) {
      setError(err.response?.data?.message || 'Authentication failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setBusy(true);

    try {
      const endpointRoot = role === 'student' ? '/api/auth/student' : '/api/auth/professor';
      const endpoint = `${endpointRoot}/reset-password`;

      const response = await axios.post(`${API_BASE}${endpoint}`, {
        email: resetEmail || email,
        newPassword,
      });

      setSuccessMsg(response.data.message);
      setTimeout(() => {
        setShowResetModal(false);
        setSuccessMsg('');
        setNewPassword('');
        setResetEmail('');
      }, 1800);
    } catch (err) {
      setError(err.response?.data?.message || 'Reset failed.');
    } finally {
      setBusy(false);
    }
  };

  const submitText =
    authMode === 'login'
      ? `Login to ${role === 'student' ? 'Virtual Classroom' : 'Faculty Dashboard'}`
      : `Create ${role === 'student' ? 'Student' : 'Faculty'} Account`;

  return (
    <div className="auth-page">
      <div className="auth-card glass-panel">
        <div className="auth-header animate-fade-in">
          <h2 className="text-3xl text-center">
            <span className="text-gradient">Agentic Virtual Classroom</span>
          </h2>
          <p className="auth-subtitle text-muted text-center">
            Secure JWT authentication with role-based access control.
          </p>
        </div>

        <div className="auth-role-toggle" data-role={role} aria-label="Role selection">
          <button
            type="button"
            className={`auth-role-btn ${role === 'student' ? 'is-active' : ''}`}
            onClick={() => setRole('student')}
          >
            Student
          </button>
          <button
            type="button"
            className={`auth-role-btn ${role === 'professor' ? 'is-active' : ''}`}
            onClick={() => setRole('professor')}
          >
            Professor
          </button>
          <span className="auth-role-indicator" aria-hidden="true" />
        </div>

        <div className="auth-mode-toggle" data-mode={authMode} aria-label="Login mode">
          <button
            type="button"
            className={`auth-mode-btn ${authMode === 'login' ? 'is-active' : ''}`}
            onClick={() => {
              setAuthMode('login');
              setError('');
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-mode-btn ${authMode === 'signup' ? 'is-active' : ''}`}
            onClick={() => {
              setAuthMode('signup');
              setError('');
            }}
          >
            Create Account
          </button>
          <span className="auth-mode-indicator" aria-hidden="true" />
        </div>

        <div className="auth-anim-wrapper" key={authAnimKey}>
          {error && (
            <div className="auth-alert auth-alert--error" role="alert">
              {error}
            </div>
          )}

          <form className="auth-form" onSubmit={handleAuth}>
            {authMode === 'signup' && (
              <div className="auth-field">
                <label className="text-sm text-muted mb-2 block">Full Name</label>
                <input
                  type="text"
                  className="glass-input"
                  placeholder="Enter your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="auth-field">
              <label className="text-sm text-muted mb-2 block">Email Address</label>
              <input
                type="email"
                className="glass-input"
                placeholder={`Enter your ${role} email`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="auth-field">
              <label className="text-sm text-muted mb-2 block">Password</label>
              <div className="auth-password-row">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="glass-input auth-password-input"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary auth-submit"
              style={{ width: '100%' }}
              disabled={busy}
            >
              {busy ? 'Please wait...' : submitText}
            </button>

            {authMode === 'login' && (
              <div className="auth-forgot">
                <button
                  onClick={() => {
                    setShowResetModal(true);
                    setResetEmail(email);
                  }}
                  type="button"
                  className="auth-link"
                >
                  Forgot Password?
                </button>
              </div>
            )}
          </form>
        </div>

        <div className="auth-footnote">
          <span className="text-muted">{roleLabel}</span>
        </div>
      </div>

      {showResetModal && (
        <div className="auth-modal-overlay" role="dialog" aria-modal="true">
          <div className="auth-modal glass-panel">
            <h3 className="text-xl font-bold mb-4">Reset Password</h3>
            <p className="text-sm text-muted mb-6">
              Reset access for your {role} account.
            </p>

            {error && (
              <div className="auth-alert auth-alert--error" role="alert">
                {error}
              </div>
            )}
            {successMsg && (
              <div className="auth-alert auth-alert--success" role="status">
                {successMsg}
              </div>
            )}

            <form className="auth-form" onSubmit={handleResetPassword}>
              <div className="auth-field">
                <label className="text-sm text-muted mb-2 block">Email Address</label>
                <input
                  type="email"
                  className="glass-input"
                  placeholder="Registered Account Email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                />
              </div>

              <div className="auth-field">
                <label className="text-sm text-muted mb-2 block">New Password</label>
                <div className="auth-password-row">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    className="glass-input auth-password-input"
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowNewPassword((current) => !current)}
                    aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                    aria-pressed={showNewPassword}
                  >
                    {showNewPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>

              <div className="auth-modal-actions">
                <button
                  type="button"
                  className="btn-secondary auth-modal-btn"
                  onClick={() => {
                    setShowResetModal(false);
                    setError('');
                    setSuccessMsg('');
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary auth-modal-btn"
                  disabled={busy}
                >
                  {busy ? 'Please wait...' : 'Reset Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
