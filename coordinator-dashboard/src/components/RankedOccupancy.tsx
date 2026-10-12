import { useEffect, useState } from 'react';
import api from '../lib/api';
import type { RankedShelter } from '../types';

// Surfaces the RANK() OVER (...) window-function query from the DB layer —
// which shelter needs attention first, within each disaster event.
export default function RankedOccupancy() {
  const [ranked, setRanked] = useState<RankedShelter[]>([]);

  useEffect(() => {
    api
      .get<RankedShelter[]>('/shelters/ranked')
      .then((res) => setRanked(res.data))
      .catch((err) => console.error('Failed to fetch ranked shelters', err));
  }, []);

  const byEvent = ranked.reduce<Record<number, RankedShelter[]>>((acc, s) => {
    (acc[s.event_id] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div>
      <h2>Occupancy Ranking (by disaster event)</h2>
      {Object.entries(byEvent).map(([eventId, list]) => (
        <div key={eventId} style={{ marginBottom: '1rem' }}>
          <h4>Event #{eventId}</h4>
          <ol>
            {list
              .sort((a, b) => a.occupancy_rank - b.occupancy_rank)
              .map((s) => (
                <li key={s.shelter_id}>
                  {s.name} — {s.occupancy_pct}% full (rank #{s.occupancy_rank})
                </li>
              ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
