import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';
import { quantityLabel } from '../lib/format';
import { socket } from '../lib/socket';
import type { ShortageItem } from '../types';

interface ShortageBannerProps {
  onAllocate: (supplyId: number) => void;
}

export default function ShortageBanner({ onAllocate }: ShortageBannerProps) {
  const [shortages, setShortages] = useState<ShortageItem[]>([]);
  const [error, setError] = useState('');

  const fetchShortages = useCallback(async () => {
    try {
      const response = await api.get<ShortageItem[]>('/supplies/shortages');
      setShortages(response.data);
      setError('');
    } catch (requestError) {
      console.error('Failed to fetch shortages', requestError);
      const failure = requestError as { response?: { data?: { message?: string } } };
      setError(failure.response?.data?.message || 'Supply shortages are temporarily unavailable. Try refreshing.');
    }
  }, []);

  useEffect(() => {
    void fetchShortages();
    socket.on('supply-allocated', fetchShortages);
    socket.on('connect', fetchShortages);
    return () => {
      socket.off('supply-allocated', fetchShortages);
      socket.off('connect', fetchShortages);
    };
  }, [fetchShortages]);

  if (error) {
    return (
      <section className="shortage-panel" aria-labelledby="shortage-title" role="alert">
        <div className="shortage-symbol" aria-hidden="true">!</div>
        <div className="shortage-content">
          <div className="shortage-heading">
            <div><p className="eyebrow">ACTION REQUIRED</p><h2 id="shortage-title">Critical supply shortage</h2></div>
            <button className="secondary-button" onClick={() => { void fetchShortages(); }}>Retry</button>
          </div>
          <p className="allocation-note">{error}</p>
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
                <strong>
                  {quantityLabel(shortage.quantity, shortage.unit)} left
                  <small> · reorder at {shortage.reorder_threshold}</small>
                </strong>
                <button
                  className="secondary-button shortage-action"
                  type="button"
                  onClick={() => onAllocate(shortage.supply_id)}
                >
                  Allocate
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
