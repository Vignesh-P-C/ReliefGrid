import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';
import { quantityLabel } from '../lib/format';
import { socket } from '../lib/socket';
import type { AllocationRecord } from '../types';

const formatWhen = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
};

const statusLabel = (status: AllocationRecord['request_status']) => {
  if (!status) return 'Removed';
  return status.replace('_', ' ');
};

export default function AllocationHistory() {
  const [allocations, setAllocations] = useState<AllocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchHistory = useCallback(async () => {
    try {
      const response = await api.get<AllocationRecord[]>('/supplies/allocations?limit=25');
      setAllocations(response.data);
      setError('');
    } catch (requestError) {
      console.error('Failed to fetch allocation history', requestError);
      setError('Allocation history is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHistory();
    socket.on('supply-allocated', fetchHistory);
    socket.on('connect', fetchHistory);
    return () => {
      socket.off('supply-allocated', fetchHistory);
      socket.off('connect', fetchHistory);
    };
  }, [fetchHistory]);

  return (
    <section className="allocation-history" aria-labelledby="allocation-history-title">
      <div className="module-heading">
        <div>
          <p className="eyebrow">AUDIT TRAIL</p>
          <h3 id="allocation-history-title">Recent allocations</h3>
          <p>What was sent, from which shelter, to which request, and who recorded it.</p>
        </div>
        <span className="result-count">{allocations.length} shown</span>
      </div>

      {loading ? (
        <p className="allocation-note">Loading allocation history…</p>
      ) : error ? (
        <div role="alert">
          <p className="action-feedback is-error">{error}</p>
          <button className="secondary-button" type="button" onClick={() => { setLoading(true); void fetchHistory(); }}>Retry</button>
        </div>
      ) : allocations.length === 0 ? (
        <p className="empty-state">Nothing has been allocated yet. Confirmed allocations appear here immediately.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Stock</th>
                <th scope="col">From shelter</th>
                <th scope="col">Request</th>
                <th scope="col">Request status</th>
                <th scope="col">Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((allocation) => (
                <tr key={allocation.allocation_id}>
                  <td>{formatWhen(allocation.allocated_at)}</td>
                  <td>
                    <strong className="table-primary">
                      {quantityLabel(allocation.quantity_allocated, allocation.unit)} of {allocation.item_name}
                    </strong>
                    {allocation.category_name && <small className="table-secondary">{allocation.category_name}</small>}
                  </td>
                  <td>{allocation.shelter_name}</td>
                  <td>
                    {allocation.request_id === null
                      ? <span className="table-muted">Deleted request</span>
                      : (
                        <>
                          <strong className="table-primary">#{allocation.request_id}</strong>
                          <small className="table-secondary">{allocation.requester_name || 'Requester hidden'}</small>
                        </>
                      )}
                  </td>
                  <td>{statusLabel(allocation.request_status)}</td>
                  <td>{allocation.allocated_by_name || <span className="table-muted">Not recorded</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
