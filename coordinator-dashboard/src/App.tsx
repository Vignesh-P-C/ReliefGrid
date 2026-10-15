import { useEffect, useState } from 'react';
import Login from './components/Login';
import ShelterBoard from './components/ShelterBoard';
import RankedOccupancy from './components/RankedOccupancy';
import ShortageBanner from './components/ShortageBanner';
import PriorityQueue from './components/PriorityQueue';
import { socket } from './lib/socket';
import type { AuthUser } from './types';
import './App.css';

type Tab = 'board' | 'ranked' | 'queue';

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
};

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tab, setTab] = useState<Tab>('board');

  useEffect(() => {
    if (!user) return;
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, [user]);

  if (!user) {
    return <Login onLoggedIn={setUser} />;
  }

  const section = sections[tab];

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
            <div className="live-indicator"><span className="status-dot" /> Operational view</div>
          </section>

          <ShortageBanner />

          <section className="workspace-panel" aria-label={section.title}>
            {tab === 'board' && <ShelterBoard />}
            {tab === 'ranked' && <RankedOccupancy />}
            {tab === 'queue' && <PriorityQueue />}
          </section>

          <footer className="ops-footer"><span>ReliefGrid</span><span>Coordinator dashboard</span></footer>
        </main>
      </div>
    </div>
  );
}

export default App;
