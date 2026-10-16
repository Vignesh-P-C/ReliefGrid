import { useEffect, useState, useCallback, type FormEvent } from 'react';
import api from '../lib/api';
import { socket } from '../lib/socket';
import type { ShelterLiveStatus } from '../types';

interface ShelterCheckInProps {
  shelterId: number;
  onSuccess: () => void;
}

function ShelterCheckIn({ shelterId, onSuccess }: ShelterCheckInProps) {
  const [numPeople, setNumPeople] = useState('1');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const submitCheckIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const count = Number(numPeople);
    if (!Number.isInteger(count) || count < 1) {
      setFeedback({ kind: 'error', message: 'Enter a whole number greater than zero.' });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      await api.post(`/shelters/${shelterId}/checkin`, { num_people: count });
      setFeedback({ kind: 'success', message: `Checked in ${count} ${count === 1 ? 'person' : 'people'}.` });
      onSuccess();
    } catch (requestError) {
      const error = requestError as { response?: { status?: number; data?: { message?: string } } };
      const message = error.response?.data?.message
        || (error.response?.status === 409 ? 'This shelter does not have enough space.' : 'Check-in failed. Try again.');
      setFeedback({ kind: 'error', message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="shelter-action-form" onSubmit={submitCheckIn}>
      <label className="action-field-label" htmlFor={`checkin-${shelterId}`}>People to check in</label>
      <div className="action-control-row">
        <input
          id={`checkin-${shelterId}`}
          aria-label={`Number of people to check in at shelter ${shelterId}`}
          type="number"
          min="1"
          step="1"
          value={numPeople}
          onChange={(event) => setNumPeople(event.target.value)}
          required
        />
        <button className="primary-button" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Check in'}
        </button>
      </div>
      {feedback && <p className={`action-feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    </form>
  );
}

const statusLabels: Record<ShelterLiveStatus['status'], string> = {
  available: 'Available',
  'near-full': 'Near capacity',
  full: 'Full',
};

export default function ShelterBoard() {
  const [shelters, setShelters] = useState<ShelterLiveStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchShelters = useCallback(async () => {
    try {
      const response = await api.get<ShelterLiveStatus[]>('/shelters');
      setShelters(response.data);
      setError('');
    } catch (requestError) {
      console.error('Failed to fetch shelters', requestError);
      setError('Shelter data is temporarily unavailable. Try refreshing in a moment.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchShelters();
    socket.on('shelter-updated', fetchShelters);
    return () => {
      socket.off('shelter-updated', fetchShelters);
    };
  }, [fetchShelters]);

  const occupied = shelters.reduce((sum, shelter) => sum + shelter.capacity_occupied, 0);
  const totalCapacity = shelters.reduce((sum, shelter) => sum + shelter.capacity_total, 0);
  const availableSpaces = shelters.reduce((sum, shelter) => sum + Math.max(0, shelter.capacity_total - shelter.capacity_occupied), 0);

  if (loading) {
    return <div className="loading-state"><span className="loading-mark" />Loading live shelter data…</div>;
  }

  if (error) {
    return <div className="empty-state" role="alert"><span className="eyebrow">CONNECTION ISSUE</span><p>{error}</p><button className="secondary-button" onClick={() => { setLoading(true); void fetchShelters(); }}>Try again</button></div>;
  }

  return (
    <div className="module-content">
      <div className="module-heading">
        <div>
          <p className="eyebrow">NETWORK SNAPSHOT</p>
          <h2>Live shelter board</h2>
          <p>Occupancy and available capacity across all listed shelters.</p>
        </div>
        <button className="secondary-button refresh-button" onClick={() => { setLoading(true); void fetchShelters(); }} aria-label="Refresh shelter data">
          <span aria-hidden="true">↻</span> Refresh
        </button>
      </div>

      <div className="summary-grid" aria-label="Shelter summary">
        <article className="summary-card"><span className="summary-label">SHELTERS IN VIEW</span><strong>{shelters.length.toString().padStart(2, '0')}</strong><small>Across the response network</small></article>
        <article className="summary-card"><span className="summary-label">PEOPLE SHELTERED</span><strong>{occupied}<small className="summary-unit"> / {totalCapacity}</small></strong><small>Current occupied capacity</small></article>
        <article className="summary-card summary-card-accent"><span className="summary-label">OPEN SPACES</span><strong>{availableSpaces}</strong><small>Capacity still available</small></article>
      </div>

      {shelters.length === 0 ? (
        <div className="empty-state"><span className="eyebrow">NO SHELTERS FOUND</span><p>There are no shelter records to show yet.</p></div>
      ) : (
        <div className="table-scroll">
          <table className="data-table shelter-table">
            <thead><tr><th scope="col">Shelter</th><th scope="col">Occupancy</th><th scope="col">Utilization</th><th scope="col">Status</th><th scope="col">Check in</th></tr></thead>
            <tbody>
              {shelters.map((shelter) => {
                const percentage = Math.min(100, Math.max(0, Number(shelter.occupancy_pct)));
                return (
                  <tr key={shelter.shelter_id}>
                    <td><strong className="table-primary">{shelter.name}</strong><small className="table-secondary">Shelter {String(shelter.shelter_id).padStart(2, '0')}</small></td>
                    <td><strong>{shelter.capacity_occupied}</strong><span className="table-muted"> / {shelter.capacity_total} people</span></td>
                    <td className="utilization-cell"><div className="utilization-value">{percentage.toFixed(1)}%</div><div className="capacity-track" aria-label={`${percentage.toFixed(1)} percent occupied`}><span className={`capacity-fill is-${shelter.status}`} style={{ width: `${percentage}%` }} /></div></td>
                    <td><span className={`status-pill is-${shelter.status}`}><span className="status-dot" />{statusLabels[shelter.status]}</span></td>
                    <td><ShelterCheckIn shelterId={shelter.shelter_id} onSuccess={() => { void fetchShelters(); }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="module-footnote"><span className="status-dot" /> Updates automatically when shelter capacity changes.</p>
    </div>
  );
}
