import { useEffect, useState } from 'react';
import api from '../lib/api';
import type { RankedShelter } from '../types';

export default function RankedOccupancy() {
  const [ranked, setRanked] = useState<RankedShelter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<RankedShelter[]>('/shelters/ranked')
      .then((response) => setRanked(response.data))
      .catch((requestError) => {
        console.error('Failed to fetch ranked shelters', requestError);
        setError('Occupancy rankings are temporarily unavailable.');
      })
      .finally(() => setLoading(false));
  }, []);

  const byEvent = ranked.reduce<Record<string, RankedShelter[]>>((groups, shelter) => {
    const eventKey = shelter.event_id ?? 'unassigned';
    (groups[eventKey] ||= []).push(shelter);
    return groups;
  }, {});

  if (loading) return <div className="loading-state"><span className="loading-mark" />Loading occupancy rankings…</div>;
  if (error) return <div className="empty-state" role="alert"><span className="eyebrow">UNAVAILABLE</span><p>{error}</p></div>;

  return (
    <div className="module-content">
      <div className="module-heading">
        <div>
          <p className="eyebrow">CAPACITY PRESSURE</p>
          <h2>Occupancy ranking</h2>
          <p>Higher utilization appears first within each event.</p>
        </div>
        <span className="result-count">{ranked.length} shelters</span>
      </div>

      {Object.keys(byEvent).length === 0 ? (
        <div className="empty-state"><span className="eyebrow">NO RANKINGS YET</span><p>Ranked shelter data will appear here when available.</p></div>
      ) : (
        <div className="event-grid">
          {Object.entries(byEvent).map(([eventKey, shelters]) => {
            const eventId = shelters[0].event_id;
            const eventTitle = shelters[0].event_name?.trim() || (eventId === null ? 'Unassigned event' : 'Unknown event');
            const headingId = `event-${eventId ?? eventKey}`;
            return (
              <section className="event-card" key={eventKey} aria-labelledby={headingId}>
                <div className="event-card-header"><div><span className="eyebrow">RESPONSE EVENT</span><h3 id={headingId}>{eventTitle}</h3></div><span className="event-count">{shelters.length} {shelters.length === 1 ? 'shelter' : 'shelters'}</span></div>
                <ol className="ranking-list">
                  {[...shelters].sort((left, right) => left.occupancy_rank - right.occupancy_rank).map((shelter) => {
                    const percentage = Math.min(100, Math.max(0, Number(shelter.occupancy_pct)));
                    return (
                      <li className="ranking-item" key={shelter.shelter_id}>
                        <span className="ranking-number">{String(shelter.occupancy_rank).padStart(2, '0')}</span>
                        <div className="ranking-copy"><strong>{shelter.name}</strong><div className="capacity-track"><span className="capacity-fill" style={{ width: `${percentage}%` }} /></div></div>
                        <span className="ranking-percent">{percentage.toFixed(1)}<small>%</small></span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
