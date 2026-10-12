import { useEffect, useState, useCallback } from 'react';
import api from '../lib/api';
import { socket } from '../lib/socket';
import type { ShelterLiveStatus } from '../types';

const statusColor: Record<ShelterLiveStatus['status'], string> = {
  available: '#2e7d32',
  'near-full': '#e08e00',
  full: '#c62828',
};

export default function ShelterBoard() {
  const [shelters, setShelters] = useState<ShelterLiveStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchShelters = useCallback(async () => {
    try {
      const res = await api.get<ShelterLiveStatus[]>('/shelters');
      setShelters(res.data);
    } catch (err) {
      console.error('Failed to fetch shelters', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchShelters();

    // Re-fetch whenever any coordinator's check-in changes a shelter's
    // capacity — this is the live-sync proof point for the demo.
    socket.on('shelter-updated', fetchShelters);
    return () => {
      socket.off('shelter-updated', fetchShelters);
    };
  }, [fetchShelters]);

  if (loading) return <p>Loading shelters...</p>;

  return (
    <div>
      <h2>Live Shelter Board</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Shelter</th>
            <th>Occupied / Total</th>
            <th>Occupancy %</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {shelters.map((s) => (
            <tr key={s.shelter_id}>
              <td>{s.name}</td>
              <td style={{ textAlign: 'center' }}>
                {s.capacity_occupied} / {s.capacity_total}
              </td>
              <td style={{ textAlign: 'center' }}>{s.occupancy_pct}%</td>
              <td style={{ textAlign: 'center', color: statusColor[s.status] }}>
                {s.status}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
