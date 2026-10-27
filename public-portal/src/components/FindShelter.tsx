import { useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../lib/api';
import type { NearestShelter, ShelterListing } from '../types';

type SearchStatus = 'idle' | 'locating' | 'searching' | 'error';

// Fallback map center for manual location picking when GPS is unavailable or declined (Audit #38).
const DEFAULT_CENTER: [number, number] = [10.5, 76.3];

function LocationPicker({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click: (event) => onPick(event.latlng.lat, event.latlng.lng),
  });
  return null;
}

export default function FindShelter() {
  const [shelters, setShelters] = useState<NearestShelter[]>([]);
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [householdSize, setHouseholdSize] = useState('1');
  const [pickingLocation, setPickingLocation] = useState(false);
  const [allShelters, setAllShelters] = useState<ShelterListing[] | null>(null);
  const [browsing, setBrowsing] = useState(false);

  const searchFromCoords = async (latitude: number, longitude: number) => {
    setCoords([latitude, longitude]);
    setStatus('searching');
    const people = Math.max(1, Math.trunc(Number(householdSize) || 1));

    try {
      const response = await api.get<NearestShelter[]>('/shelters/nearest', {
        params: { lat: latitude, lon: longitude, people },
      });
      setShelters(response.data);
      setAllShelters(null);
      setHasSearched(true);
      setStatus('idle');
    } catch (requestError) {
      console.error('Failed to fetch nearest shelters', requestError);
      setStatus('error');
      setErrorMessage('Shelter information is temporarily unavailable. Please try again in a moment.');
    }
  };

  const locateAndSearch = () => {
    setStatus('locating');
    setErrorMessage('');
    setShelters([]);
    setCoords(null);
    setHasSearched(false);
    setAllShelters(null);
    setPickingLocation(false);

    if (!navigator.geolocation) {
      setStatus('error');
      setErrorMessage('This browser does not support location sharing. Pick a point on the map instead, or browse every active shelter.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => { void searchFromCoords(position.coords.latitude, position.coords.longitude); },
      (locationError) => {
        setStatus('error');
        setErrorMessage(locationError.code === locationError.PERMISSION_DENIED
          ? 'Location access is turned off. Pick a point on the map instead, or browse every active shelter.'
          : 'We could not determine your location. Pick a point on the map instead, or browse every active shelter.');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  };

  const startManualPick = () => {
    setStatus('idle');
    setErrorMessage('');
    setAllShelters(null);
    setPickingLocation(true);
  };

  const handleManualPick = (latitude: number, longitude: number) => {
    setPickingLocation(false);
    void searchFromCoords(latitude, longitude);
  };

  const browseAllShelters = async () => {
    setBrowsing(true);
    setStatus('idle');
    setErrorMessage('');
    setPickingLocation(false);
    setShelters([]);
    setCoords(null);
    try {
      const response = await api.get<ShelterListing[]>('/shelters');
      // A closed shelter must never appear in a public "all shelters" list.
      // `!== false` rather than `=== true` so an API running without the Phase 3
      // migration (no is_active field at all) still lists every shelter instead
      // of silently showing an empty list.
      setAllShelters(response.data.filter((shelter) => shelter.is_active !== false));
      setHasSearched(true);
    } catch (requestError) {
      console.error('Failed to fetch shelters', requestError);
      setErrorMessage('Shelter information is temporarily unavailable. Please try again in a moment.');
    } finally {
      setBrowsing(false);
    }
  };

  const searching = status === 'locating' || status === 'searching';
  const shelterMarkers = shelters.filter((shelter) => shelter.latitude !== null && shelter.longitude !== null);

  return (
    <div className="find-layout">
      <div className="find-main-column">
        <div className="module-heading">
          <div>
            <p className="eyebrow">SHELTER DIRECTORY</p>
            <h2>Nearby options</h2>
            <p>Share your location to see shelters ordered by distance.</p>
          </div>
        </div>

        <div className="find-controls">
          <label className="field-group household-field" htmlFor="household-size">
            <span>People in your household</span>
            <input id="household-size" type="number" min={1} max={999} value={householdSize} onChange={(event) => setHouseholdSize(event.target.value)} />
          </label>
          <div className="find-controls-actions">
            <button className="primary-button location-button" type="button" onClick={locateAndSearch} disabled={searching}>
              <span aria-hidden="true">⌖</span>{searching ? (status === 'locating' ? 'Finding your location…' : 'Searching…') : 'Use my location'}
            </button>
            <button className="secondary-button" type="button" onClick={startManualPick} disabled={searching}>Pick on map</button>
            <button className="secondary-button" type="button" onClick={() => { void browseAllShelters(); }} disabled={browsing}>Browse all shelters</button>
          </div>
        </div>

        {pickingLocation && <p className="manual-pick-hint">Tap or click a point on the map to search from that location.</p>}

        {errorMessage && <div className="form-error-panel" role="alert"><span className="error-symbol" aria-hidden="true">!</span><p>{errorMessage}</p></div>}

        {(searching || browsing) && (
          <div className="loading-state" role="status"><span className="loading-mark" />{status === 'locating' ? 'Waiting for location permission…' : browsing ? 'Loading shelters…' : 'Looking for nearby shelters…'}</div>
        )}

        {!searching && !browsing && hasSearched && shelters.length === 0 && !allShelters && (
          <div className="empty-state"><span className="eyebrow">NO RESULTS</span><p>No shelters were returned. Try again later, browse all shelters, or submit a help request.</p></div>
        )}

        {!searching && shelters.length > 0 && (
          <div className="shelter-results" aria-live="polite">
            <div className="results-heading"><span className="eyebrow">NEAREST FIRST</span><span className="result-count">{shelters.length} {shelters.length === 1 ? 'option' : 'options'}</span></div>
            <ol className="shelter-result-list">
              {shelters.map((shelter, index) => (
                <li className={shelter.has_space ? 'shelter-result' : 'shelter-result is-full'} key={shelter.shelter_id}>
                  <span className="result-rank">{String(index + 1).padStart(2, '0')}</span>
                  <div className="result-copy">
                    <strong>{shelter.name}</strong>
                    <small>{Number(shelter.distance_km).toFixed(1)} km away{shelter.address ? ` · ${shelter.address}` : ''}</small>
                    <div className="result-links">
                      {shelter.latitude !== null && shelter.longitude !== null && (
                        <a href={`https://www.openstreetmap.org/?mlat=${shelter.latitude}&mlon=${shelter.longitude}#map=15/${shelter.latitude}/${shelter.longitude}`} target="_blank" rel="noreferrer">Directions</a>
                      )}
                      {shelter.contact_number && <a href={`tel:${shelter.contact_number}`}>Call</a>}
                    </div>
                  </div>
                  <span className="spaces-count"><strong>{shelter.available_space}</strong><small>{shelter.has_space ? 'spaces' : 'spaces · not enough for your group'}</small></span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {!browsing && allShelters && (
          <div className="shelter-results" aria-live="polite">
            <div className="results-heading"><span className="eyebrow">ALL ACTIVE SHELTERS</span><span className="result-count">{allShelters.length} {allShelters.length === 1 ? 'shelter' : 'shelters'}</span></div>
            {allShelters.length === 0 ? (
              <div className="empty-state"><span className="eyebrow">NO SHELTERS</span><p>There are no shelter records to show right now.</p></div>
            ) : (
              <ol className="shelter-result-list">
                {allShelters.map((shelter, index) => (
                  <li className={shelter.status === 'full' ? 'shelter-result is-full' : 'shelter-result'} key={shelter.shelter_id}>
                    <span className="result-rank">{String(index + 1).padStart(2, '0')}</span>
                    <div className="result-copy"><strong>{shelter.name}</strong><small>{shelter.capacity_occupied} / {shelter.capacity_total} occupied</small></div>
                    <span className="spaces-count"><strong>{Math.max(0, shelter.capacity_total - shelter.capacity_occupied)}</strong><small>spaces</small></span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {!searching && !browsing && !hasSearched && status !== 'error' && !pickingLocation && (
          <div className="empty-state find-prompt"><span className="location-symbol" aria-hidden="true">⌖</span><h3>Start with your location</h3><p>Your location is used to find nearby shelters. It is optional and is not needed to submit a help request. No GPS? Pick a point on the map, or browse every active shelter instead.</p></div>
        )}
      </div>

      <aside className="find-map-column" aria-label="Map and location information">
        <div className="map-heading"><span className="eyebrow">LOCATION VIEW</span><span className="map-status"><span className={`status-dot ${coords ? 'is-on' : ''}`} />{coords ? 'Location set' : pickingLocation ? 'Pick a point' : 'Waiting for location'}</span></div>
        {coords || pickingLocation ? (
          <MapContainer key={pickingLocation ? 'picker' : `${coords?.[0]}-${coords?.[1]}`} center={coords || DEFAULT_CENTER} zoom={coords ? 11 : 6} className="shelter-map" scrollWheelZoom={false}>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {pickingLocation && <LocationPicker onPick={handleManualPick} />}
            {coords && <Marker position={coords}><Popup>Your approximate location</Popup></Marker>}
            {shelterMarkers.map((shelter) => (
              <Marker key={shelter.shelter_id} position={[Number(shelter.latitude), Number(shelter.longitude)]}>
                <Popup>{shelter.name}{shelter.has_space ? ` · ${shelter.available_space} spaces` : ' · not enough space for your group'}</Popup>
              </Marker>
            ))}
          </MapContainer>
        ) : (
          <div className="map-placeholder"><span className="map-grid" aria-hidden="true" /><span className="map-pin" aria-hidden="true">⌖</span><p>Map appears after you share your location or pick a point</p></div>
        )}
        <p className="map-caption">Nearby shelter locations are listed with distance and open spaces when available.</p>
      </aside>
    </div>
  );
}
