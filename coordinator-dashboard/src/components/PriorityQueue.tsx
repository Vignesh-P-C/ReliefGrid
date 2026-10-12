import { useEffect, useState } from 'react';
import api from '../lib/api';
import { socket } from '../lib/socket';
import type { QueuedRequest } from '../types';

export default function PriorityQueue() {
  const [queue, setQueue] = useState<QueuedRequest[]>([]);

  const fetchQueue = () => {
    api
      .get<QueuedRequest[]>('/aid-requests/queue')
      .then((res) => setQueue(res.data))
      .catch((err) => console.error('Failed to fetch queue', err));
  };

  useEffect(() => {
    fetchQueue();
    socket.on('new-aid-request', fetchQueue);
    return () => {
      socket.off('new-aid-request', fetchQueue);
    };
  }, []);

  return (
    <div>
      <h2>Priority Queue</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Requester</th>
            <th>Urgency</th>
            <th>People</th>
            <th>Waiting (min)</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((r) => (
            <tr key={r.request_id}>
              <td>{r.requester_name}</td>
              <td style={{ textAlign: 'center' }}>{r.urgency_level}/5</td>
              <td style={{ textAlign: 'center' }}>{r.num_people}</td>
              <td style={{ textAlign: 'center' }}>{r.waiting_minutes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
