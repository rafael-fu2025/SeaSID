import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import MobileNavTrigger from './MobileNavTrigger';
import AgentFab from './AgentFab';

/**
 * App shell.
 *  - Fixed sidebar (drawer / narrow / full) on the left.
 *  - Top-left hamburger on small screens (rendered only when in drawer mode).
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
