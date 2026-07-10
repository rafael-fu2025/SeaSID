import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import MobileNavTrigger from './MobileNavTrigger';
import AgentFab from './AgentFab';

/**
 * App shell.
 *  - Sidebar (single component): persistent flex column on desktop,
 *    slide-in drawer on mobile.
 *  - Top-left hamburger trigger (rendered only on mobile by the
 *    MobileNavTrigger component).
 *  - Content area on the right.
 *  - Floating AI-agent button anchored bottom-right.
 *
 * Theme + Sidebar providers live higher up in main.jsx.
 */
export default function Layout() {
  return (
    <div className="app-layout">
      <Sidebar />
      <MobileNavTrigger />
      <main className="app-main">
        <div className="container">
          <Outlet />
        </div>
      </main>
      <AgentFab />
    </div>
  );
}
