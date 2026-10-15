import { useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../lib/api';
import type { NearestShelter } from '../types';

type SearchStatus = 'idle' | 'locating' | 'searching' | 'error';

export default function FindShelter() {
  const [shelters, setShelters] = useState<NearestShelter[]>([]);
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  const locateAndSearch = () => {
    setStatus('locating');
    setErrorMessage('');
    setShelters([]);
    setCoords(null);
    setHasSearched(false);

    if (!navigator.geolocation) {
      setStatus('error');
      setErrorMessage('This browser does not support location sharing. You can try again on a device with location enabled.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        setCoords([latitude, longitude]);
        setStatus('searching');

        try {
          const response = await api.get<NearestShelter[]>('/shelters/nearest', {
            params: { lat: latitude, lon: longitude, people: 1 },
          });
          setShelters(response.data);
          setHasSearched(true);
          setStatus('idle');
        } catch (requestError) {
          console.error('Failed to fetch nearest shelters', requestError);
          setStatus('error');
          setErrorMessage('Shelter information is temporarily unavailable. Please try again in a moment.');
        }
      },
      (locationError) => {
        setStatus('error');
        setErrorMessage(locationError.code === locationError.PERMISSION_DENIED
          ? 'Location access is turned off. Allow location access in your browser settings, then try again.'
          : 'We could not determine your location. Check your device settings and try again.');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  };

  const searching = status === 'locating' || status === 'searching';

  return (
    <div className="find-layout">
      <div className="find-main-column">
        <div className="module-heading">
          <div>
            <p className="eyebrow">SHELTER DIRECTORY</p>
            <h2>Nearby options</h2>
            <p>Share your location to see shelters ordered by distance.</p>
          </div>
          <button className="primary-button location-button" type="button" onClick={locateAndSearch} disabled={searching}>
            <span aria-hidden="true">⌖</span>{searching ? (status === 'locating' ? 'Finding your location…' : 'Searching…') : 'Use my location'}
          </button>
        </div>

        {status === 'error' && <div className="form-error-panel" role="alert"><span className="error-symbol" aria-hidden="true">!</span><p>{errorMessage}</p></div>}

        {searching && (
          <div className="loading-state" role="status"><span className="loading-mark" />{status === 'locating' ? 'Waiting for location permission…' : 'Looking for nearby shelters…'}</div>
        )}

        {!searching && hasSearched && shelters.length === 0 && (
          <div className="empty-state"><span className="eyebrow">NO RESULTS</span><p>No nearby shelters with available space were returned. Try again later or submit a help request.</p></div>
        )}

        {!searching && shelters.length > 0 && (
          <div className="shelter-results" aria-live="polite">
            <div className="results-heading"><span className="eyebrow">NEAREST FIRST</span><span className="result-count">{shelters.length} {shelters.length === 1 ? 'option' : 'options'}</span></div>
            <ol className="shelter-result-list">
              {shelters.map((shelter, index) => (
                <li className="shelter-result" key={shelter.shelter_id}>
                  <span className="result-rank">{String(index + 1).padStart(2, '0')}</span>
                  <div className="result-copy"><strong>{shelter.name}</strong><small>{Number(shelter.distance_km).toFixed(1)} km from your location</small></div>
                  <span className="spaces-count"><strong>{shelter.available_space}</strong><small>spaces</small></span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {!searching && !hasSearched && status !== 'error' && (
          <div className="empty-state find-prompt"><span className="location-symbol" aria-hidden="true">⌖</span><h3>Start with your location</h3><p>Your location is used to find nearby shelters. It is optional and is not needed to submit a help request.</p></div>
        )}
      </div>

      <aside className="find-map-column" aria-label="Map and location information">
        <div className="map-heading"><span className="eyebrow">LOCATION VIEW</span><span className="map-status"><span className={`status-dot ${coords ? 'is-on' : ''}`} />{coords ? 'Location set' : 'Waiting for location'}</span></div>
        {coords ? (
          <MapContainer key={`${coords[0]}-${coords[1]}`} center={coords} zoom={11} className="shelter-map" scrollWheelZoom={false}>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={coords}><Popup>Your approximate location</Popup></Marker>
          </MapContainer>
        ) : (
          <div className="map-placeholder"><span className="map-grid" aria-hidden="true" /><span className="map-pin" aria-hidden="true">⌖</span><p>Map appears after you share your location</p></div>
        )}
        <p className="map-caption">Nearby shelter locations are listed with distance and open spaces when available.</p>
      </aside>
    </div>
  );
}
