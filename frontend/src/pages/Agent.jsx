import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * /agent — redirect to home.
 *
 * The chat has moved into the always-on AgentFab (lower-right corner of every
 * page). This page is preserved as a redirect so the sidebar nav link still
 * resolves to something useful rather than a 404.
 */
export default function Agent() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/', { replace: true });
  }, [navigate]);
  return null;
}
