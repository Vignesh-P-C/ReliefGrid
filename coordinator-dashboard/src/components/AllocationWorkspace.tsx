import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import api from '../lib/api';
import { quantityLabel } from '../lib/format';
import { socket } from '../lib/socket';
import type { AllocationOutcome, InventoryItem, QueuedRequest, RequestNeed } from '../types';

interface AllocationWorkspaceProps {
  initialSupplyId: number | null;
  onInitialSupplyUsed: () => void;
}

const remainingOf = (need: RequestNeed) => Math.max(0, need.quantity_needed - need.quantity_allocated);

function requestArea(request: QueuedRequest) {
  if (request.location_status === 'available') {
    if (request.nearest_shelter_name && request.nearest_shelter_distance_km !== null) {
      return `Near ${request.nearest_shelter_name} · ${request.nearest_shelter_distance_km.toFixed(1)} km`;
    }
    if (request.latitude !== null && request.longitude !== null) {
      return `${request.latitude.toFixed(3)}, ${request.longitude.toFixed(3)}`;
    }
  }
  if (request.location_status === 'restricted') return 'Location restricted';
  if (request.location_status === 'invalid') return 'Coordinates unusable';
  return 'Location not provided';
}

export default function AllocationWorkspace({ initialSupplyId, onInitialSupplyUsed }: AllocationWorkspaceProps) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [requests, setRequests] = useState<QueuedRequest[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState('');
  const [requestsError, setRequestsError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedSupplyId, setSelectedSupplyId] = useState<number | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [selectedNeedId, setSelectedNeedId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const fetchInventory = useCallback(async () => {
    try {
      const response = await api.get<InventoryItem[]>('/supplies/inventory?limit=500');
      setInventory(response.data);
      setInventoryError('');
    } catch (error) {
      console.error('Failed to fetch inventory', error);
      setInventoryError('Inventory is temporarily unavailable. Try refreshing.');
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  const fetchRequests = useCallback(async () => {
    try {
      const response = await api.get<QueuedRequest[]>('/aid-requests/queue');
      setRequests(response.data);
      setRequestsError('');
    } catch (error) {
      console.error('Failed to fetch open requests', error);
      setRequestsError('Open requests could not be loaded.');
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  const refreshAll = useCallback(() => {
    void fetchInventory();
    void fetchRequests();
  }, [fetchInventory, fetchRequests]);

  useEffect(() => {
    refreshAll();
    socket.on('supply-allocated', refreshAll);
    socket.on('new-aid-request', refreshAll);
    socket.on('aid-request-reviewed', refreshAll);
    socket.on('connect', refreshAll);
    return () => {
      socket.off('supply-allocated', refreshAll);
      socket.off('new-aid-request', refreshAll);
      socket.off('aid-request-reviewed', refreshAll);
      socket.off('connect', refreshAll);
    };
  }, [refreshAll]);

  // A shortage alert can hand over the stock item it wants allocated.
  useEffect(() => {
    if (initialSupplyId === null) return;
    setSelectedSupplyId(initialSupplyId);
    onInitialSupplyUsed();
  }, [initialSupplyId, onInitialSupplyUsed]);

  // Changing stock always clears the request choice: no consequential
  // allocation may inherit a default.
  useEffect(() => {
    setSelectedRequestId(null);
    setSelectedNeedId(null);
    setQuantity('1');
    setFeedback(null);
  }, [selectedSupplyId]);

  const selectedSupply = useMemo(
    () => inventory.find((item) => item.supply_id === selectedSupplyId) ?? null,
    [inventory, selectedSupplyId]
  );

  const visibleInventory = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return inventory;
    return inventory.filter((item) =>
      item.item_name.toLowerCase().includes(term)
      || item.shelter_name.toLowerCase().includes(term)
      || (item.category_name ?? '').toLowerCase().includes(term));
  }, [inventory, search]);

  const candidates = useMemo(() => {
    if (!selectedSupply) return [];
    return requests
      .map((request) => {
        const compatible = request.needs.filter((need) =>
          remainingOf(need) > 0
          && (need.category_id === null || need.category_id === selectedSupply.category_id));
        return { request, needs: compatible, exact: compatible.some((need) => need.category_id !== null) };
      })
      .filter((candidate) => candidate.needs.length > 0)
      .sort((a, b) => Number(b.exact) - Number(a.exact)
        || b.request.effective_priority - a.request.effective_priority
        || a.request.request_id - b.request.request_id);
  }, [requests, selectedSupply]);

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.request.request_id === selectedRequestId) ?? null,
    [candidates, selectedRequestId]
  );

  // One compatible need needs no further choice; several do. Keyed on the
  // chosen request rather than the candidate object, so a live refresh from
  // another coordinator does not wipe what is being typed.
  const candidateRequestId = selectedCandidate?.request.request_id ?? null;
  const candidateNeedCount = selectedCandidate?.needs.length ?? 0;
  useEffect(() => {
    if (!selectedCandidate) {
      setSelectedNeedId(null);
      return;
    }
    setSelectedNeedId(candidateNeedCount === 1 ? selectedCandidate.needs[0].need_id : null);
    setQuantity('1');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateRequestId, candidateNeedCount]);

  const selectedNeed = selectedCandidate?.needs.find((need) => need.need_id === selectedNeedId) ?? null;
  const maxQuantity = selectedSupply && selectedNeed
    ? Math.min(selectedSupply.quantity, remainingOf(selectedNeed))
    : 0;
  const parsedQuantity = Number(quantity);
  const quantityValid = Number.isInteger(parsedQuantity) && parsedQuantity > 0 && parsedQuantity <= maxQuantity;

  const submitAllocation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSupply || !selectedCandidate || !selectedNeed) {
      setFeedback({ kind: 'error', message: 'Choose the stock item and the request it should serve.' });
      return;
    }
    if (!quantityValid) {
      setFeedback({ kind: 'error', message: `Enter a whole number from 1 to ${maxQuantity}.` });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const response = await api.post<AllocationOutcome>('/supplies/allocate', {
        request_id: selectedCandidate.request.request_id,
        supply_id: selectedSupply.supply_id,
        need_id: selectedNeed.need_id,
        quantity: parsedQuantity,
      });
      const outcome = response.data;
      setFeedback({
        kind: 'success',
        message: `${quantityLabel(parsedQuantity, selectedSupply.unit)} of ${selectedSupply.item_name} sent to request #${selectedCandidate.request.request_id}. `
          + `Request is now ${(outcome.request_status ?? '').replace('_', ' ')}`
          + `${outcome.remaining_need !== null && outcome.remaining_need > 0 ? `, ${outcome.remaining_need} still needed` : ''}.`,
      });
      setSelectedRequestId(null);
      setSelectedNeedId(null);
      setQuantity('1');
      refreshAll();
    } catch (error) {
      const failure = error as { response?: { status?: number; data?: Partial<AllocationOutcome> & { message?: string } } };
      const data = failure.response?.data;
      setFeedback({
        kind: 'error',
        message: data?.message || 'Allocation failed. Refresh and try again.',
      });
      if (failure.response?.status === 409 || failure.response?.status === 404) refreshAll();
    } finally {
      setSaving(false);
    }
  };

  const shortageCount = inventory.filter((item) => item.below_threshold).length;

  return (
    <div className="module-content">
      <div className="module-heading">
        <div>
          <p className="eyebrow">RESOURCE ALLOCATION</p>
          <h2>Match stock to a request</h2>
          <p>Every allocation counts against a specific need, so a request stays open until what was asked for is met.</p>
        </div>
        <span className="result-count">
          {inventory.length} {inventory.length === 1 ? 'stock item' : 'stock items'}
          {shortageCount > 0 ? ` · ${shortageCount} below reorder point` : ''}
        </span>
      </div>

      <div className="allocation-workspace">
        <section className="allocation-panel" aria-labelledby="allocation-stock-title">
          <div className="allocation-panel-heading">
            <h3 id="allocation-stock-title">1. Choose stock</h3>
            <span className="allocation-panel-note">{visibleInventory.length} shown</span>
          </div>

          <label className="allocation-field allocation-search">
            <span>Search item, shelter or category</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rice, Kalady, Medical…"
            />
          </label>

          {inventoryLoading ? (
            <p className="allocation-note">Loading inventory…</p>
          ) : inventoryError ? (
            <div role="alert">
              <p className="action-feedback is-error">{inventoryError}</p>
              <button className="secondary-button" type="button" onClick={() => { setInventoryLoading(true); void fetchInventory(); }}>Retry inventory</button>
            </div>
          ) : visibleInventory.length === 0 ? (
            <p className="empty-state">No stock matches that search. Clear the search to see everything held across shelters.</p>
          ) : (
            <div className="table-scroll allocation-stock-scroll">
              <table className="data-table allocation-stock-table">
                <thead>
                  <tr>
                    <th scope="col"><span className="visually-hidden">Select</span></th>
                    <th scope="col">Item</th>
                    <th scope="col">Shelter</th>
                    <th scope="col">On hand</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleInventory.map((item) => (
                    <tr key={item.supply_id} className={item.supply_id === selectedSupplyId ? 'is-selected' : undefined}>
                      <td>
                        <input
                          type="radio"
                          name="allocation-stock"
                          checked={item.supply_id === selectedSupplyId}
                          onChange={() => setSelectedSupplyId(item.supply_id)}
                          aria-label={`Select ${item.item_name} held at ${item.shelter_name}`}
                        />
                      </td>
                      <td>
                        <strong className="table-primary">{item.item_name}</strong>
                        <small className="table-secondary">{item.category_name ?? 'Uncategorised'}</small>
                        {item.below_threshold && <small className="stock-warning">Below reorder point</small>}
                      </td>
                      <td>{item.shelter_name}</td>
                      <td>{quantityLabel(item.quantity, item.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="allocation-panel" aria-labelledby="allocation-request-title">
          <div className="allocation-panel-heading">
            <h3 id="allocation-request-title">2. Choose the request it serves</h3>
            {selectedSupply && (
              <span className="allocation-panel-note">
                {quantityLabel(selectedSupply.quantity, selectedSupply.unit)} of {selectedSupply.item_name} · {selectedSupply.shelter_name}
              </span>
            )}
          </div>

          {!selectedSupply ? (
            <p className="empty-state">Select a stock item first. Nothing is allocated until you confirm.</p>
          ) : requestsLoading ? (
            <p className="allocation-note">Loading open requests…</p>
          ) : requestsError ? (
            <div role="alert">
              <p className="action-feedback is-error">{requestsError}</p>
              <button className="secondary-button" type="button" onClick={() => { setRequestsLoading(true); void fetchRequests(); }}>Retry requests</button>
            </div>
          ) : candidates.length === 0 ? (
            <p className="empty-state">
              No open request is waiting for {selectedSupply.category_name ? selectedSupply.category_name.toLowerCase() : 'this kind of stock'}.
              Requests that only need shelter are served by check-in, not by allocating supplies.
            </p>
          ) : (
            <ul className="allocation-candidate-list">
              {candidates.map(({ request, needs, exact }) => {
                const isSelected = request.request_id === selectedRequestId;
                return (
                  <li key={request.request_id}>
                    <button
                      type="button"
                      className={`allocation-candidate${isSelected ? ' is-selected' : ''}`}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedRequestId(request.request_id)}
                    >
                      <span className="candidate-marker" aria-hidden="true">{isSelected ? '●' : '○'}</span>
                      <span className="candidate-body">
                        <span className="candidate-heading">
                          <strong>{request.requester_name || 'Unnamed requester'}</strong>
                          <span className="candidate-request-no">Request {String(request.request_id).padStart(4, '0')}</span>
                          <span className={`urgency-pill urgency-${request.effective_priority}`}>
                            <span className="urgency-dot" />priority {request.effective_priority}/5
                          </span>
                          {request.status === 'partially_fulfilled' && <span className="status-pill is-near-full"><span className="status-dot" />partly served</span>}
                        </span>
                        <span className="candidate-meta">
                          <span>{request.request_type?.trim() || 'Type not specified'}</span>
                          <span>{request.num_people} {request.num_people === 1 ? 'person' : 'people'}</span>
                          <span>{requestArea(request)}</span>
                          {!exact && <span className="candidate-estimate">estimated need — supply type not specific</span>}
                        </span>
                        <span className="candidate-needs">
                          {needs.map((need) => (
                            <span key={need.need_id} className="candidate-need">
                              {need.item_label}: {remainingOf(need)} of {need.quantity_needed} still needed
                            </span>
                          ))}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selectedCandidate && (
            <form className="allocation-confirm" onSubmit={submitAllocation}>
              {selectedCandidate.needs.length > 1 && (
                <fieldset className="allocation-need-choice">
                  <legend>Which need does this stock satisfy?</legend>
                  {selectedCandidate.needs.map((need) => (
                    <label key={need.need_id} className="allocation-need-option">
                      <input
                        type="radio"
                        name="allocation-need"
                        checked={need.need_id === selectedNeedId}
                        onChange={() => { setSelectedNeedId(need.need_id); setQuantity('1'); }}
                      />
                      <span>{need.item_label} — {remainingOf(need)} of {need.quantity_needed} still needed</span>
                    </label>
                  ))}
                </fieldset>
              )}

              <label className="allocation-field">
                <span>Quantity to send (max {maxQuantity})</span>
                <input
                  type="number"
                  min="1"
                  max={maxQuantity}
                  step="1"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  disabled={!selectedNeed || maxQuantity < 1}
                  required
                />
              </label>

              {selectedNeed && (
                <p className="allocation-summary">
                  Sending <strong>{quantityValid ? quantityLabel(parsedQuantity, selectedSupply?.unit ?? null) : '…'}</strong> of{' '}
                  <strong>{selectedSupply?.item_name}</strong> from <strong>{selectedSupply?.shelter_name}</strong> to{' '}
                  <strong>request #{selectedCandidate.request.request_id}</strong>
                  {' '}({selectedNeed.item_label}).
                  {selectedSupply && <span> {selectedSupply.quantity} in stock; this leaves {Math.max(0, selectedSupply.quantity - parsedQuantity)}.</span>}
                </p>
              )}

              <button className="primary-button" type="submit" disabled={saving || !selectedNeed || !quantityValid}>
                {saving ? 'Allocating…' : 'Confirm allocation'}
              </button>
              {!selectedNeed && <p className="allocation-note">Choose which need this stock covers.</p>}
              {maxQuantity < 1 && <p className="allocation-note">Nothing can be sent: either the shelf is empty or this need is already met.</p>}
            </form>
          )}

          {feedback && (
            <p className={`action-feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
              {feedback.message}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
