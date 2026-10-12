import { useEffect, useState } from 'react';
import api from '../lib/api';
import type { ShortageItem } from '../types';

export default function ShortageBanner() {
  const [shortages, setShortages] = useState<ShortageItem[]>([]);

  useEffect(() => {
    api
      .get<ShortageItem[]>('/supplies/shortages')
      .then((res) => setShortages(res.data))
      .catch((err) => console.error('Failed to fetch shortages', err));
  }, []);

  if (shortages.length === 0) return null;

  return (
    <div
      style={{
        background: '#3a1f1f',
        border: '1px solid #c62828',
        borderRadius: 6,
        padding: '0.75rem 1rem',
        marginBottom: '1rem',
      }}
    >
      <strong>⚠ Critical Supply Shortage</strong>
      <ul style={{ margin: '0.5rem 0 0' }}>
        {shortages.map((s) => (
          <li key={`${s.shelter_id}-${s.item_name}`}>
            {s.shelter_name}: {s.item_name} — {s.quantity} left (reorder at {s.reorder_threshold})
          </li>
        ))}
      </ul>
    </div>
  );
}
