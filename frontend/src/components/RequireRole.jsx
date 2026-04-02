import { useLocation, Navigate } from 'react-router-dom';

function decodeJwt(token) {
  try {
    const payloadBase64 = token.split('.')[1];
    const payload = JSON.parse(
      atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'))
    );
    return payload;
  } catch {
    return null;
  }
}

export default function RequireRole({ role, children }) {
  const location = useLocation();
  const token = localStorage.getItem('token');
  const storedRole = localStorage.getItem('role');

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const decoded = decodeJwt(token);
  const tokenRole = decoded?.role || storedRole;

  if (!tokenRole) {
    return <Navigate to="/login" replace />;
  }

  if (tokenRole !== role) {
    return <Navigate to={tokenRole === 'professor' ? '/professor' : '/student'} replace />;
  }

  return children;
}

