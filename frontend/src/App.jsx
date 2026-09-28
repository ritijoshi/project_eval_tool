import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import ProfessorDashboard from './pages/ProfessorDashboard';
import StudentDashboard from './pages/StudentDashboard';
import AssignmentEvaluation from './pages/AssignmentEvaluation';
import RequireRole from './components/RequireRole';
import { ActiveCourseProvider } from './context/ActiveCourseContext';

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
          </Routes>
        </div>
      </ActiveCourseProvider>
    </Router>
  );
}

export default App;
