import { useEffect, useState, useCallback, useMemo, type FormEvent, type ChangeEvent } from 'react';
import api from '../lib/api';
import { socket } from '../lib/socket';
import type { ShelterLiveStatus } from '../types';

interface ShelterBoardProps {
  canManage: boolean;
}

interface ShelterActionProps {
  shelterId: number;
  onSuccess: () => void;
}

function readErrorMessage(requestError: unknown, fallback: string): string {
  const error = requestError as { response?: { data?: { message?: string } } };
  return error.response?.data?.message || fallback;
}

function ShelterCheckIn({ shelterId, onSuccess }: ShelterActionProps) {
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
      setFeedback({ kind: 'error', message: readErrorMessage(requestError, 'Check-in failed. Try again.') });
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

function ShelterCheckOut({ shelterId, onSuccess }: ShelterActionProps) {
  const [numPeople, setNumPeople] = useState('1');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const submitCheckOut = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const count = Number(numPeople);
    if (!Number.isInteger(count) || count < 1) {
      setFeedback({ kind: 'error', message: 'Enter a whole number greater than zero.' });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      await api.post(`/shelters/${shelterId}/checkout`, { num_people: count });
      setFeedback({ kind: 'success', message: `Checked out ${count} ${count === 1 ? 'person' : 'people'}.` });
      onSuccess();
    } catch (requestError) {
      setFeedback({ kind: 'error', message: readErrorMessage(requestError, 'Check-out failed. Try again.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="shelter-action-form" onSubmit={submitCheckOut}>
      <label className="action-field-label" htmlFor={`checkout-${shelterId}`}>People to check out</label>
      <div className="action-control-row">
        <input
          id={`checkout-${shelterId}`}
          aria-label={`Number of people to check out at shelter ${shelterId}`}
          type="number"
          min="1"
          step="1"
          value={numPeople}
          onChange={(event) => setNumPeople(event.target.value)}
          required
        />
        <button className="secondary-button" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Check out'}
        </button>
      </div>
      {feedback && <p className={`action-feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    </form>
  );
}

interface ShelterFormValues {
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  capacity_total: string;
  contact_number: string;
  coordinator_id: string;
  event_id: string;
  status: 'active' | 'inactive';
}

const emptyFormValues: ShelterFormValues = {
  name: '', address: '', latitude: '', longitude: '', capacity_total: '',
  contact_number: '', coordinator_id: '', event_id: '', status: 'active',
};

interface ShelterFormProps {
  mode: 'create' | 'edit';
  shelterId?: number;
  initialValues?: ShelterFormValues;
  onDone: () => void;
  onCancel: () => void;
}

function ShelterForm({ mode, shelterId, initialValues, onDone, onCancel }: ShelterFormProps) {
  const [values, setValues] = useState<ShelterFormValues>(initialValues || emptyFormValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setField = (field: keyof ShelterFormValues) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const payload: Record<string, unknown> = {
      name: values.name.trim(),
      latitude: values.latitude,
      longitude: values.longitude,
      capacity_total: values.capacity_total,
      address: values.address.trim() || null,
      contact_number: values.contact_number.trim() || null,
      coordinator_id: values.coordinator_id.trim() === '' ? null : Number(values.coordinator_id),
      event_id: values.event_id.trim() === '' ? null : Number(values.event_id),
      status: values.status,
    };

    setSaving(true);
    try {
      if (mode === 'create') {
        await api.post('/shelters', payload);
      } else {
        await api.patch(`/shelters/${shelterId}`, payload);
      }
      onDone();
    } catch (requestError) {
      setError(readErrorMessage(requestError, mode === 'create' ? 'Failed to create shelter.' : 'Failed to update shelter.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="shelter-manage-form" onSubmit={submit}>
      <div className="form-grid">
        <label>Name<input value={values.name} onChange={setField('name')} required /></label>
        <label>Status
          <select value={values.status} onChange={setField('status')}>
            <option value="active">Active</option>
            <option value="inactive">Inactive / closed</option>
          </select>
        </label>
        <label>Latitude<input type="number" step="any" value={values.latitude} onChange={setField('latitude')} required /></label>
        <label>Longitude<input type="number" step="any" value={values.longitude} onChange={setField('longitude')} required /></label>
        <label>Capacity (total)<input type="number" min="0" step="1" value={values.capacity_total} onChange={setField('capacity_total')} required /></label>
        <label>Event ID<input type="number" min="1" step="1" value={values.event_id} onChange={setField('event_id')} placeholder="optional" /></label>
        <label>Contact number<input value={values.contact_number} onChange={setField('contact_number')} placeholder="optional" /></label>
        <label>Coordinator user ID<input type="number" min="1" step="1" value={values.coordinator_id} onChange={setField('coordinator_id')} placeholder="optional" /></label>
        <label className="form-grid-wide">Address<input value={values.address} onChange={setField('address')} placeholder="optional" /></label>
      </div>
      {error && <p className="action-feedback is-error" role="alert">{error}</p>}
      <div className="action-control-row">
        <button className="primary-button" type="submit" disabled={saving}>
          {saving ? 'Saving…' : mode === 'create' ? 'Create shelter' : 'Save changes'}
        </button>
        <button className="secondary-button" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

const statusLabels: Record<ShelterLiveStatus['status'], string> = {
  available: 'Available',
  'near-full': 'Near capacity',
  full: 'Full',
};

export default function ShelterBoard({ canManage }: ShelterBoardProps) {
  const [shelters, setShelters] = useState<ShelterLiveStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [eventFilter, setEventFilter] = useState<string>('all');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingShelterId, setEditingShelterId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<ShelterFormValues | null>(null);
  const [editError, setEditError] = useState('');

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

  const events = useMemo(() => {
    const seen = new Map<string, string>();
    for (const shelter of shelters) {
      const key = shelter.event_id === null ? 'unassigned' : String(shelter.event_id);
      if (!seen.has(key)) {
        seen.set(key, shelter.event_id === null ? 'Unassigned event' : (shelter.event_name?.trim() || `Event ${shelter.event_id}`));
      }
    }
    return Array.from(seen.entries());
  }, [shelters]);

  const visibleShelters = useMemo(() => {
    if (eventFilter === 'all') return shelters;
    if (eventFilter === 'unassigned') return shelters.filter((shelter) => shelter.event_id === null);
    return shelters.filter((shelter) => shelter.event_id === Number(eventFilter));
  }, [shelters, eventFilter]);

  // Headline totals only count active shelters — a closed shelter's capacity isn't real (Audit #22).
  const activeShelters = visibleShelters.filter((shelter) => shelter.is_active);
  const occupied = activeShelters.reduce((sum, shelter) => sum + shelter.capacity_occupied, 0);
  const totalCapacity = activeShelters.reduce((sum, shelter) => sum + shelter.capacity_total, 0);
  const availableSpaces = activeShelters.reduce((sum, shelter) => sum + Math.max(0, shelter.capacity_total - shelter.capacity_occupied), 0);
  const inactiveCount = visibleShelters.length - activeShelters.length;

  const startEdit = async (shelterId: number) => {
    setEditError('');
    setEditingShelterId(shelterId);
    setEditValues(null);
    try {
      const response = await api.get(`/shelters/${shelterId}`);
      const record = response.data;
      setEditValues({
        name: record.name ?? '',
        address: record.address ?? '',
        latitude: String(record.latitude ?? ''),
        longitude: String(record.longitude ?? ''),
        capacity_total: String(record.capacity_total ?? ''),
        contact_number: record.contact_number ?? '',
        coordinator_id: record.coordinator_id === null || record.coordinator_id === undefined ? '' : String(record.coordinator_id),
        event_id: record.event_id === null || record.event_id === undefined ? '' : String(record.event_id),
        status: record.status === 'inactive' ? 'inactive' : 'active',
      });
    } catch (requestError) {
      setEditError(readErrorMessage(requestError, 'Failed to load shelter details.'));
    }
  };

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
          <p>Occupancy and available capacity across the response network.</p>
        </div>
        <div className="action-control-row">
          {events.length > 1 && (
            <select aria-label="Filter by event" value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}>
              <option value="all">All events</option>
              {events.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          )}
          {canManage && (
            <button className="secondary-button" onClick={() => setShowCreateForm((shown) => !shown)}>
              {showCreateForm ? 'Close' : 'Add shelter'}
            </button>
          )}
          <button className="secondary-button refresh-button" onClick={() => { setLoading(true); void fetchShelters(); }} aria-label="Refresh shelter data">
            <span aria-hidden="true">↻</span> Refresh
          </button>
        </div>
      </div>

      {canManage && showCreateForm && (
        <ShelterForm
          mode="create"
          onDone={() => { setShowCreateForm(false); void fetchShelters(); }}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      <div className="summary-grid" aria-label="Shelter summary">
        <article className="summary-card"><span className="summary-label">SHELTERS IN VIEW</span><strong>{visibleShelters.length.toString().padStart(2, '0')}</strong><small>{inactiveCount > 0 ? `${inactiveCount} inactive, excluded from totals` : 'Across the response network'}</small></article>
        <article className="summary-card"><span className="summary-label">PEOPLE SHELTERED</span><strong>{occupied}<small className="summary-unit"> / {totalCapacity}</small></strong><small>Active shelters only</small></article>
        <article className="summary-card summary-card-accent"><span className="summary-label">OPEN SPACES</span><strong>{availableSpaces}</strong><small>Active shelters only</small></article>
      </div>

      {visibleShelters.length === 0 ? (
        <div className="empty-state"><span className="eyebrow">NO SHELTERS FOUND</span><p>There are no shelter records to show for this event yet.</p></div>
      ) : (
        <div className="table-scroll">
          <table className="data-table shelter-table">
            <thead><tr><th scope="col">Shelter</th><th scope="col">Occupancy</th><th scope="col">Utilization</th><th scope="col">Status</th><th scope="col">Check in / out</th>{canManage && <th scope="col">Manage</th>}</tr></thead>
            <tbody>
              {visibleShelters.map((shelter) => {
                const percentage = Math.min(100, Math.max(0, Number(shelter.occupancy_pct)));
                return (
                  <tr key={shelter.shelter_id}>
                    <td><strong className="table-primary">{shelter.name}</strong><small className="table-secondary">Shelter {String(shelter.shelter_id).padStart(2, '0')}{shelter.event_name ? ` · ${shelter.event_name}` : ''}</small></td>
                    <td><strong>{shelter.capacity_occupied}</strong><span className="table-muted"> / {shelter.capacity_total} people</span></td>
                    <td className="utilization-cell"><div className="utilization-value">{percentage.toFixed(1)}%</div><div className="capacity-track" aria-label={`${percentage.toFixed(1)} percent occupied`}><span className={`capacity-fill is-${shelter.status}`} style={{ width: `${percentage}%` }} /></div></td>
                    <td>
                      <span className={`status-pill is-${shelter.status}`}><span className="status-dot" />{statusLabels[shelter.status]}</span>
                      {!shelter.is_active && <span className="status-pill is-inactive"><span className="status-dot" />Inactive</span>}
                    </td>
                    <td>
                      {shelter.is_active ? (
                        <div className="checkin-checkout-group">
                          <ShelterCheckIn shelterId={shelter.shelter_id} onSuccess={() => { void fetchShelters(); }} />
                          <ShelterCheckOut shelterId={shelter.shelter_id} onSuccess={() => { void fetchShelters(); }} />
                        </div>
                      ) : (
                        <small className="table-muted">This shelter is closed and cannot accept check-ins.</small>
                      )}
                    </td>
                    {canManage && (
                      <td>
                        <button className="secondary-button" onClick={() => { void startEdit(shelter.shelter_id); }}>Edit</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canManage && editingShelterId !== null && (
        <div className="shelter-edit-panel">
          <div className="module-heading"><h3>Edit shelter {editingShelterId}</h3></div>
          {editError && <p className="action-feedback is-error" role="alert">{editError}</p>}
          {editValues && (
            <ShelterForm
              mode="edit"
              shelterId={editingShelterId}
              initialValues={editValues}
              onDone={() => { setEditingShelterId(null); setEditValues(null); void fetchShelters(); }}
              onCancel={() => { setEditingShelterId(null); setEditValues(null); }}
            />
          )}
        </div>
      )}

      <p className="module-footnote"><span className="status-dot" /> Updates automatically when shelter capacity changes.</p>
    </div>
  );
}
