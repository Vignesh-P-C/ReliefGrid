import { useState } from 'react';
import Login from './components/Login';
import ShelterBoard from './components/ShelterBoard';
import RankedOccupancy from './components/RankedOccupancy';
import ShortageBanner from './components/ShortageBanner';
import PriorityQueue from './components/PriorityQueue';
import type { AuthUser } from './types';
import './App.css';

type Tab = 'board' | 'ranked' | 'queue';

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tab, setTab] = useState<Tab>('board');

  if (!user) {
    return <Login onLoggedIn={setUser} />;
  }

  return (
    <div style={{ maxWidth: 900, margin: '2rem auto', padding: '0 1rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>ReliefGrid</h1>
        <span>
          {user.name} ({user.role})
        </span>
      </header>

      <ShortageBanner />

      <nav style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button onClick={() => setTab('board')} disabled={tab === 'board'}>
          Live Board
        </button>
        <button onClick={() => setTab('ranked')} disabled={tab === 'ranked'}>
          Ranked Occupancy
        </button>
        <button onClick={() => setTab('queue')} disabled={tab === 'queue'}>
          Priority Queue
        </button>
      </nav>

      {tab === 'board' && <ShelterBoard />}
      {tab === 'ranked' && <RankedOccupancy />}
      {tab === 'queue' && <PriorityQueue />}
    </div>
  );
}

export default App;
