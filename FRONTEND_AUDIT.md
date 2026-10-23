# ReliefGrid — Frontend & Coordination Audit

**Scope:** coordinator dashboard, public portal, the Express routes they call, and the PostgreSQL objects behind them.
**Repository state:** branch `docs/deployment-links-readme`, clean working tree, 16 October 2026 snapshot of `main` history.
**Status:** documentation only — no source files were changed to produce this.

## How this document was produced

Everything below comes from reading the code, not from running the deployment:

- `database/schema.sql`, `database/seed.sql`, the migration in `database/migrations/`, and the CSV fixtures in `database/datasets/postgres/`.
- All routes in `server/routes/`, the auth middleware, and `server/index.js`.
- Every component in `coordinator-dashboard/src/` and `public-portal/src/`.
- Dataset counts were computed from `09_aid_requests.csv` and `10_allocations.csv`.

It was **not** validated against the live Supabase database, the Render API, or either Vercel deployment. Two things depend on the hosted environment and are called out where relevant: whether the `supply_id` migration has been applied, and how many rows the production tables actually hold. `tsc -b` passes in both frontends, so the issues below are design and behaviour problems, not compile errors.

## Severity legend

| Tag | Meaning |
| --- | --- |
| **Blocker** | Produces wrong results, hides critical information, or makes a core disaster-response action impossible. Would be noticed or harmful in a real response. |
| **Broken** | A concrete defect: wrong success, wrong error, stale data, or a crash path. |
| **Gap** | A missing capability the workflow assumes or the README claims. |
| **Minor** | Correct but clumsy; costs time rather than correctness. |

**Layer** shows where a fix has to land: `Frontend` only, `API` (Express route), `DB` (schema, function, view, or migration).

## Summary

| Area | Items | Main theme |
| --- | --- | --- |
| A. Triage & urgency | 7 | Priority is self-declared, never ages, and hides what the request is |
| B. Allocation & inventory | 11 | Resources can only be spent, in one direction, against a blind target |
| C. Shelter capacity | 7 | Occupancy only rises; the board conflates disasters and closed shelters |
| D. Dashboard information | 8 | Contact details, locations, and event names never reach the coordinator |
| E. Public portal | 12 | Location and household size are ignored; results cannot be acted on |
| F. Auth, roles, security | 6 | Any role can consume stock; refresh logs you out; sockets leak PII |
| G. Schema & integrity | 4 | Free-text states, nullable core fields, no audit or timestamps |
| **Total** | **55** | 14 are frontend-only; 41 need an API or SQL change |

---

# A. Triage and urgency

The system's claim is that requests are prioritised "by urgency and waiting time". Neither half holds up: urgency is unverified and waiting time is decorative.

### 1. Urgency is self-declared with no verification

**Severity:** Blocker · **Area:** Public portal / triage · **Layer:** DB + Frontend

- **What happens** — The only urgency signal is a 1–5 slider the requester sets themselves (`RequestForm.tsx:109`), pre-set to 3. Nothing else in the system captures the person's condition, so the coordinator receives a number with no evidence behind it.
- **Why it matters** — In a disaster, every requester has an incentive to pick 5, and the top of the slider is literally labelled "Critical". Once most requests are 5, the queue degenerates into arrival order among the 5s. Nothing in the pipeline validates, cross-checks, or downgrades a claim. The synthetic fixture makes this worse by spreading 2,000 requests almost evenly across 1–5 (507 / 502 / 501 / 499 / 499) — a distribution that cannot occur in reality and that hides the collapse during demos.
- **Where** — `public-portal/src/components/RequestForm.tsx`, `get_priority_queue()` in `database/schema.sql:135`, `coordinator-dashboard/src/components/PriorityQueue.tsx`.

### 2. Waiting time never promotes anyone

**Severity:** Blocker · **Area:** Triage · **Layer:** DB

- **What happens** — `get_priority_queue()` sorts with `ORDER BY urgency_level DESC, created_at ASC` (`schema.sql:143`). `waiting_minutes` is computed and returned, but it is only a tie-breaker inside an urgency level.
- **Why it matters** — A level-2 request submitted on day one sits behind every level-5 submitted on day five, indefinitely. This is structural starvation, not a slow path. Any real triage queue either ages requests upward or assigns deadlines; this one has no concept of either, so the README's "urgency and waiting time" objective is half-implemented.
- **Where** — `database/schema.sql:135–147`, displayed without ageing in `PriorityQueue.tsx`.

### 3. Urgency is immutable

**Severity:** Blocker · **Area:** Triage · **Layer:** API + DB

- **What happens** — There is no `UPDATE` route for `Aid_Requests`; the only writer to `status` is `allocate_supply()` (`schema.sql:198`). `urgency_level` can never change after insert, and no triage decision is timestamped.
- **Why it matters** — Conditions change during a response: a stable family can deteriorate, and a duplicate or false request should be downgraded. The system cannot represent either. The queue is an append-only snapshot with no revision history, so a coordinator's judgement cannot be recorded anywhere.
- **Where** — `server/routes/aidRequests.js` (only `GET /queue` and `POST /`), `Aid_Requests` in the schema.

### 4. Nothing measures vulnerability

**Severity:** Gap · **Area:** Triage · **Layer:** DB

- **What happens** — `Aid_Requests` captures `num_people` and `urgency_level` and nothing else about the people involved: no infants, elderly, disabled, pregnant, or medical-dependency fields.
- **Why it matters** — Forty healthy adults and a household with a dialysis patient produce identical rows. Priority cannot reflect actual risk, so coordinators compensate by phoning people and guessing — exactly the ad-hoc process the project is supposed to replace.
- **Where** — `Aid_Requests` definition, `database/schema.sql:86–98`.

### 5. The queue hides the request type

**Severity:** Blocker · **Area:** Triage · **Layer:** DB

- **What happens** — `get_priority_queue()` returns `request_id`, `requester_name`, `urgency_level`, `num_people`, and `waiting_minutes`. The `request_type` column exists in the table but is neither returned nor displayed.
- **Why it matters** — A rescue request, a food request, and a medical request render as identical rows. A coordinator cannot tell which team the job belongs to, and the portal's "Type of help" field is collected and then discarded by every downstream screen.
- **Where** — `schema.sql:135–147`; the table in `PriorityQueue.tsx`.

### 6. No pagination, filter, or sort

**Severity:** Gap · **Area:** Triage · **Layer:** API + Frontend

- **What happens** — The route runs `SELECT * FROM get_priority_queue()` with no `LIMIT`, and the component maps every row into the table.
- **Why it matters** — The fixtures contain 2,008 pending requests. Rendering them all is slow and unusable, and there is no way to filter by urgency, type, area, or age. The first thing a coordinator needs in a real queue is "show me only the critical ones near me".
- **Where** — `server/routes/aidRequests.js:8`, `PriorityQueue.tsx`.

### 7. Waiting time is displayed as raw minutes

**Severity:** Minor · **Area:** Triage · **Layer:** Frontend

- **What happens** — `waiting_minutes` is rendered directly, e.g. `1440 min`; the payload carries no `created_at`, so the UI cannot show an arrival time or a human-readable age.
- **Why it matters** — Mental arithmetic under pressure, no visual cue that a request is breaching an SLA, and no sense of ordering. The two apps also use different vocabularies for the same scale (portal: "Can wait / Soon / Needs attention / Urgent / Critical"; dashboard: "Low / Routine / Elevated / High / Critical"), which is confusing across a shared reference number.
- **Where** — `PriorityQueue.tsx`, `RequestForm.tsx`.

---

# B. Allocation and inventory

This is the area you flagged, and it is the weakest workflow in the product: the UI can only spend stock that is already critical, against a target it knows nothing about, and it never shows what it did.

### 8. Allocation is only possible for stock already in crisis

**Severity:** Blocker · **Area:** Allocation · **Layer:** DB + API + Frontend

- **What happens** — The allocation form is rendered inside each row of `Critical_Supply_Shortage`, so an item is allocatable only while `quantity <= reorder_threshold`. There is no inventory endpoint either: `server/routes/supplies.js` exposes only `/shortages` and `/allocate`.
- **Why it matters** — A shelter with 400 blankets and a request for blankets cannot allocate any, because the item is not flagged as short. Coordinators cannot see what a shelter actually holds, so every allocation is a guess made from a shortage list.
- **Where** — `ShortageBanner.tsx` renders `<ShortageAllocation>` per shortage row; `Critical_Supply_Shortage` view at `schema.sql:254`; `server/routes/supplies.js`.

### 9. The request picker is context-free and defaults to the riskiest choice

**Severity:** Blocker · **Area:** Allocation · **Layer:** Frontend

- **What happens** — Every pending request in the system appears in a single `<select>` labelled with id, name, headcount, and urgency (`ShortageBanner.tsx:76`). The initial value is `requests[0]` (`ShortageBanner.tsx:16`) — the highest-urgency request in the entire queue.
- **Why it matters** — There is no request type, no location, and no distance, so nothing prevents allocating water from a Kerala shelter to a rescue request in another district. Because the default is the top request, an inattentive click spends stock and closes a stranger's request. The same global list is repeated identically for every shortage row.
- **Where** — `coordinator-dashboard/src/components/ShortageBanner.tsx:16, 76`.

### 10. One allocation closes the request regardless of quantity

**Severity:** Blocker · **Area:** Allocation · **Layer:** DB

- **What happens** — `allocate_supply()` inserts the allocation and then runs `UPDATE Aid_Requests SET status = 'fulfilled'` unconditionally (`schema.sql:198`), with no comparison between `quantity_allocated` and `num_people` or need.
- **Why it matters** — Allocating 1 bottle closes a request for a family of 40: the row disappears from the queue, the unmet need becomes invisible, and nobody is told the request was only partly served. There is no `partially_fulfilled` state, no remaining-quantity column, and no "needed" amount to compare against. The same function also marks pure shelter requests fulfilled, which is semantically wrong.
- **Where** — `database/schema.sql:183–203`.

### 11. Allocations are write-only

**Severity:** Blocker · **Area:** Allocation · **Layer:** API + Frontend

- **What happens** — Rows are inserted into `Allocations` but never read: there is no `GET` route and no screen. The running-total window-function query that would visualise them exists only as a comment in `schema.sql`.
- **Why it matters** — A coordinator cannot answer "what have we already sent this family?" or "where did the blankets go?", so the same need can be served twice or not at all. It also removes the audit trail the DBMS presentation would want to show.
- **Where** — `Allocations` table (`schema.sql:100`), `server/routes/supplies.js`.

### 12. The screen where you triage has no actions

**Severity:** Blocker · **Area:** Allocation · **Layer:** Frontend

- **What happens** — `PriorityQueue` rows are read-only. Allocation lives in `ShortageBanner`, which `App.tsx` renders above every tab, including Volunteer tasks, rather than beside the request it concerns.
- **Why it matters** — The decision happens in one place and the action in another, so the coordinator has to remember an id, scroll up, and re-find the request in a global dropdown. The banner is also easy to trigger accidentally while working on an unrelated tab.
- **Where** — `App.tsx:109` (banner placement), `PriorityQueue.tsx`.

### 13. Allocation depends on an unapplied migration

**Severity:** Broken · **Area:** Allocation · **Layer:** DB + Frontend

- **What happens** — The dashboard expects `supply_id` on each shortage row and posts it at `ShortageBanner.tsx:43`. That column only exists after `database/migrations/20261016_add_supply_id_to_shortage_view.sql` is run against the deployed database; `schema.sql` has it, but a live DB created before the change does not.
- **Why it matters** — If the migration was skipped, `supply_id` is `undefined`, the POST sends nothing, and the API answers "request_id, supply_id, and quantity must be positive whole numbers". The user sees a validation complaint for a schema problem, and the real fix is invisible from the UI. The TypeScript type asserting `supply_id: number` also suppresses any warning.
- **Where** — `database/migrations/20261016_add_supply_id_to_shortage_view.sql`, `ShortageBanner.tsx:43`, `types.ts`.

### 14. Request type and supply category are never connected

**Severity:** Gap · **Area:** Allocation · **Layer:** DB

- **What happens** — `Supply_Categories` and `Supplies.category_id` exist, but no query joins them; `Critical_Supply_Shortage` exposes only `item_name`. Allocation ignores `request_type` entirely.
- **Why it matters** — A medical request cannot be matched to medicine, and stock cannot be grouped or filtered by category, so the coordinator has to infer from free-text item names. The category dimension is dead schema in a project graded on schema design.
- **Where** — `Supply_Categories` (`schema.sql:54`), `Supplies` (`schema.sql:59`), `Critical_Supply_Shortage` (`schema.sql:254`).

### 15. Quantities are unitless in the interface

**Severity:** Minor · **Area:** Allocation · **Layer:** DB + Frontend

- **What happens** — `Supplies.unit` exists but the shortage view does not select it and the banner never shows it: the UI reads "4 left · reorder at 10".
- **Why it matters** — Four what — bottles, kits, kilograms? The person packing the allocation has to guess, and the default `reorder_threshold` of 10 is meaningless when it is compared against different units.
- **Where** — `schema.sql:254`, `ShortageBanner.tsx`.

### 16. Stock can only ever decrease

**Severity:** Gap · **Area:** Allocation · **Layer:** API + DB + Frontend

- **What happens** — Allocation is the only write path for supplies. There is no donation, restock, transfer-between-shelters, threshold-editing, or new-supply route in `server/routes/supplies.js`, and no shelter write route either.
- **Why it matters** — In a real response, supplies arrive continuously; here the shortage banner is a countdown to zero with no way to record the truck that just arrived. The reorder threshold also cannot be tuned per item, so every supply uses the same default of 10.
- **Where** — `server/routes/supplies.js`, `server/routes/shelters.js`.

### 17. A destructive action has no confirmation and no idempotency

**Severity:** Broken · **Area:** Allocation · **Layer:** Frontend + DB

- **What happens** — Pressing "Allocate supply" immediately deducts stock and closes the request. There is no confirmation step, no undo, and `Allocations` has no unique constraint or idempotency key.
- **Why it matters** — A mis-click spends resources that cannot be un-spent, and a retried request after a timeout can insert a second allocation row and deduct twice. The UI's disabled-while-saving flag is the only protection, and it does not survive a network retry.
- **Where** — `ShortageBanner.tsx` form, `Allocations` table.

### 18. Allocation does not check the request's state

**Severity:** Broken · **Area:** Allocation · **Layer:** DB

- **What happens** — `allocate_supply()` locks the supply, checks stock, inserts the allocation, and marks the request fulfilled. It never checks that the request exists or is still `pending`; a missing request surfaces as an FK error and a generic 500.
- **Why it matters** — An already-fulfilled or cancelled request can be fulfilled again, and two concurrent allocations can both succeed against the same request. The error message ("Allocation failed") also hides whether the cause was missing stock, a bad request id, or a database error.
- **Where** — `database/schema.sql:183–203`, `server/routes/supplies.js:19–41`.

---

# C. Shelter capacity

Occupancy is the number the public portal and the board both depend on, and it is only ever allowed to increase.

### 19. There is no checkout

**Severity:** Blocker · **Area:** Capacity · **Layer:** DB + API + Frontend

- **What happens** — `capacity_occupied` can only be incremented, via `checkin_to_shelter()`. There is no decrement function, no route, and no UI for people leaving. `Shelter_Capacity_Log` therefore records a monotonically rising staircase.
- **Why it matters** — After the first day every shelter reads "full", the public search stops returning anything, and the capacity data becomes fiction. The materialized trend view becomes meaningless too. In a real response, discharge and transfer are as routine as check-in.
- **Where** — `database/schema.sql` (no such function), `server/routes/shelters.js`.

### 20. Check-in ignores whether the shelter is open

**Severity:** Broken · **Area:** Capacity · **Layer:** DB

- **What happens** — `checkin_to_shelter()` selects the shelter by id with `FOR UPDATE` and compares capacity, but never checks `status = 'active'` (`schema.sql:163–180`).
- **Why it matters** — People can be checked into a closed or merged shelter. The public search filters to active shelters while the coordinator board does not, so the two apps disagree about which shelters exist — one hides them, the other happily fills them.
- **Where** — `database/schema.sql:163–180`.

### 21. An unknown shelter ID returns success

**Severity:** Broken · **Area:** Capacity · **Layer:** DB

- **What happens** — If the row does not exist, `SELECT ... INTO` leaves `occ` and `tot` NULL; `IF occ + p_num_people > tot` evaluates to NULL and is skipped, the `UPDATE` affects zero rows, and the function returns `TRUE`. The route then answers `200 {success: true}` and broadcasts `shelter-updated`.
- **Why it matters** — A typo, a stale ID, or a deleted shelter produces a silent false success. The board then refetches, shows no change, and the coordinator believes the family was checked in. Nothing in the response distinguishes this from a real check-in.
- **Where** — `database/schema.sql:163–180`, `server/routes/shelters.js:70`.

### 22. The board mixes disasters and counts closed shelters as available

**Severity:** Blocker · **Area:** Capacity · **Layer:** DB

- **What happens** — `Shelter_Live_Status` selects from `Shelters` with no filter on `status` or `event_id` (`schema.sql:246–252`), and `ShelterBoard` sums every returned row into "People sheltered" and "Open spaces".
- **Why it matters** — The seed contains 2018 Kerala camps plus fabricated 2026 events in different districts, so the summary cards add unrelated disasters into one number, and inactive shelters contribute free capacity that does not exist. The ranking view has the same flaw. Every top-line figure on the dashboard is therefore wrong as soon as more than one event is loaded.
- **Where** — `database/schema.sql:246–252`, `ShelterBoard.tsx` aggregation.

### 23. Check-in is disconnected from aid requests

**Severity:** Gap · **Area:** Capacity · **Layer:** DB + API + Frontend

- **What happens** — The route takes only a shelter id and a headcount; there is no `request_id` parameter. `Shelter_Capacity_Log` records the new occupancy with no reference to who was admitted or why.
- **Why it matters** — A "shelter" request stays `pending` forever even after the family is physically inside, so the queue accumulates resolved work. And there is no way to answer "which request did this check-in serve?" during review — the two halves of the workflow never meet.
- **Where** — `server/routes/shelters.js:57`, `Shelter_Capacity_Log`.

### 24. The check-in form does not respect remaining space

**Severity:** Minor · **Area:** Capacity · **Layer:** Frontend

- **What happens** — The number input has `min="1"` but no maximum (`ShelterBoard.tsx:47–48`), so any positive integer can be submitted and the refusal arrives as a 409.
- **Why it matters** — During a rush, an avoidable round trip and a red error instead of a disabled button or a capped field. The form also does not display the remaining spaces next to the input, so the coordinator has to read the row and do the subtraction.
- **Where** — `coordinator-dashboard/src/components/ShelterBoard.tsx:47`.

### 25. Shelters cannot be created, closed, resized, or edited

**Severity:** Gap · **Area:** Capacity · **Layer:** API + DB + Frontend

- **What happens** — `server/routes/shelters.js` exposes only read routes plus check-in and the task tree. `status`, `capacity_total`, `contact_number`, `address`, and `coordinator_id` are never written after seed time.
- **Why it matters** — A new camp cannot be opened during an event, a full one cannot be marked closed, and a wrong capacity cannot be corrected. The `status` column exists but is unreachable, so issue 20 can never be worked around from the UI either.
- **Where** — `server/routes/shelters.js`.

---

# D. Information the dashboard withholds

The dashboard shows state but withholds nearly everything needed to act on it.

### 26. Coordinators cannot contact requesters

**Severity:** Blocker · **Area:** Dashboard · **Layer:** DB

- **What happens** — `Aid_Requests.phone` is collected and stored, but `get_priority_queue()` does not return it, and there is no request-detail view to fetch it separately.
- **Why it matters** — The portal explicitly promises "a coordinator may contact you using the number provided", yet the coordinator has no number. The single most actionable field in the system is invisible to the only role that can act on it — callbacks, verification, and coordination all become impossible.
- **Where** — `get_priority_queue()` (`schema.sql:135`), `PriorityQueue.tsx`.

### 27. Requests carry no location in the dashboard

**Severity:** Gap · **Area:** Dashboard · **Layer:** DB + API + Frontend

- **What happens** — `Aid_Requests` stores latitude and longitude, but the queue function omits them and no dashboard screen calls `find_nearest_shelters()`, even though that function exists and is used by the public portal.
- **Why it matters** — The coordinator decides where to send a family without knowing where the family is or which shelter is closest with space. The project's headline "smart matching" feature is only available to the public side, never to the person who has to execute the match.
- **Where** — `find_nearest_shelters()` and `get_priority_queue()` in `schema.sql:114, 135`.

### 28. Disaster events are rendered as bare numbers

**Severity:** Gap · **Area:** Dashboard · **Layer:** API + Frontend

- **What happens** — The ranked query returns `event_id` without joining `Disaster_Events`, and the UI prints "Event 07" (`RankedOccupancy.tsx`).
- **Why it matters** — The event name ("Kerala Floods 2018") is the natural label for a coordinator; an internal surrogate key is not. It also makes the event dimension look like an afterthought in a presentation that is supposed to showcase exactly that dimension.
- **Where** — `server/routes/shelters.js` ranked query, `RankedOccupancy.tsx`.

### 29. Rankings go stale and can read "Event null"

**Severity:** Broken · **Area:** Dashboard · **Layer:** Frontend

- **What happens** — `RankedOccupancy` fetches once on mount with no socket subscription, so check-ins never update it. Shelters with a null `event_id` group under the string key `"null"`, which the header formats as "Event null".
- **Why it matters** — Two screens showing different occupancy for the same shelter at the same moment destroys trust in both. The null group looks like a defect because it is one: `event_id` is nullable and nothing assigns a default event.
- **Where** — `coordinator-dashboard/src/components/RankedOccupancy.tsx`.

### 30. The task tree is half-blind and stale

**Severity:** Broken · **Area:** Dashboard · **Layer:** API + Frontend

- **What happens** — The recursive CTE returns `task_id`, `parent_task_id`, `description`, `status`, and `depth` — dropping `volunteer_id` and `priority`, which the table stores. The component also fetches the shelter list once on mount.
- **Why it matters** — A task tree that does not say who owns a task or how urgent it is cannot be used to run a shift. New tasks never appear without a full page reload, and no task can be marked complete, so the screen is a static report rather than a work tool.
- **Where** — `server/routes/shelters.js:83`, `VolunteerTaskTree.tsx:59`.

### 31. The "Operational view" indicator is decorative

**Severity:** Blocker · **Area:** Dashboard · **Layer:** Frontend

- **What happens** — The live dot is static markup (`App.tsx:101`). It is not tied to the socket's connection state, there is no last-updated timestamp, and nothing refetches when a dropped socket reconnects.
- **Why it matters** — After a laptop sleeps, a tunnel blips, or Render restarts, the table stays at its last values while the UI still claims to be live. A coordinator reading a stale bed count is worse off than one who knows the data is old. This is the most dangerous class of UI bug in a coordination tool: silent staleness presented as truth.
- **Where** — `coordinator-dashboard/src/App.tsx:101`, `lib/socket.ts`.

### 32. Every failure renders as the same message

**Severity:** Gap · **Area:** Dashboard · **Layer:** Frontend

- **What happens** — Each component's `catch` sets a "temporarily unavailable" message. A 401 from an expired token, a 403 from a missing role, and a 500 from a server bug are indistinguishable, and nothing redirects to login when the token dies.
- **Why it matters** — Users retry a permission problem forever, and an expired 12-hour session never prompts a re-login. It also makes support impossible: the message says "try again" when trying again cannot work.
- **Where** — all dashboard components; `lib/api.ts` interceptor.

### 33. No shelter detail view

**Severity:** Gap · **Area:** Dashboard · **Layer:** API + Frontend

- **What happens** — The board shows name, id, occupancy, and status only. Address, contact number, event, assigned coordinator, and stock all exist in the database and are unreachable from any screen.
- **Why it matters** — "Where is it, who is in charge, and what do they have?" are the three questions a coordinator asks before routing anyone. None can be answered without opening the SQL editor.
- **Where** — `Shelter_Live_Status` (`schema.sql:246`), `ShelterBoard.tsx`.

---

# E. Public portal

The portal is the only interface most affected people will ever see, and it currently works only for someone standing outdoors with GPS, a working phone, and a small household.

### 34. Field lengths do not match the database

**Severity:** Broken · **Area:** Portal · **Layer:** API + DB

- **What happens** — The form allows a 30-character phone and a 120-character name (`RequestForm.tsx:84, 89`), against `VARCHAR(15)` phone and `VARCHAR(100)` name columns. The API validates only presence, so PostgreSQL rejects the row with error 22001 and the route returns a generic 500.
- **Why it matters** — A perfectly normal formatted number such as "+91 98765 43210" is already 15 characters; one extra space or hyphen overflows. The user is told "Your request could not be sent right now" and has no way to know that shortening the number would fix it. `Users.phone` has the same 15-character limit, so registration has the same trap.
- **Where** — `public-portal/src/components/RequestForm.tsx:84,89`, `Aid_Requests` and `Users` in `schema.sql`, `server/routes/aidRequests.js`.

### 35. API validation is presence-only

**Severity:** Broken · **Area:** Portal · **Layer:** API

- **What happens** — The route checks `!num_people` and `!urgency_level` (`aidRequests.js:22`). A negative headcount or an urgency of 9 passes that check, then violates the database `CHECK` and surfaces as a 500.
- **Why it matters** — Invalid input is a client error and should return 400 with a useful message. Returning 500 means monitoring shows a server fault for user input, and a buggy or malicious client has no way to learn what was wrong.
- **Where** — `server/routes/aidRequests.js:22–23`.

### 36. The success screen gives no reference number

**Severity:** Gap · **Area:** Portal · **Layer:** Frontend

- **What happens** — After submission the portal shows a confirmation card with no request id, even though the POST already returns the created row. There is no lookup page or status check.
- **Why it matters** — The person is told to keep their phone nearby but has nothing to quote when calling, and no way to confirm the request was recorded. Every follow-up call starts with "I sent something yesterday" instead of a number.
- **Where** — `public-portal/src/components/RequestForm.tsx`.

### 37. No deduplication or abuse protection

**Severity:** Gap · **Area:** Portal · **Layer:** API

- **What happens** — The endpoint is unauthenticated, has no rate limit, no per-phone throttle, and no duplicate detection. The same phone number can submit unlimited requests.
- **Why it matters** — One malicious or panicking user can flood the priority queue and bury real cases. Slow mobile networks also produce accidental double submissions, because nothing detects an identical request within a short window.
- **Where** — `server/routes/aidRequests.js`, `server/index.js`.

### 38. Location is all-or-nothing

**Severity:** Blocker · **Area:** Portal · **Layer:** Frontend

- **What happens** — Shelter search requires the browser geolocation API. If permission is denied, the device has no GPS, or the request times out, the user gets an error and the search is over — there is no manual town or area entry and no "list all active shelters" fallback.
- **Why it matters** — This is the primary public use case, and it fails for people indoors, on old devices, on desktop, or after an accidental "Block". The portal becomes unusable for exactly the population it targets, with no workaround offered.
- **Where** — `public-portal/src/components/FindShelter.tsx:38` and the early-return branch when geolocation is unavailable.

### 39. Household size is ignored in shelter search

**Severity:** Blocker · **Area:** Portal · **Layer:** Frontend

- **What happens** — The search call hard-codes `people: 1` (`FindShelter.tsx:38`), and the request form's `num_people` is not reused. `find_nearest_shelters()` accepts a required-space parameter, but the portal always passes 1.
- **Why it matters** — A family of eight is offered a shelter with two free places, and arrives to be turned away. The single most important input for a safe match — how many people need space — is thrown away at the call site.
- **Where** — `FindShelter.tsx:38`, `find_nearest_shelters()` in `schema.sql:114`.

### 40. The map only shows the user

**Severity:** Blocker · **Area:** Portal · **Layer:** DB + Frontend

- **What happens** — `find_nearest_shelters()` returns no coordinates, so `FindShelter` can only place a marker for the user's own position (`FindShelter.tsx:108–110`). No shelter pins, no route, no zoom to fit.
- **Why it matters** — The map is decorative in the one feature whose name is "nearest shelter". A user cannot see which direction to walk or how the options relate to each other, which is the entire reason to render a map in a disaster interface.
- **Where** — `find_nearest_shelters()` return columns, `FindShelter.tsx:108–110`.

### 41. Results cannot be acted on

**Severity:** Gap · **Area:** Portal · **Layer:** DB + Frontend

- **What happens** — Each result shows name, distance, and free spaces only. `find_nearest_shelters()` doesn't return address, contact number, or coordinates, and shelters at full capacity are filtered out of the result set entirely.
- **Why it matters** — The user cannot get directions or call ahead to confirm space, and when nothing is available they get an empty state instead of "these two are full, this one has space but is 12 km away". Zero results is a dead end rather than a decision.
- **Where** — `find_nearest_shelters()` (`schema.sql:114`), `FindShelter.tsx` result list.

### 42. Requests have no disaster context

**Severity:** Gap · **Area:** Portal · **Layer:** Frontend

- **What happens** — The form never sends `event_id`, and the API defaults it to null (`aidRequests.js:31`). There is no event selector or active-event concept anywhere in the portal.
- **Why it matters** — Every public request is orphaned from the disaster it belongs to, so requests cannot be grouped, filtered, or matched by event — even though `Shelters.event_id` and the ranking screen are built around that dimension. It also explains issue 29's "Event null" group.
- **Where** — `RequestForm.tsx`, `server/routes/aidRequests.js:31`.

### 43. No offline or low-bandwidth behaviour

**Severity:** Gap · **Area:** Portal · **Layer:** Frontend

- **What happens** — There is no service worker, no response caching, no retry queue, and no draft persistence. The form and the map both require live connectivity, and map tiles come from an external CDN.
- **Why it matters** — Disasters are precisely when networks are congested or down. A submission that fails mid-send loses everything typed, with only a generic error — and the person may not have the battery or the patience to fill it in again.
- **Where** — `public-portal/src` (no caching layer), `FindShelter.tsx` map tiles.

### 44. Name and phone are both required

**Severity:** Gap · **Area:** Portal · **Layer:** Frontend

- **What happens** — Both fields are marked `required` and the API rejects requests without them. There is no "on behalf of someone else" path and no way to submit without a phone.
- **Why it matters** — People without a working phone — common when chargers and handsets are lost — cannot ask for help at all, and a volunteer cannot report a stranded neighbour without inventing a number. The portal's own copy says the phone "helps" coordinators follow up, which implies optional, but the form enforces it.
- **Where** — `RequestForm.tsx:84,89`, `server/routes/aidRequests.js:22`.

### 45. English-only interface

**Severity:** Minor · **Area:** Portal · **Layer:** Frontend

- **What happens** — All labels and messages are hard-coded English; there is no i18n layer and no language toggle.
- **Why it matters** — The deployment target is Kerala, and the people most in need of the portal may read Malayalam only. An interface they cannot read is only marginally better than no portal.
- **Where** — all portal components.

---

# F. Authentication, roles, and security

None of these require a redesign; they are small omissions with outsized consequences.

### 46. Refreshing the page logs the coordinator out

**Severity:** Broken · **Area:** Security / session · **Layer:** API + Frontend

- **What happens** — `App` starts with `user = null` (`App.tsx:38`) and never rehydrates from the JWT in `localStorage`. There is no `/api/auth/me` endpoint, so the only way to rebuild the user object is to log in again.
- **Why it matters** — A reload mid-response, a browser crash, or opening the app in a second tab all force a full re-login, even though the token is still valid for 12 hours. In a live response, that delay is real cost.
- **Where** — `coordinator-dashboard/src/App.tsx:38`, `server/routes/auth.js`.

### 47. Any logged-in role can consume resources

**Severity:** Blocker · **Area:** Security · **Layer:** API

- **What happens** — `/shelters/:id/checkin` and `/supplies/allocate` use `requireAuth` only; only the task tree uses `requireRole('Admin', 'ShelterCoordinator')`.
- **Why it matters** — A `Volunteer` account can fill beds and spend stock. The schema defines three roles and the backend has a `requireRole` helper, but the two most consequential write paths ignore both, so the RBAC model exists only on paper.
- **Where** — `server/routes/shelters.js:57`, `server/routes/supplies.js:19`, `middleware/auth.js`.

### 48. No shelter-level authorization

**Severity:** Blocker · **Area:** Security · **Layer:** DB + API

- **What happens** — `Shelters.coordinator_id` is populated in the seed but never read by any route or query. There is no scoping by shelter, district, or event.
- **Why it matters** — Any coordinator can act on any shelter's capacity and stock, including shelters in another district. In a multi-team deployment that is both an operational hazard (one coordinator silently emptying another's stock) and an accountability problem.
- **Where** — `Shelters.coordinator_id` (`schema.sql:32`), all write routes.

### 49. Socket.IO is unauthenticated and broadcasts personal data

**Severity:** Blocker · **Area:** Security · **Layer:** API

- **What happens** — The Socket.IO server is created with no handshake auth (`server/index.js`), and `new-aid-request` emits the entire inserted row, including requester name and phone, to every connected client.
- **Why it matters** — Anyone who can reach the API can subscribe and harvest names and phone numbers of disaster victims, with no token and no room scoping. The event also leaks data to any origin, since the socket CORS origin is `*`.
- **Where** — `server/index.js`, `server/routes/aidRequests.js` emit.

### 50. Open CORS, no security headers, no login throttling

**Severity:** Gap · **Area:** Security · **Layer:** API

- **What happens** — `app.use(cors())` allows any origin; Socket.IO allows `origin: '*'`; there is no helmet, no rate limit, and no account lockout on `/api/auth/login`.
- **Why it matters** — Any website can call the API with a stolen token, and phone numbers can be enumerated while passwords are brute-forced without limit. For a public-facing relief app holding victim contact data, that is not a minor omission.
- **Where** — `server/index.js`, `server/routes/auth.js`.

### 51. No accountability trail

**Severity:** Gap · **Area:** Security / audit · **Layer:** DB

- **What happens** — `Allocations` has no `allocated_by`, and `Shelter_Capacity_Log` has no actor or reason. The JWT carries `user_id`, but no route ever writes it to an operational record.
- **Why it matters** — "Who spent this stock?" and "who admitted these people?" are unanswerable, so misuse cannot be detected and a legitimate decision cannot be defended. It also undercuts the DBMS story, where triggers and audit tables are supposed to be a strength.
- **Where** — `Allocations`, `Shelter_Capacity_Log` in `schema.sql`; write routes.

---

# G. Schema and integrity

### 52. Status columns are free text

**Severity:** Broken · **Area:** Integrity · **Layer:** DB

- **What happens** — `Aid_Requests.status`, `Shelters.status`, and `Volunteer_Tasks.status` are `VARCHAR` with defaults and no `CHECK` constraint.
- **Why it matters** — Any client, seed script, or manual SQL statement can write `'Pending'`, `'done'`, or `'fulfiled'`. The UI compares against exact literals (`'pending'`, `'active'`, `'full'`) and CSS class names are derived from the string, so a typo creates a state that is invisible in every screen while still occupying a row.
- **Where** — `database/schema.sql:32–45, 76–98`.

### 53. Core fields are nullable even though the app assumes them

**Severity:** Gap · **Area:** Integrity · **Layer:** DB

- **What happens** — `urgency_level` and `num_people` are nullable; the API requires them, but the database does not. `lat`/`lon` are nullable too, which is intended.
- **Why it matters** — A direct insert, a seed row, or a future endpoint can create a request with no urgency, which then sorts last silently (`ORDER BY urgency DESC` puts NULLs last) and never appears urgent. The application contract and the schema disagree, so the schema is not actually enforcing the model.
- **Where** — `Aid_Requests` (`schema.sql:86–98`).

### 54. No `updated_at` anywhere

**Severity:** Gap · **Area:** Integrity · **Layer:** DB

- **What happens** — Only `created_at` exists on requests, and there are no modification timestamps on shelters, supplies, or tasks.
- **Why it matters** — You cannot tell an edited request from a stale one, detect a request that has sat untouched for days, or implement optimistic concurrency. For a tool whose value is freshness, the schema cannot answer "when did this last change?"
- **Where** — all tables in `schema.sql`.

### 55. The trend view is unreachable

**Severity:** Gap · **Area:** Integrity / reporting · **Layer:** API + Frontend

- **What happens** — `mv_daily_capacity_trend` is created and never refreshed by the application; there is no route and no screen for it. Refreshing it is a manual SQL step.
- **Why it matters** — The README's "logs capacity changes into daily trend views for planning" objective exists only inside PostgreSQL. Because check-in only increases occupancy and nothing refreshes the view, any values it holds are both stale and monotonic — the opposite of a usable trend.
- **Where** — `database/schema.sql` materialized view section, `server/routes/shelters.js`.

---

# Cross-cutting notes

## Fix layering

- **14 issues are frontend-only:** 7, 9, 12, 24, 29, 31, 32, 36, 38, 39, 42, 43, 44, 45.
- **41 issues need at least a thin API route or a SQL change.** That is consistent with the project's design philosophy — the database owns the logic and Express stays a wrapper — but it means the "frontend fixes" you have in mind will need small accompanying changes in `server/routes/*` and, in a few cases, `database/schema.sql` plus a migration.

## Suggested order

1. **Truth in the queue** — items 1, 2, 5, 26, 27, 28, 31. Without contact details and request type the queue cannot be acted on, and without ageing it cannot be trusted.
2. **Allocation integrity** — items 8, 9, 10, 11, 13, 18. This is the workflow you flagged; it needs an inventory read path and a partial-fulfilment state to be correct rather than merely nicer.
3. **Capacity truth** — items 19, 20, 21, 22, 25. Checkout and the status/event filters change every headline number on the dashboard, so do them before polishing the board.
4. **Portal trust** — items 34, 35, 36, 38, 39, 40, 41, 42. Length limits and validation are quick; household size and manual location are the ones that change whether the portal is usable at all.
5. **Guardrails** — items 46, 47, 48, 49, 50, 51, plus the status constraints in 52. Small diffs, disproportionate risk reduction.
6. **Longer term** — items 3, 4, 6, 14, 15, 16, 17, 23, 30, 33, 43, 44, 45, 53, 54, 55.

## What this document does not establish

- Whether the `supply_id` migration has been applied to the hosted Supabase database. Item 13 is conditional on it.
- Production row counts, index usage, or query performance. The 2,008-pending figure comes from the bundled fixtures, not the live database.
- That any of these defects currently affect real users; the deployments were last observed in a ready state, but no request was made while writing this.
- Any measured benchmark or concurrency result. The existing test scripts mutate rows and were not run.
