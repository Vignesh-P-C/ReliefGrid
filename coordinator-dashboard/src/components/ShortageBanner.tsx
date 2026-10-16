import { useEffect, useState } from 'react';
import api from '../lib/api';
import type { ShortageItem } from '../types';

export default function ShortageBanner() {
  const [shortages, setShortages] = useState<ShortageItem[]>([]);

  useEffect(() => {
    api
      .get<ShortageItem[]>('/supplies/shortages')
      .then((response) => setShortages(response.data))
      .catch((error) => console.error('Failed to fetch shortages', error));
  }, []);

  if (shortages.length === 0) return null;

  return (
    <section className="shortage-panel" aria-labelledby="shortage-title" role="status">
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
            <li key={`${shortage.shelter_id}-${shortage.item_name}`}>
              <span className="shortage-item-name">{shortage.item_name}</span>
              <span>{shortage.shelter_name}</span>
              <strong>{shortage.quantity} left <small>· reorder at {shortage.reorder_threshold}</small></strong>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
