import { useCallback, useEffect, useState, type FormEvent } from 'react';
import api from '../lib/api';
import { socket } from '../lib/socket';
import type { QueuedRequest, ShortageItem } from '../types';

interface ShortageAllocationProps {
  shortage: ShortageItem;
  requests: QueuedRequest[];
  requestsError: string;
  requestsLoading: boolean;
  onRetryRequests: () => void;
  onRefresh: () => void;
}

function ShortageAllocation({ shortage, requests, requestsError, requestsLoading, onRetryRequests, onRefresh }: ShortageAllocationProps) {
  const [requestId, setRequestId] = useState<number | ''>(requests[0]?.request_id ?? '');
  const [quantity, setQuantity] = useState('1');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const availableQuantity = Number(shortage.quantity);

  useEffect(() => {
    if (!requests.some((request) => request.request_id === requestId)) {
      setRequestId(requests[0]?.request_id ?? '');
    }
  }, [requestId, requests]);

  const submitAllocation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const count = Number(quantity);
    if (!requestId) {
      setFeedback({ kind: 'error', message: 'Choose a pending aid request first.' });
      return;
    }
    if (!Number.isInteger(count) || count < 1 || count > availableQuantity) {
      setFeedback({ kind: 'error', message: 'Enter a whole number within the available stock.' });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      await api.post('/supplies/allocate', {
        request_id: requestId,
        supply_id: shortage.supply_id,
        quantity: count,
      });
      setFeedback({ kind: 'success', message: `Allocated ${count} ${shortage.item_name} to request ${requestId}.` });
    } catch (requestError) {
      const error = requestError as { response?: { status?: number; data?: { message?: string } } };
      setFeedback({ kind: 'error', message: error.response?.data?.message || 'Allocation failed. Refresh and try again.' });
      if (error.response?.status === 409) onRefresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="shortage-allocation">
      <summary>Allocate to a request</summary>
      <form className="allocation-form" onSubmit={submitAllocation}>
        {requestsLoading ? (
          <p className="allocation-note">Loading pending aid requests…</p>
        ) : requestsError ? (
          <>
            <p className="action-feedback is-error" role="alert">{requestsError}</p>
            <button className="secondary-button" type="button" onClick={onRetryRequests}>Retry loading requests</button>
          </>
        ) : requests.length === 0 ? (
          <p className="allocation-note">There are no pending aid requests to allocate to.</p>
        ) : (
          <>
            <label className="allocation-field">
              <span>Pending aid request</span>
              <select value={requestId} onChange={(event) => setRequestId(Number(event.target.value))} required>
                {requests.map((request) => (
                  <option key={request.request_id} value={request.request_id}>
                    #{request.request_id} · {request.requester_name || 'Unnamed requester'} · {request.num_people} {request.num_people === 1 ? 'person' : 'people'} · urgency {request.urgency_level}/5
                  </option>
                ))}
              </select>
            </label>
            <label className="allocation-field allocation-quantity">
              <span>Quantity ({shortage.item_name})</span>
              <input
                type="number"
                min="1"
                max={Math.max(0, availableQuantity)}
                step="1"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                disabled={availableQuantity < 1}
                required
              />
            </label>
            <button className="primary-button" type="submit" disabled={saving || availableQuantity < 1}>
              {saving ? 'Allocating…' : 'Allocate supply'}
            </button>
            {availableQuantity < 1 && <p className="allocation-note">No stock is available for this item.</p>}
          </>
        )}
        {feedback && <p className={`action-feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
      </form>
    </details>
  );
}

export default function ShortageBanner() {
  const [shortages, setShortages] = useState<ShortageItem[]>([]);
  const [requests, setRequests] = useState<QueuedRequest[]>([]);
  const [shortagesError, setShortagesError] = useState('');
  const [requestsError, setRequestsError] = useState('');
  const [requestsLoading, setRequestsLoading] = useState(true);

  const fetchShortages = useCallback(async () => {
    try {
      const response = await api.get<ShortageItem[]>('/supplies/shortages');
      setShortages(response.data);
      setShortagesError('');
    } catch (error) {
      console.error('Failed to fetch shortages', error);
      setShortagesError('Supply shortages are temporarily unavailable. Try refreshing.');
    }
  }, []);

  const fetchRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const response = await api.get<QueuedRequest[]>('/aid-requests/queue');
      setRequests(response.data);
      setRequestsError('');
    } catch (error) {
      console.error('Failed to fetch pending aid requests', error);
      setRequestsError('Pending aid requests could not be loaded.');
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchShortages();
    void fetchRequests();
    socket.on('supply-allocated', fetchShortages);
    socket.on('supply-allocated', fetchRequests);
    socket.on('new-aid-request', fetchRequests);
    return () => {
      socket.off('supply-allocated', fetchShortages);
      socket.off('supply-allocated', fetchRequests);
      socket.off('new-aid-request', fetchRequests);
    };
  }, [fetchRequests, fetchShortages]);

  if (shortagesError) {
    return (
      <section className="shortage-panel" aria-labelledby="shortage-title" role="alert">
        <div className="shortage-symbol" aria-hidden="true">!</div>
        <div className="shortage-content">
          <div className="shortage-heading">
            <div><p className="eyebrow">ACTION REQUIRED</p><h2 id="shortage-title">Critical supply shortage</h2></div>
            <button className="secondary-button" onClick={() => { void fetchShortages(); }}>Retry</button>
          </div>
          <p className="allocation-note">{shortagesError}</p>
        </div>
      </section>
    );
  }

  if (shortages.length === 0) return null;

  return (
    <section className="shortage-panel" aria-labelledby="shortage-title">
      <div className="shortage-symbol" aria-hidden="true">!</div>
      <div className="shortage-content">
        <div className="shortage-heading">
          <div>
            <p className="eyebrow">ACTION REQUIRED</p>
            <h2 id="shortage-title">Critical supply shortage</h2>
          </div>
          <span className="shortage-count">{shortages.length} {shortages.length === 1 ? 'item' : 'items'}</span>
        </div>
        <ul className="shortage-list">
          {shortages.map((shortage) => (
            <li key={shortage.supply_id}>
              <div className="shortage-row">
                <span className="shortage-item-name">{shortage.item_name}</span>
                <span>{shortage.shelter_name}</span>
                <strong>{shortage.quantity} left <small>· reorder at {shortage.reorder_threshold}</small></strong>
              </div>
              <ShortageAllocation
                shortage={shortage}
                requests={requests}
                requestsError={requestsError}
                requestsLoading={requestsLoading}
                onRetryRequests={() => { void fetchRequests(); }}
                onRefresh={() => { void fetchShortages(); void fetchRequests(); }}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
