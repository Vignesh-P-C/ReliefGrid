import { useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../lib/api';
import type { NearestShelter } from '../types';

export default function FindShelter() {
  const [shelters, setShelters] = useState<NearestShelter[]>([]);
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [status, setStatus] = useState<'idle' | 'locating' | 'error'>('idle');

  const locateAndSearch = () => {
    setStatus('locating');
    if (!navigator.geolocation) {
      setStatus('error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setCoords([latitude, longitude]);
        try {
          const res = await api.get<NearestShelter[]>('/shelters/nearest', {
            params: { lat: latitude, lon: longitude, people: 1 },
          });
          setShelters(res.data);
          setStatus('idle');
        } catch (err) {
          console.error('Failed to fetch nearest shelters', err);
          setStatus('error');
        }
      },
      () => setStatus('error')
    );
  };

  return (
    <div>
      <h2>Find a Shelter Near You</h2>
      <button onClick={locateAndSearch}>
        {status === 'locating' ? 'Locating...' : 'Use my location'}
      </button>
      {status === 'error' && <p style={{ color: '#c62828' }}>Couldn't get your location. Please allow location access and try again.</p>}

      {coords && (
        <MapContainer center={coords} zoom={11} style={{ height: 320, marginTop: '1rem' }}>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker position={coords}>
            <Popup>You are here</Popup>
          </Marker>
        </MapContainer>
      )}

      {shelters.length > 0 && (
        <ul style={{ marginTop: '1rem' }}>
          {shelters.map((s) => (
            <li key={s.shelter_id}>
              <strong>{s.name}</strong> — {s.distance_km} km away, {s.available_space} spaces free
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
