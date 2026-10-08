import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Login from './pages/Login';
import ProfessorDashboard from './pages/ProfessorDashboard';
import StudentDashboard from './pages/StudentDashboard';
import AssignmentEvaluation from './pages/AssignmentEvaluation';
import ProjectEvaluation from './pages/ProjectEvaluation';
import RequireRole from './components/RequireRole';
import { ActiveCourseProvider } from './context/ActiveCourseContext';

function RequireAuth({ allowedRoles, children }) {
  const location = useLocation();
  const token = localStorage.getItem('token');
  const storedRole = localStorage.getItem('role');

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  let tokenRole = storedRole;
  try {
    const payloadBase64 = token.split('.')[1];
    const payload = JSON.parse(
      atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'))
    );
    tokenRole = payload?.role || storedRole;
  } catch {
    tokenRole = storedRole;
  }

  if (!tokenRole) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(tokenRole)) {
    return <Navigate to={tokenRole === 'professor' ? '/professor' : '/student'} replace />;
  }

  return children;
}

function App() {
  return (
    <Router>
      <ActiveCourseProvider>
        <div className="App">
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            <Route
              path="/professor/*"
              element={
                <RequireRole role="professor">
                  <ProfessorDashboard />
                </RequireRole>
              }
            />
            <Route
              path="/student/*"
              element={
                <RequireRole role="student">
                  <StudentDashboard />
                </RequireRole>
              }
            />
            <Route
              path="/assignment-evaluation"
              element={
                <RequireRole role="professor">
                  <AssignmentEvaluation />
                </RequireRole>
              }
            />
            <Route
              path="/project-evaluation"
              element={
                <RequireAuth allowedRoles={['professor', 'student']}>
                  <ProjectEvaluation />
                </RequireAuth>
              }
            />
          </Routes>
        </div>
      </ActiveCourseProvider>
    </Router>
  );
}

export default App;
