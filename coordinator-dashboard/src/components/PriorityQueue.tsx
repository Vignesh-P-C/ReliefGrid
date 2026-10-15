import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';
import { socket } from '../lib/socket';
import type { QueuedRequest } from '../types';

function urgencyLabel(level: number) {
  if (level >= 5) return 'Critical';
  if (level >= 4) return 'High';
  if (level >= 3) return 'Elevated';
  if (level >= 2) return 'Routine';
  return 'Low';
}

export default function PriorityQueue() {
  const [queue, setQueue] = useState<QueuedRequest[]>([]);
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
    return () => {
      socket.off('new-aid-request', fetchQueue);
    };
  }, [fetchQueue]);

  if (loading) return <div className="loading-state"><span className="loading-mark" />Loading incoming requests…</div>;
  if (error) return <div className="empty-state" role="alert"><span className="eyebrow">CONNECTION ISSUE</span><p>{error}</p><button className="secondary-button" onClick={() => { setLoading(true); void fetchQueue(); }}>Try again</button></div>;

  return (
    <div className="module-content">
      <div className="module-heading">
        <div>
          <p className="eyebrow">INCOMING ASSISTANCE</p>
          <h2>Priority queue</h2>
          <p>Requests are ordered by urgency to help teams triage quickly.</p>
        </div>
        <span className="result-count">{queue.length} open {queue.length === 1 ? 'request' : 'requests'}</span>
      </div>

      {queue.length === 0 ? (
        <div className="empty-state"><span className="eyebrow">QUEUE CLEAR</span><p>There are no active requests to review right now.</p></div>
      ) : (
        <div className="table-scroll">
          <table className="data-table queue-table">
            <thead><tr><th scope="col">Requester</th><th scope="col">Urgency</th><th scope="col">People</th><th scope="col">Waiting</th></tr></thead>
            <tbody>
              {queue.map((request) => (
                <tr key={request.request_id}>
                  <td><strong className="table-primary">{request.requester_name}</strong><small className="table-secondary">Request {String(request.request_id).padStart(4, '0')}</small></td>
                  <td><span className={`urgency-pill urgency-${Math.min(5, Math.max(1, request.urgency_level))}`}><span className="urgency-dot" />{urgencyLabel(request.urgency_level)}<small>{request.urgency_level}/5</small></span></td>
                  <td>{request.num_people} {request.num_people === 1 ? 'person' : 'people'}</td>
                  <td>{request.waiting_minutes} <span className="table-muted">min</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="module-footnote"><span className="status-dot" /> New requests appear automatically.</p>
    </div>
  );
}
