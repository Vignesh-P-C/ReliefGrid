import { useCallback, useEffect, useState, type FormEvent } from 'react';
import api from '../lib/api';
import { socket } from '../lib/socket';
import type { QueuedRequest } from '../types';

interface PriorityQueueProps {
  canReview: boolean;
}

function urgencyLabel(level: number) {
  if (level >= 5) return 'Critical';
  if (level >= 4) return 'High';
  if (level >= 3) return 'Elevated';
  if (level >= 2) return 'Routine';
  return 'Low';
}

function waitingLabel(minutes: number) {
  if (minutes >= 1440) {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return `${days}d ${hours}h`;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.floor(minutes % 60);
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${Math.floor(minutes)}m`;
}

export default function PriorityQueue({ canReview }: PriorityQueueProps) {
  const [queue, setQueue] = useState<QueuedRequest[]>([]);
  const [priorityDrafts, setPriorityDrafts] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchQueue = useCallback(async () => {
    try {
      const response = await api.get<QueuedRequest[]>('/aid-requests/queue');
      setQueue(response.data);
      setError('');
    } catch (requestError) {
      console.error('Failed to fetch queue', requestError);
      setError('Requests are temporarily unavailable. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchQueue();
    socket.on('new-aid-request', fetchQueue);
    socket.on('supply-allocated', fetchQueue);
    socket.on('aid-request-reviewed', fetchQueue);
    return () => {
      socket.off('new-aid-request', fetchQueue);
      socket.off('supply-allocated', fetchQueue);
      socket.off('aid-request-reviewed', fetchQueue);
    };
  }, [fetchQueue]);

  const saveReview = async (event: FormEvent<HTMLFormElement>, requestId: number) => {
    event.preventDefault();
    const request = queue.find((item) => item.request_id === requestId);
    const priority = Number(priorityDrafts[requestId] ?? request?.reviewed_priority ?? request?.urgency_level);
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) return;

    setSavingId(requestId);
    setReviewError('');
    try {
      await api.patch(`/aid-requests/${requestId}/priority`, { reviewed_priority: priority });
      setPriorityDrafts((drafts) => {
        const next = { ...drafts };
        delete next[requestId];
        return next;
      });
      await fetchQueue();
    } catch (requestError) {
      console.error('Failed to save priority review', requestError);
      setReviewError(`Could not save the review for request ${requestId}. Try again.`);
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <div className="loading-state"><span className="loading-mark" />Loading incoming requests…</div>;
  if (error) return <div className="empty-state" role="alert"><span className="eyebrow">CONNECTION ISSUE</span><p>{error}</p><button className="secondary-button" onClick={() => { setLoading(true); void fetchQueue(); }}>Try again</button></div>;

  return (
    <div className="module-content">
      <div className="module-heading">
        <div>
          <p className="eyebrow">INCOMING ASSISTANCE</p>
          <h2>Priority queue</h2>
          <p>Reported urgency remains visible; staff reviews and waiting time shape the queue order.</p>
        </div>
        <span className="result-count">{queue.length} open {queue.length === 1 ? 'request' : 'requests'}</span>
      </div>

      {queue.length === 0 ? (
        <div className="empty-state"><span className="eyebrow">QUEUE CLEAR</span><p>There are no active requests to review right now.</p></div>
      ) : (
        <div className="table-scroll">
          <table className="data-table queue-table">
            <thead>
              <tr>
                <th scope="col">Requester</th>
                <th scope="col">Contact</th>
                <th scope="col">Request type</th>
                <th scope="col">Reported urgency</th>
                <th scope="col">Reviewed priority</th>
                <th scope="col">Queue priority</th>
                <th scope="col">People</th>
                <th scope="col">Waiting</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((request) => {
                const currentPriority = request.reviewed_priority ?? request.urgency_level ?? 1;
                const reportedUrgency = request.urgency_level;
                return (
                  <tr key={request.request_id}>
                    <td><strong className="table-primary">{request.requester_name || 'Unnamed requester'}</strong><small className="table-secondary">Request {String(request.request_id).padStart(4, '0')}</small></td>
                    <td>
                      {request.phone
                        ? <a className="queue-contact" href={`tel:${request.phone}`}>{request.phone}</a>
                        : <span className="table-muted">{canReview ? 'Not provided' : 'Staff only'}</span>}
                    </td>
                    <td>{request.request_type?.trim() || <span className="table-muted">Not specified</span>}</td>
                    <td>{reportedUrgency === null
                      ? <span className="table-muted">Not provided</span>
                      : <span className={`urgency-pill urgency-${reportedUrgency}`}><span className="urgency-dot" />{urgencyLabel(reportedUrgency)}<small>{reportedUrgency}/5 · reported</small></span>}
                    </td>
                    <td>
                      {request.reviewed_priority === null ? (
                        <span className="queue-review-state">Not reviewed</span>
                      ) : (
                        <span className={`urgency-pill urgency-${request.reviewed_priority}`}>
                          <span className="urgency-dot" />{urgencyLabel(request.reviewed_priority)}<small>{request.reviewed_priority}/5</small>
                        </span>
                      )}
                      {request.reviewer_name && request.reviewed_at && (
                        <small className="table-secondary">Reviewed by {request.reviewer_name} · {new Date(request.reviewed_at).toLocaleString()}</small>
                      )}
                      {canReview && (
                        <form className="queue-review-form" onSubmit={(event) => { void saveReview(event, request.request_id); }}>
                          <label className="visually-hidden" htmlFor={`review-priority-${request.request_id}`}>Set coordinator priority for request {request.request_id}</label>
                          <select
                            id={`review-priority-${request.request_id}`}
                            value={priorityDrafts[request.request_id] ?? String(currentPriority)}
                            onChange={(event) => setPriorityDrafts((drafts) => ({ ...drafts, [request.request_id]: event.target.value }))}
                            disabled={savingId === request.request_id}
                          >
                            {[1, 2, 3, 4, 5].map((priority) => <option key={priority} value={priority}>{urgencyLabel(priority)} ({priority}/5)</option>)}
                          </select>
                          <button className="secondary-button" type="submit" disabled={savingId === request.request_id}>
                            {savingId === request.request_id ? 'Saving…' : request.reviewed_priority === null ? 'Record review' : 'Update review'}
                          </button>
                        </form>
                      )}
                    </td>
                    <td><span className={`urgency-pill urgency-${request.effective_priority}`}><span className="urgency-dot" />{urgencyLabel(request.effective_priority)}<small>{request.effective_priority}/5 · for order</small></span></td>
                    <td>{request.num_people} {request.num_people === 1 ? 'person' : 'people'}</td>
                    <td>{waitingLabel(request.waiting_minutes)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {reviewError && <p className="action-feedback is-error" role="alert">{reviewError}</p>}
      <p className="module-footnote"><span className="status-dot" /> Queue score starts from reported urgency until reviewed, then from staff priority. It rises one level every 24 hours, up to 5. New requests appear automatically.</p>
    </div>
  );
}
