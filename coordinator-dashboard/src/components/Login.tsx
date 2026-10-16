import { useState, type FormEvent } from 'react';
import api from '../lib/api';
import type { AuthUser } from '../types';

interface LoginProps {
  onLoggedIn: (user: AuthUser) => void;
}

export default function Login({ onLoggedIn }: LoginProps) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const response = await api.post('/auth/login', { phone: phone.trim(), password });
      localStorage.setItem('reliefgrid_token', response.data.token);
      onLoggedIn(response.data.user);
    } catch {
      setError('We couldn’t sign you in. Check your phone and password, then try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-story" aria-label="About ReliefGrid">
        <a className="brand-lockup" href="#sign-in" aria-label="ReliefGrid coordinator sign in">
          <span className="brand-mark" aria-hidden="true">R</span>
          <span className="brand-name">Relief<span>Grid</span><small>RESPONSE NETWORK</small></span>
        </a>
        <div className="login-story-copy">
          <p className="eyebrow">Coordinator access</p>
          <h1>Shelter<br /><em>coordination</em></h1>
          <p>Check shelter capacity, supply shortages, and incoming requests in one place.</p>
        </div>
        <div className="login-story-note"><span className="status-dot" /> Secure operations workspace</div>
      </section>

      <section className="login-form-side" id="sign-in">
        <div className="login-card">
          <p className="eyebrow">Coordinator login</p>
          <h2>Sign in</h2>
          <p className="login-subtitle">Use your registered coordinator phone and password.</p>

          <form onSubmit={handleSubmit} className="login-form">
            <label htmlFor="coordinator-phone">Phone number</label>
            <input
              id="coordinator-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="username"
              placeholder="Enter your phone number"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
            />

            <label htmlFor="coordinator-password">Password</label>
            <input
              id="coordinator-password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />

            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button login-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
              <span aria-hidden="true">↗</span>
            </button>
          </form>

          <p className="login-footnote">Access is limited to authorized response staff.</p>
        </div>
        <div className="login-footer"><span>RELIEFGRID</span><span>Response coordination</span></div>
      </section>
    </main>
  );
}
