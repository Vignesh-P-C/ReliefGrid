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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.post('/auth/login', { phone, password });
      localStorage.setItem('reliefgrid_token', res.data.token);
      onLoggedIn(res.data.user);
    } catch (err) {
      setError('Invalid phone or password');
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 320, margin: '4rem auto' }}>
      <h2>ReliefGrid — Coordinator Login</h2>
      <input
        placeholder="Phone"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        style={{ display: 'block', width: '100%', marginBottom: '0.5rem' }}
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ display: 'block', width: '100%', marginBottom: '0.5rem' }}
      />
      {error && <p style={{ color: '#c62828' }}>{error}</p>}
      <button type="submit">Log in</button>
    </form>
  );
}
