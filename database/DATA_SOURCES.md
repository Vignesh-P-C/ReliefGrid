# ReliefGrid — Data Sources

Per teacher feedback after Review 1: seed data should be grounded in real datasets
wherever possible, with anything we couldn't source publicly clearly marked as
fabricated. This file documents exactly which rows in `seed.sql` came from where,
so it can be cited directly in the report/viva.

Three honesty tiers are used throughout `seed.sql`, tagged inline as comments:

- **REAL** — the value is taken directly from a cited source, unchanged.
- **DERIVED** — computed from real source numbers (e.g. capacity used to stand in
  for occupancy where a source reports "people sheltered" but not a shelter's
  designed maximum). The math and source are shown at the point of use.
- **FABRICATED** — no public source exists for this value (mainly: individual
  requester identities, exact per-camp street addresses, and operational data
  like login credentials/supply counts that only exist once a system is actually
  running). Marked explicitly, kept to the minimum needed to make the schema work.

---

## 1. `Disaster_Events` — real, from a government source

**Source:** *EnviStats India 2020*, Central Statistics Office (CSO), Ministry of
Statistics & Programme Implementation, Govt. of India — Table 1.9, "India's major
natural disasters since 1990."
Mirror used: https://iasri.icar.gov.in/agridata/23data/chapter1/db2020tb1_9.pdf

All 13 rows (type, region, and — where the table gives it — death toll) come
directly from this table. Two fields are **not** in the source table and are
therefore our own additions, clearly flagged:

- `severity` (1–5) — our own categorisation, roughly bucketed from the reported
  death toll where available (FABRICATED / editorial judgment, not sourced).
- Exact `start_date` for events where the CSO table only gives a year — for six
  events (1991 Uttarkashi EQ, 1996 AP Cyclone, 1999 Odisha Cyclone, 2001 Gujarat
  EQ, 2004 tsunami, 2008 Kosi floods, 2013 Uttarakhand floods, 2013 Phailin, 2014
  Hudhud, 2018 Kerala floods) we used the well-documented public landfall/impact
  date instead of Jan 1. These are individually common knowledge / widely
  reported dates, not from the CSO table itself — noted inline in `seed.sql`.

## 2. `Shelters` — anchored on the 2018 Kerala floods, real headcounts

We picked the 2018 Kerala floods as the one event we model at shelter-level
detail, since it's the best-documented relief operation in India in the last
decade. Real, dated, sourced numbers:

| Row | Real figure | Source |
|---|---|---|
| Kalady Ashram School Relief Camp, Ernakulam | ~2,800 people sheltered at one named institution | Chinmaya Mission field report — https://imedia.chennaimath.org/blogs/post/kerala-flood-relief-2018 |
| Ernakulam District (aggregate) | 9,000 people across 64 camps | ACT Alliance situation report — https://actalliance.org/?p=8994 |
| Idukki District (aggregate) | 3,521 people sheltered | ACT Alliance situation report — https://actalliance.org/?p=8994 |
| Wayanad District (aggregate) | 6,111 people across 87 camps | TheNewsMinute, "1000s in relief camps..." (Aug 2018) — https://www.thenewsminute.com/article/kerala-floods-1000s-relief-camps-schools-colleges-stay-shut-most-districts-106879 |
| Alappuzha District (aggregate) | 1.25 lakh (125,000) people in relief camps, per Finance Minister Thomas Isaac | Eastern Mirror Nagaland (PTI wire) — https://www.easternmirrornagaland.com/rains-abate-flood-waters-recede-as-relief-pours-into-kerala |

Statewide context (not turned into a Shelters row since it isn't tied to one
location, but useful for the report): at peak, **3.4 million people were in
~12,300 relief camps statewide** across 30 days (Aug 1–30 2018), 474 deaths,
20,000+ houses damaged — Kerala Floods 2018 Joint Detailed Needs Assessment
Report (KSMDA) — https://recovery.preventionweb.net/publication/kerala-floods-2018-joint-detailed-needs-assessment-report.
A dated snapshot from Deccan Herald (9 Aug 2018) also gives a same-day statewide
total of 53,501 people / 439 camps, with a per-district camp count (Wayanad 113,
Palakkad 19, Kozhikode 18, Malappuram 13, Thrissur 13, Idukki 10, Kannur 10) —
https://www.deccanherald.com/amp/story/india%2Fkerala-toll-mounts-to-29-over-53000-in-relief-camps-686511.html.
We didn't use this snapshot directly in `seed.sql` because it's from a different
day than the district figures above and mixing snapshots would misrepresent both
as one moment in time — but it's worth citing in the report as corroboration that
the numbers we did use are the right order of magnitude.

**DERIVED simplification, disclosed:** none of these sources report a shelter's
*designed maximum* capacity — only how many people were actually there at the
time. So for every real row, `capacity_occupied` = the reported headcount
(REAL), and `capacity_total` = that headcount plus a small ~5–8% buffer we
added ourselves (FABRICATED). We initially set `capacity_total = capacity_occupied`
(i.e. "full to the reported number"), but actually running `find_nearest_shelters()`
against that data showed every real shelter except one dropping out of results
with zero available space — so the buffer isn't cosmetic, it's what keeps the
check-in/concurrency demos runnable against the real rows at all. This is a
modeling choice, not a source figure.

**FABRICATED:** exact street addresses (we use the real town/district name and an
approximate town-centre lat/long — not the real camp's GPS coordinates, which
aren't public), and the coordinator/contact fields (need a real user in the
system, which doesn't exist for a historical event).

**Additional, synthetic shelters:** a couple of extra shelters for other events
(the original Tamil Nadu/Nilgiris seed rows) are kept as clearly-fabricated rows
so `find_nearest_shelters()` still has more than one event to search across —
these are unchanged from before and were never claimed to be real.

## 3. `Aid_Requests` — real places and real need-types, fabricated individuals

No public dataset gives individual aid-request records for the 2018 Kerala
floods (nor should one — that would be victims' personal data). What we *can*
source: the real places worst-hit and the real categories of need reported
during the response. Request rows are built around real, named localities that
appear repeatedly in contemporaneous reporting — Aluva (Ernakulam), Chengannur
and Pandalam (Alappuzha/Kuttanad belt), Nilambur (Malappuram), and Ranni
(Pathanamthitta) — using approximate town coordinates for those places, and
`request_type` values (shelter, food, water, medical, rescue) that match what
those same reports describe as the actual needs on the ground:

- Aluva flooding / aerial rescue imagery — Deccan Herald, 9 Aug 2018 (as above)
- Boat rescues from interior Chengannur and Pandalam, airdropped essentials in
  cut-off areas — Eastern Mirror Nagaland (as above)
- 300+ families / 800+ people rehabilitated from Nilambur, Malappuram — TheNewsMinute (as above)
- Ranni among first areas to face waterlogging in the district — TheNewsMinute, "revives 2018 trauma..." (as above)

**FABRICATED:** requester names, phone numbers, exact headcount per request, and
urgency scores — no source gives individual request-level data, and using real
people's names/numbers wouldn't be appropriate even if we had them. These are
invented but placed at real, cited locations with realistic need-types.

## 4. `Users`, `Volunteers`, `Volunteer_Tasks`, `Supplies`, `Allocations`, `Supply_Categories`

Entirely **FABRICATED**, unchanged in kind from the original seed data. These
are inherently operational/transactional records — no dataset of "who logged
into a relief-coordination system" or "what was in stock at 3pm" can exist for
an event that predates this system. They exist only to exercise the schema's
concurrency, transaction, and trigger logic (the actual point of the project).

## What we didn't manage to source

- **Individual message-level aid-request text** (the original plan was Figure
  Eight's "Disaster Response Messages" dataset on Kaggle). That dataset requires
  a Kaggle account/API download we don't have access to from this environment,
  so we didn't pull literal message rows from it. Instead we grounded
  `Aid_Requests` in real place names and real reported need-categories from
  contemporaneous news coverage, as described above — a reasonable substitute,
  but worth being upfront that it isn't the exact dataset originally proposed.
  If you can download it yourself (Kaggle login), it would be worth re-doing
  this section with actual message text mapped to `request_type`.
- **Exact GPS coordinates of individual real relief camps** — not published in
  any source we found; we used approximate town/district-centre coordinates
  instead, disclosed above.