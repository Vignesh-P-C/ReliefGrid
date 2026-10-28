import { useCallback, useEffect, useState } from 'react';
import Login from './components/Login';
import ShelterBoard from './components/ShelterBoard';
import RankedOccupancy from './components/RankedOccupancy';
import ShortageBanner from './components/ShortageBanner';
import PriorityQueue from './components/PriorityQueue';
import AllocationWorkspace from './components/AllocationWorkspace';
import AllocationHistory from './components/AllocationHistory';
import VolunteerTaskTree from './components/VolunteerTaskTree';
import api from './lib/api';
import { socket } from './lib/socket';
import type { AuthUser } from './types';
import './App.css';

type Tab = 'board' | 'ranked' | 'queue' | 'allocation' | 'tasks';
type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

const sections: Record<Tab, { eyebrow: string; title: string; description: string }> = {
  board: {
    eyebrow: 'Shelter capacity',
    title: 'Live shelter board',
    description: 'A current view of shelter capacity across the response network.',
  },
  ranked: {
    eyebrow: 'By event',
    title: 'Occupancy ranking',
    description: 'See which shelters are filling fastest, grouped by disaster event.',
  },
  queue: {
    eyebrow: 'Incoming requests',
    title: 'Priority queue',
    description: 'Review incoming requests in urgency order and coordinate a response.',
  },
  allocation: {
    eyebrow: 'Resource allocation',
    title: 'Allocation workspace',
    description: 'Match stock held at a shelter to the request that needs it, and see what has already been sent.',
  },
  tasks: {
    eyebrow: 'Volunteer operations',
    title: 'Task dependency tree',
    description: 'Follow task dependencies and assigned work at each shelter.',
  },
};

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  // Starts true only when there is a stored token to check, so a first-time
  // visitor goes straight to the sign-in screen instead of a splash.
  const [restoringSession, setRestoringSession] = useState(() => Boolean(localStorage.getItem('reliefgrid_token')));
  const [tab, setTab] = useState<Tab>('board');
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('disconnected');
  const [queueRefresh, setQueueRefresh] = useState<{ lastSuccessfulAt: number | null; failed: boolean }>({ lastSuccessfulAt: null, failed: false });
  const [allocationSupplyId, setAllocationSupplyId] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());

  // A reload used to drop the coordinator back to the sign-in screen even
  // though the stored token was still valid for hours (Audit #46). The token is
  // verified against /auth/me, which also refreshes the role from the database,
  // so a revoked token or a changed role takes effect on reload.
  useEffect(() => {
    let active = true;
    if (!localStorage.getItem('reliefgrid_token')) {
      return () => { active = false; };
    }

    api.get<AuthUser>('/auth/me')
      .then((response) => { if (active) setUser(response.data); })
      .catch(() => { if (active) localStorage.removeItem('reliefgrid_token'); })
      .finally(() => { if (active) setRestoringSession(false); });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) {
      setSocketStatus('disconnected');
      return;
    }

    let hasConnected = socket.connected;
    setSocketStatus(hasConnected ? 'connected' : 'connecting');
    const handleConnect = () => {
      hasConnected = true;
      setSocketStatus('connected');
    };
    const handleDisconnect = (reason: string) => {
      setSocketStatus(hasConnected ? 'reconnecting' : 'disconnected');
      if (reason === 'io server disconnect') socket.connect();
    };
    const handleConnectError = () => setSocketStatus(hasConnected ? 'reconnecting' : 'connecting');
    const handleReconnectAttempt = () => setSocketStatus('reconnecting');

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.io.on('reconnect_attempt', handleReconnectAttempt);
    if (!socket.connected) socket.connect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.io.off('reconnect_attempt', handleReconnectAttempt);
      socket.disconnect();
      setSocketStatus('disconnected');
    };
  }, [user]);

  useEffect(() => {
    const clockTimer = window.setInterval(() => setClockNow(Date.now()), 15_000);
    return () => window.clearInterval(clockTimer);
  }, []);

  const handleQueueRefreshSuccess = useCallback((timestamp: number) => {
    setQueueRefresh({ lastSuccessfulAt: timestamp, failed: false });
  }, []);
  const handleQueueRefreshError = useCallback(() => {
    setQueueRefresh((current) => ({ ...current, failed: true }));
  }, []);

  const handleAllocateFromShortage = (supplyId: number) => {
    setAllocationSupplyId(supplyId);
    setTab('allocation');
  };
  const handleInitialSupplyUsed = useCallback(() => setAllocationSupplyId(null), []);

  if (restoringSession) {
    return <div className="loading-state"><span className="loading-mark" />Restoring your session…</div>;
  }

  if (!user) {
    return <Login onLoggedIn={setUser} />;
  }

  const section = sections[tab];
  const queueIsFresh = queueRefresh.lastSuccessfulAt !== null
    && !queueRefresh.failed
    && clockNow - queueRefresh.lastSuccessfulAt <= 120_000;
  const lastQueueRefresh = queueRefresh.lastSuccessfulAt
    ? new Date(queueRefresh.lastSuccessfulAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : 'not refreshed yet';
  const liveStatusText = socketStatus === 'connected'
    ? queueIsFresh ? `Live · queue refreshed ${lastQueueRefresh}` : `Connected · queue stale (last ${lastQueueRefresh})`
    : socketStatus === 'reconnecting' ? `Reconnecting · queue may be stale (last ${lastQueueRefresh})`
      : socketStatus === 'connecting' ? `Connecting · queue last refreshed ${lastQueueRefresh}`
        : `Disconnected · queue may be stale (last ${lastQueueRefresh})`;
  const liveStatusClass = socketStatus === 'connected'
    ? queueIsFresh ? 'is-connected' : 'is-stale'
    : `is-${socketStatus}`;

  const signOut = () => {
    localStorage.removeItem('reliefgrid_token');
    setUser(null);
  };

  return (
    <div className="ops-shell">
      <header className="ops-header">
        <a className="brand-lockup" href="#main-content" aria-label="ReliefGrid operations home">
          <span className="brand-mark" aria-hidden="true">R</span>
          <span className="brand-name">Relief<span>Grid</span><small>COORDINATOR</small></span>
        </a>

        <nav className="section-nav" aria-label="Operations sections">
          <button className={tab === 'board' ? 'nav-item is-active' : 'nav-item'} onClick={() => setTab('board')} aria-current={tab === 'board' ? 'page' : undefined}>
            <span className="nav-copy"><strong>Live board</strong></span>
          </button>
          <button className={tab === 'ranked' ? 'nav-item is-active' : 'nav-item'} onClick={() => setTab('ranked')} aria-current={tab === 'ranked' ? 'page' : undefined}>
            <span className="nav-copy"><strong>Occupancy</strong></span>
          </button>
          <button className={tab === 'queue' ? 'nav-item is-active' : 'nav-item'} onClick={() => setTab('queue')} aria-current={tab === 'queue' ? 'page' : undefined}>
            <span className="nav-copy"><strong>Priority queue</strong></span>
          </button>
          <button className={tab === 'allocation' ? 'nav-item is-active' : 'nav-item'} onClick={() => setTab('allocation')} aria-current={tab === 'allocation' ? 'page' : undefined}>
            <span className="nav-copy"><strong>Allocation</strong></span>
          </button>
          <button className={tab === 'tasks' ? 'nav-item is-active' : 'nav-item'} onClick={() => setTab('tasks')} aria-current={tab === 'tasks' ? 'page' : undefined}>
            <span className="nav-copy"><strong>Volunteer tasks</strong></span>
          </button>
        </nav>
      </header>

      <div className="ops-main">
        <header className="ops-topbar">
          <div className="breadcrumb"><span>ReliefGrid</span><span className="breadcrumb-divider">/</span><span>Coordinator</span></div>
          <div className="account-control">
            <span className="account-avatar" aria-hidden="true">{user.name.charAt(0).toUpperCase()}</span>
            <span className="account-copy"><strong>{user.name}</strong><small>{user.role}</small></span>
            <button className="text-button" onClick={signOut}>Sign out</button>
          </div>
        </header>

        <main className="ops-content" id="main-content">
          <section className="page-intro" aria-labelledby="page-title">
            <div>
              <p className="eyebrow">{section.eyebrow}</p>
              <h1 id="page-title">{section.title}</h1>
              <p className="page-description">{section.description}</p>
            </div>
            <div className={`live-indicator ${liveStatusClass}`} role="status" aria-live="polite">
              <span className="status-dot" />
              <span>{liveStatusText}</span>
            </div>
          </section>

          <ShortageBanner onAllocate={handleAllocateFromShortage} />

          <section className="workspace-panel" aria-label={section.title}>
            {tab === 'board' && <ShelterBoard canManage={user.role === 'Admin' || user.role === 'ShelterCoordinator'} user={user} />}
            {tab === 'ranked' && <RankedOccupancy />}
            {tab === 'queue' && (
              <PriorityQueue
                canReview={user.role === 'Admin' || user.role === 'ShelterCoordinator'}
                onRefreshSuccess={handleQueueRefreshSuccess}
                onRefreshError={handleQueueRefreshError}
              />
            )}
            {tab === 'allocation' && (
              <>
                <AllocationWorkspace
                  initialSupplyId={allocationSupplyId}
                  onInitialSupplyUsed={handleInitialSupplyUsed}
                />
                <AllocationHistory />
              </>
            )}
            {tab === 'tasks' && <VolunteerTaskTree />}
          </section>

          <footer className="ops-footer"><span>ReliefGrid</span><span>Coordinator dashboard</span></footer>
        </main>
      </div>
    </div>
  );
}

export default App;
