import { useState, type FormEvent } from 'react';
import api from '../lib/api';

export default function RequestForm() {
  const [form, setForm] = useState({
    requester_name: '',
    phone: '',
    request_type: 'shelter',
    num_people: 1,
    urgency_level: 3,
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (field: string, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const submitWithLocation = async (latitude?: number, longitude?: number) => {
      try {
        await api.post('/aid-requests', { ...form, latitude, longitude });
        setSubmitted(true);
      } catch (err) {
        console.error('Failed to submit request', err);
        setError('Something went wrong submitting your request. Please try again.');
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => submitWithLocation(pos.coords.latitude, pos.coords.longitude),
        () => submitWithLocation() // submit without location if the user declines
      );
    } else {
      submitWithLocation();
    }
  };

  if (submitted) {
    return <p>Your request has been submitted. A coordinator will reach out shortly.</p>;
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 360 }}>
      <h2>Request Help</h2>

      <label>
        Full name
        <input
          required
          value={form.requester_name}
          onChange={(e) => handleChange('requester_name', e.target.value)}
          style={{ display: 'block', width: '100%', marginBottom: '0.5rem' }}
        />
      </label>

      <label>
        Phone number
        <input
          required
          value={form.phone}
          onChange={(e) => handleChange('phone', e.target.value)}
          style={{ display: 'block', width: '100%', marginBottom: '0.5rem' }}
        />
      </label>

      <label>
        What do you need?
        <select
          value={form.request_type}
          onChange={(e) => handleChange('request_type', e.target.value)}
          style={{ display: 'block', width: '100%', marginBottom: '0.5rem' }}
        >
          <option value="shelter">Shelter</option>
          <option value="medical">Medical</option>
          <option value="food">Food/Water</option>
          <option value="rescue">Rescue</option>
        </select>
      </label>

      <label>
        Number of people
        <input
          type="number"
          min={1}
          required
          value={form.num_people}
          onChange={(e) => handleChange('num_people', Number(e.target.value))}
          style={{ display: 'block', width: '100%', marginBottom: '0.5rem' }}
        />
      </label>

      <label>
        Urgency (1 = low, 5 = critical)
        <input
          type="range"
          min={1}
          max={5}
          value={form.urgency_level}
          onChange={(e) => handleChange('urgency_level', Number(e.target.value))}
          style={{ display: 'block', width: '100%', marginBottom: '0.5rem' }}
        />
        <span>{form.urgency_level}</span>
      </label>

      {error && <p style={{ color: '#c62828' }}>{error}</p>}
      <button type="submit">Submit request</button>
    </form>
  );
}
