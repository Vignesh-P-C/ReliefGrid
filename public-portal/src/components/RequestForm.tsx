import { useEffect, useState, type FormEvent } from 'react';
import api from '../lib/api';
import type { SupplyCategory } from '../types';

type RequestType = 'shelter' | 'medical' | 'food' | 'rescue';

const initialForm = {
  requester_name: '',
  phone: '',
  request_type: 'shelter' as RequestType,
  num_people: 1,
  urgency_level: 3,
};

const urgencyLabels: Record<number, string> = {
  1: 'Can wait',
  2: 'Soon',
  3: 'Needs attention',
  4: 'Urgent',
  5: 'Critical',
};

interface NeedDraft {
  checked: boolean;
  quantity: number;
}

export default function RequestForm() {
  const [form, setForm] = useState(initialForm);
  const [categories, setCategories] = useState<SupplyCategory[]>([]);
  const [categoriesUnavailable, setCategoriesUnavailable] = useState(false);
  const [needs, setNeeds] = useState<Record<number, NeedDraft>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get<SupplyCategory[]>('/supplies/categories')
      .then((response) => { if (active) setCategories(response.data); })
      .catch(() => { if (active) setCategoriesUnavailable(true); });
    return () => { active = false; };
  }, []);

  const toggleNeed = (categoryId: number, checked: boolean) => {
    setNeeds((previous) => ({
      ...previous,
      [categoryId]: { checked, quantity: previous[categoryId]?.quantity ?? form.num_people },
    }));
  };

  const changeNeedQuantity = (categoryId: number, quantity: number) => {
    setNeeds((previous) => ({
      ...previous,
      [categoryId]: { checked: true, quantity },
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError('');

    const selectedNeeds = Object.entries(needs).filter(([, draft]) => draft.checked);
    for (const [categoryId, draft] of selectedNeeds) {
      if (!Number.isInteger(draft.quantity) || draft.quantity < 1) {
        const name = categories.find((category) => category.category_id === Number(categoryId))?.name ?? 'each item';
        setError(`Enter how many of ${name} you need.`);
        return;
      }
    }

    setSubmitting(true);

    const submitWithLocation = async (latitude?: number, longitude?: number) => {
      try {
        await api.post('/aid-requests', {
          ...form,
          latitude,
          longitude,
          needs: selectedNeeds.map(([categoryId, draft]) => ({
            category_id: Number(categoryId),
            quantity_needed: draft.quantity,
          })),
        });
        setSubmitted(true);
      } catch (requestError) {
        console.error('Failed to submit request', requestError);
        const failure = requestError as { response?: { data?: { message?: string } } };
        setError(failure.response?.data?.message || 'Your request could not be sent right now. Please check your connection and try again.');
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
        <p>Your details are now with the response team. Keep your phone nearby in case a coordinator needs to contact you.</p>
        <button className="secondary-button" type="button" onClick={() => { setForm(initialForm); setNeeds({}); setSubmitted(false); setError(''); }}>Send another request</button>
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
              <input id="requester-name" name="name" autoComplete="name" required maxLength={120} value={form.requester_name} onChange={(event) => setForm((previous) => ({ ...previous, requester_name: event.target.value }))} placeholder="Name of the person requesting help" />
            </label>

            <label className="field-group field-wide" htmlFor="requester-phone">
              <span>Phone number</span>
              <input id="requester-phone" name="tel" type="tel" autoComplete="tel" required maxLength={30} value={form.phone} onChange={(event) => setForm((previous) => ({ ...previous, phone: event.target.value }))} placeholder="A number coordinators can reach" />
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

            <div className="field-group field-wide urgency-field">
              <div className="urgency-label-row"><label htmlFor="urgency-level">Urgency</label><span className={`urgency-value urgency-${form.urgency_level}`}>{urgencyLabels[form.urgency_level]}</span></div>
              <input id="urgency-level" className="urgency-range" name="urgency_level" type="range" min={1} max={5} step={1} value={form.urgency_level} onChange={(event) => setForm((previous) => ({ ...previous, urgency_level: Number(event.target.value) }))} aria-valuetext={`${form.urgency_level} of 5, ${urgencyLabels[form.urgency_level]}`} />
              <div className="range-labels"><span>Can wait</span><span>Critical</span></div>
            </div>
          </div>

          <fieldset className="need-picker">
            <legend>What do you need? <small>Optional</small></legend>
            {categoriesUnavailable ? (
              <p className="need-picker-note">
                The item list is unavailable right now. Your request will still be sent and the response team will decide what to bring.
              </p>
            ) : categories.length === 0 ? (
              <p className="need-picker-note">Loading the item list… If it does not appear, you can still send the request.</p>
            ) : (
              <div className="need-options">
                {categories.map((category) => {
                  const draft = needs[category.category_id];
                  const checked = draft?.checked ?? false;
                  return (
                    <div key={category.category_id} className={`need-option${checked ? ' is-selected' : ''}`}>
                      <label className="need-option-label">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => toggleNeed(category.category_id, event.target.checked)}
                        />
                        <span>{category.name}</span>
                      </label>
                      <label className="need-option-quantity">
                        <span>Amount</span>
                        <input
                          type="number"
                          min={1}
                          max={100000}
                          step={1}
                          value={draft?.quantity ?? form.num_people}
                          disabled={!checked}
                          onChange={(event) => changeNeedQuantity(category.category_id, Number(event.target.value))}
                          aria-label={`How many ${category.name} do you need`}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="need-picker-note">
              Choose the items you need and how many. If you leave this blank, the team will send whatever is available — or a place to stay if you asked for shelter.
            </p>
          </fieldset>

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
