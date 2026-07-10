import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import CollapseFab from './CollapseFab';
import MobileNavTrigger from './MobileNavTrigger';
import AgentFab from './AgentFab';

/**
 * App shell.
 *  - Sidebar nav on the left (collapsable, state in SidebarContext).
 *  - CollapseFab — a FAB-style seam control, sibling of Sidebar so it
 *    floats independently of either the rail or the main column.
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
      <CollapseFab />
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
