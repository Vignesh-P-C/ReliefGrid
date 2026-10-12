import { useState } from 'react';
import FindShelter from './components/FindShelter';
import RequestForm from './components/RequestForm';
import './App.css';

type Tab = 'find' | 'request';

function App() {
  const [tab, setTab] = useState<Tab>('find');

  return (
    <div style={{ maxWidth: 700, margin: '2rem auto', padding: '0 1rem' }}>
      <header>
        <h1>ReliefGrid</h1>
        <p>Find help nearby, or let coordinators know what you need.</p>
      </header>

      <nav style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button onClick={() => setTab('find')} disabled={tab === 'find'}>
          Find a Shelter
        </button>
        <button onClick={() => setTab('request')} disabled={tab === 'request'}>
          Request Help
        </button>
      </nav>

      {tab === 'find' && <FindShelter />}
      {tab === 'request' && <RequestForm />}
    </div>
  );
}

export default App;
