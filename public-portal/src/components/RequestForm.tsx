import { useEffect, useState, type FormEvent } from 'react';
import api from '../lib/api';
import type { DisasterEvent } from '../types';

type RequestType = 'shelter' | 'medical' | 'food' | 'rescue';

// Matches the Users/Aid_Requests column limits enforced server-side (Audit #34).
const NAME_MAX_LENGTH = 100;
const PHONE_MAX_LENGTH = 15;

const initialForm = {
  requester_name: '',
  phone: '',
  request_type: 'shelter' as RequestType,
  num_people: 1,
  urgency_level: 3,
  event_id: '',
};

const urgencyLabels: Record<number, string> = {
  1: 'Can wait',
  2: 'Soon',
  3: 'Needs attention',
  4: 'Urgent',
  5: 'Critical',
};

function readErrorMessage(requestError: unknown, fallback: string): string {
  const error = requestError as { response?: { data?: { message?: string } } };
  return error.response?.data?.message || fallback;
}

export default function RequestForm() {
  const [form, setForm] = useState(initialForm);
  const [events, setEvents] = useState<DisasterEvent[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [referenceId, setReferenceId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<DisasterEvent[]>('/events')
      .then((response) => {
        setEvents(response.data);
        // A single active event is unambiguous, so pre-select it (Audit #42).
        if (response.data.length === 1) {
          setForm((previous) => ({ ...previous, event_id: String(response.data[0].event_id) }));
        }
      })
      .catch((requestError) => console.error('Failed to fetch active events', requestError));
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError('');

    const trimmedName = form.requester_name.trim();
    const trimmedPhone = form.phone.trim();
    if (!trimmedName || trimmedName.length > NAME_MAX_LENGTH) {
      setError(`Name is required and must be ${NAME_MAX_LENGTH} characters or fewer.`);
      return;
    }
    if (!trimmedPhone || trimmedPhone.length > PHONE_MAX_LENGTH) {
      setError(`Phone number is required and must be ${PHONE_MAX_LENGTH} characters or fewer.`);
      return;
    }

    setSubmitting(true);

    const submitWithLocation = async (latitude?: number, longitude?: number) => {
      try {
        const response = await api.post('/aid-requests', {
          ...form,
          requester_name: trimmedName,
          phone: trimmedPhone,
          event_id: form.event_id ? Number(form.event_id) : null,
          latitude,
          longitude,
        });
        setReferenceId(response.data?.request_id ?? null);
        setSubmitted(true);
      } catch (requestError) {
        console.error('Failed to submit request', requestError);
        setError(readErrorMessage(requestError, 'Your request could not be sent right now. Please check your connection and try again.'));
      } finally {
        setSubmitting(false);
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => { void submitWithLocation(position.coords.latitude, position.coords.longitude); },
        () => { void submitWithLocation(); },
        { enableHighAccuracy: false, timeout: 7000, maximumAge: 60000 },
      );
    } else {
      await submitWithLocation();
    }
  };

  if (submitted) {
    return (
      <div className="request-success" role="status">
        <span className="success-mark" aria-hidden="true">✓</span>
        <p className="eyebrow">REQUEST RECEIVED</p>
        <h2>We’ve sent your request.</h2>
        {referenceId !== null && (
          <p className="request-reference"><strong>Your reference number is #{referenceId}.</strong> Quote this number if you call or follow up about this request.</p>
        )}
        <p>Your details are now with the response team. Keep your phone nearby in case a coordinator needs to contact you.</p>
        <button className="secondary-button" type="button" onClick={() => { setForm(initialForm); setSubmitted(false); setReferenceId(null); setError(''); }}>Send another request</button>
      </div>
    );
  }

  return (
    <div className="request-layout">
      <div className="request-form-column">
        <div className="module-heading">
          <div>
            <p className="eyebrow">AID REQUEST</p>
            <h2>Tell us what you need</h2>
            <p>Complete the details below. A phone number helps coordinators follow up.</p>
          </div>
        </div>

        <form className="request-form" onSubmit={handleSubmit}>
          <div className="form-fields-grid">
            <label className="field-group field-wide" htmlFor="requester-name">
              <span>Full name</span>
              <input id="requester-name" name="name" autoComplete="name" required maxLength={NAME_MAX_LENGTH} value={form.requester_name} onChange={(event) => setForm((previous) => ({ ...previous, requester_name: event.target.value }))} placeholder="Name of the person requesting help" />
            </label>

            <label className="field-group field-wide" htmlFor="requester-phone">
              <span>Phone number</span>
              <input id="requester-phone" name="tel" type="tel" autoComplete="tel" required maxLength={PHONE_MAX_LENGTH} value={form.phone} onChange={(event) => setForm((previous) => ({ ...previous, phone: event.target.value }))} placeholder="A number coordinators can reach" />
            </label>

            <label className="field-group" htmlFor="request-type">
              <span>Type of help</span>
              <select id="request-type" name="request_type" value={form.request_type} onChange={(event) => setForm((previous) => ({ ...previous, request_type: event.target.value as RequestType }))}>
                <option value="shelter">Shelter</option>
                <option value="medical">Medical</option>
                <option value="food">Food or water</option>
                <option value="rescue">Rescue</option>
              </select>
            </label>

            <label className="field-group" htmlFor="people-count">
              <span>People needing help</span>
              <input id="people-count" name="num_people" type="number" min={1} max={999} required value={form.num_people} onChange={(event) => setForm((previous) => ({ ...previous, num_people: Math.max(1, Number(event.target.value)) }))} />
            </label>

            {events.length > 1 && (
              <label className="field-group field-wide" htmlFor="event-select">
                <span>Which disaster is this related to?</span>
                <select id="event-select" value={form.event_id} onChange={(event) => setForm((previous) => ({ ...previous, event_id: event.target.value }))}>
                  <option value="">Not sure / general request</option>
                  {events.map((item) => (
                    <option key={item.event_id} value={item.event_id}>{item.name}{item.region ? ` — ${item.region}` : ''}</option>
                  ))}
                </select>
              </label>
            )}

            <div className="field-group field-wide urgency-field">
              <div className="urgency-label-row"><label htmlFor="urgency-level">Urgency</label><span className={`urgency-value urgency-${form.urgency_level}`}>{urgencyLabels[form.urgency_level]}</span></div>
              <input id="urgency-level" className="urgency-range" name="urgency_level" type="range" min={1} max={5} step={1} value={form.urgency_level} onChange={(event) => setForm((previous) => ({ ...previous, urgency_level: Number(event.target.value) }))} aria-valuetext={`${form.urgency_level} of 5, ${urgencyLabels[form.urgency_level]}`} />
              <div className="range-labels"><span>Can wait</span><span>Critical</span></div>
            </div>
          </div>

          <div className="location-note"><span className="location-note-mark" aria-hidden="true">⌖</span><p><strong>Location is optional.</strong> We may ask your browser for an approximate location while sending this request. If you decline, the request is still sent without it.</p></div>

          {error && <div className="form-error-panel" role="alert"><span className="error-symbol" aria-hidden="true">!</span><p>{error}</p></div>}

          <div className="form-submit-row"><span className="form-privacy-note">Your information is shared with response coordinators.</span><button className="primary-button submit-request" type="submit" disabled={submitting}>{submitting ? 'Sending request…' : 'Submit request'}<span aria-hidden="true">→</span></button></div>
        </form>
      </div>

      <aside className="request-aside">
        <p className="eyebrow">WHAT HAPPENS NEXT</p>
        <ol className="next-steps-list">
          <li><span>01</span><div><strong>Your request is recorded</strong><p>The details you provide go to the response team.</p></div></li>
          <li><span>02</span><div><strong>A coordinator reviews it</strong><p>Requests are assessed alongside current needs and capacity.</p></div></li>
          <li><span>03</span><div><strong>Keep your phone available</strong><p>A coordinator may contact you using the number provided.</p></div></li>
        </ol>
        <p className="request-aside-footnote">If you are in immediate danger, contact your local emergency services.</p>
      </aside>
    </div>
  );
}
