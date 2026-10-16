import { useState } from 'react';
import FindShelter from './components/FindShelter';
import RequestForm from './components/RequestForm';
import './App.css';

type Tab = 'find' | 'request';

const pages: Record<Tab, { number: string; eyebrow: string; title: string; description: string }> = {
  find: {
    number: '01',
    eyebrow: 'Shelter search',
    title: 'Find a shelter',
    description: 'See nearby shelter options and the spaces currently available.',
  },
  request: {
    number: '02',
    eyebrow: 'Request help',
    title: 'Request help',
    description: 'Send your needs to the response team. Sharing your location is optional.',
  },
};

function App() {
  const [tab, setTab] = useState<Tab>('find');
  const page = pages[tab];

  return (
    <div className="public-shell">
      <header className="public-header">
        <a className="brand-lockup" href="#main-content" aria-label="ReliefGrid community support home">
          <span className="brand-mark" aria-hidden="true">R</span>
          <span className="brand-name">Relief<span>Grid</span><small>COMMUNITY PORTAL</small></span>
        </a>

        <nav className="section-nav" aria-label="Support options">
          <button className={tab === 'find' ? 'nav-item is-active' : 'nav-item'} onClick={() => setTab('find')} aria-current={tab === 'find' ? 'page' : undefined}>
            <span className="nav-copy"><strong>Find a shelter</strong></span>
          </button>
          <button className={tab === 'request' ? 'nav-item is-active' : 'nav-item'} onClick={() => setTab('request')} aria-current={tab === 'request' ? 'page' : undefined}>
            <span className="nav-copy"><strong>Request help</strong></span>
          </button>
        </nav>
      </header>

      <div className="public-main">
        <header className="public-topbar">
          <div className="breadcrumb"><span>ReliefGrid</span><span className="breadcrumb-divider">/</span><span>Community</span></div>
          <span className="topbar-note">Public support portal</span>
        </header>

        <main className="public-content" id="main-content">
          <section className="page-intro" aria-labelledby="page-title">
            <div>
              <p className="eyebrow">{page.eyebrow}</p>
              <h1 id="page-title">{page.title}</h1>
              <p className="page-description">{page.description}</p>
            </div>
            <span className="page-index"><span>{page.number}</span> / 02</span>
          </section>

          <section className="public-workspace" aria-label={page.title}>
            {tab === 'find' ? <FindShelter /> : <RequestForm />}
          </section>

          <footer className="public-footer"><span>RELIEFGRID RESPONSE NETWORK</span><span>Community support</span></footer>
        </main>
      </div>
    </div>
  );
}

export default App;
