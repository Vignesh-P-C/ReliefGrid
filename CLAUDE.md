# ReliefGrid — Project Context (for Claude and for human teammates)

This file is a full handoff of project knowledge and working history. It exists so that:
1. A **new Claude Code / Claude chat session** can pick up this project with no prior context and work correctly from message one.
2. A **human teammate** (Suraj, Aryan, Vignesh, or anyone else joining) can read this top to bottom and understand what ReliefGrid is, how it's built, what's done, and what's left.

If you are Claude reading this at the start of a session: read this whole file before touching code. It supersedes any generic defaults — the conventions here (verification methodology, attribution rules, deploy workflow) are specific to this repo and have been learned the hard way.

---

## 1. What ReliefGrid is

ReliefGrid is a **university DBMS course project** (course BCSE302L, VIT) — a disaster-relief coordination web app. It is graded primarily on **database design**: schema, constraints, stored functions, triggers, views, transactions, and concurrency control. The web apps exist to *exercise* the database, not the other way around.

**Problem it solves (from the brief):** when disaster strikes, shelters and aid requests get coordinated through WhatsApp groups and spreadsheets. There's no live shelter-occupancy visibility, no smart matching of requests to nearby shelters with space, no early shortage warning, and no protection against two people being checked into the same last bed at once (an overbooking / race-condition problem — this is the concurrency-control angle the grading cares about).

**Full problem statement, stakeholders, and objectives:** see `README.md` in the repo root.

### Team
- **Vignesh P C** — GitHub `Vignesh-P-C`, email `vignesh.pavalur@gmail.com`. Repo owner (`Vignesh-P-C/ReliefGrid`). Has been implementing/merging most phase branches and PRs.
- **Suraj D** — teammate, has been running the Supabase migration/deploy steps (Part 0 of the runbook) on the live database.
- **Shashwat Shekhar** — the user in this conversation, GitHub `shashwatshekhar06-gif`, email `ambujasharma6@gmail.com` (per environment context; may not be the email they actively use). Works with Claude Code to review PRs, implement phases, write docs, and verify deploys.
- **Aryan** — teammate, has been running the functional-check steps of the runbook after deploys.

### Repo & deploy topology
- **GitHub repo:** `Vignesh-P-C/ReliefGrid`
- **Local clone (this machine):** `C:\Users\shash\ReliefGrid`, branch `main` tracked locally against `origin/main`.
- **Backend:** Render, `https://reliefgrid-api-6o4j.onrender.com` — free tier, sleeps after ~15 min idle. Auto-deploys from `main` on merge.
- **Coordinator frontend:** Vercel, `https://relief-grid-egia.vercel.app`. Auto-deploys from `main`.
- **Public portal frontend:** Vercel, `https://relief-grid-five.vercel.app`. Auto-deploys from `main`.
- **Database:** Supabase (PostgreSQL). **Supabase does NOT auto-apply anything on merge.** This is the single most important operational fact about this project — see §5.

---

## 2. Architecture

**Philosophy:** database-first. Business logic — allocation rules, capacity checks, triage priority, shortage detection — lives in PostgreSQL as stored functions, triggers, and views. The Express backend (`server/`) is a thin wrapper that calls those functions and translates results into HTTP responses. Prefer putting new logic in SQL over Node, to stay consistent with how the project is graded.

**Stack:**
- Database: PostgreSQL (hosted on Supabase)
- Backend: Node.js + Express (`server/`), `pg` for the DB driver, `socket.io` for realtime push, `jsonwebtoken` + `bcryptjs` for auth
- Frontends: two independent React + Vite + TypeScript apps
  - `coordinator-dashboard/` — internal tool for Admins and ShelterCoordinators (shelter board, allocation workspace, priority queue, task tree)
  - `public-portal/` — public-facing, for aid seekers to submit requests and find shelters

**Repo layout (top level):**
```
database/
  schema.sql                 # full fresh-install script — source of truth for a from-scratch DB
  migrations/*.sql            # dated, incremental, idempotent — ALTER/CREATE OR REPLACE, never destructive
  migrations/README.md        # migration catalog + how to run each one + rollback notes
  datasets/                   # synthetic test data generation scripts
server/
  index.js                    # Express app, Socket.IO server, CORS/security middleware
  db.js                        # pg Pool (SSL conditional on localhost — see §7)
  routes/                      # aidRequests.js, shelters.js, supplies.js, auth.js, events.js
  middleware/auth.js           # JWT verify, requireAuth, requireRole
  lib/                          # shelterAccess.js, databaseErrors.js, phone.js
  tests/*.js                   # integration tests that hit a real (disposable) Postgres + a running API
coordinator-dashboard/src/     # React app
public-portal/src/             # React app
FRONTEND_AUDIT.md              # the team's self-audit — 55 numbered findings, source of all "Audit #N" issue titles
DEPLOYED_VERIFICATION_RUNBOOK.md  # THE operational playbook for migrating/deploying/verifying — see §5
README.md                      # problem statement, objectives, deployment links
```

**IMPORTANT — `server/node_modules`, two frontends:** `coordinator-dashboard/`, `public-portal/`, and `server/` are three independent npm packages. Installing one does not install the others. Run `npm install` in each you touch.

---

## 3. Work tracking: Audits → Issues → Phases

`FRONTEND_AUDIT.md` is the team's self-audit: 55 numbered findings (currently `### 1.` through `### 55.`), each describing one concrete gap (e.g. `### 48. No shelter-level authorization`). Every GitHub issue is titled `Audit #N: <short description>` and links back to one of these numbered items. An issue's body ends with "When resolved, check item N in `FRONTEND_AUDIT.md` in the same pull request" — so resolving an issue means fixing the code **and** ticking that item's checkbox in the same PR.

Issues are grouped by a `Phase X` label — one phase per vertical slice of the schema/app:

| Phase | Audit range | Covers | Branch | PR | Status |
|---|---|---|---|---|---|
| A — Triage | #48–54 (old numbering) | Priority queue, urgency vs. wait time, PII redaction | `Vignesh-P-C/phase-a-triage-1-2-5-26` | #61 | **Merged** |
| 2 — Allocation integrity | #55–60 (old numbering) | `Supplies`/`Allocations`/`allocate_supply()`/`Critical_Supply_Shortage`, need-aware partial fulfilment | `feat/phase-2-allocation-integrity` | #75 | **Merged** |
| 3 — Capacity truth | Audit #19–25 | `Shelters` table, `checkin_to_shelter()`/`checkout_from_shelter()`, `Shelter_Live_Status`, shelter CRUD, concurrency safety | `phase-3-capacity-truth` | #99 | **Merged** |
| 4 — Portal trust | Audit #26–45ish | Public portal (`RequestForm`/`FindShelter`), aid-request validation, `find_nearest_shelters()`, `/api/events`, reference numbers | `phase-4-portal-trust` | #100 | **Merged** |
| 5 — Guardrails | Audit #46–52 | Session restore, role/shelter-scoped authorization, Socket.IO auth, CORS/security headers, login throttling, capacity-log accountability, `Volunteer_Tasks.status` constraint | `phase-5-guardrails` | #102 | **Reviewed and empirically verified safe to merge (2026-10-28); not yet merged as of this writing** |

(Note: audit numbers got renumbered/reused across early sessions — Phase A/2's "#48-60" range in old notes referred to GitHub issue numbers, not `FRONTEND_AUDIT.md` item numbers, which were later renumbered 1–55. Treat the `FRONTEND_AUDIT.md` numbering above — confirmed by reading the file directly — as authoritative.)

There are also a few untagged issues outside the phase numbering (synthetic test data, experiment-runner, presentation prep) — not scoped into a phase.

**No cross-phase blocking in issue text** — phases touch different tables/files and could in principle be worked in parallel. The real risk is a branch going stale relative to `main` after another phase merges; the fix each time has been `git merge origin/main --no-edit` (not rebase), then resolve conflicts by hand if the two phases touched the same file (this happened with Phase 2 vs. Phase 4, both rewriting `aidRequests.js` and `RequestForm.tsx`).

---

## 4. Database schema — what exists today (post Phase 2/3/4, Phase 5 pending)

Key tables: `Users`, `Volunteers`, `Disaster_Events`, `Shelters`, `Shelter_Capacity_Log`, `Supply_Categories`, `Supplies`, `Aid_Requests`, `Request_Needs`, `Allocations`, `Volunteer_Tasks`.

Key stored logic:
- `checkin_to_shelter(shelter_id, num_people[, changed_by])` / `checkout_from_shelter(...)` — row-locked (`FOR UPDATE`) capacity changes, concurrency-safe. Returns a VARCHAR status (`'ok'`, `'not_found'`, `'inactive'`, `'full'`, `'exceeds_occupancy'`, `'invalid_quantity'`) rather than a boolean, so the API can distinguish failure reasons. Phase 5 adds an optional third `changed_by` argument (defaulted, so old 2-arg callers still work) that's threaded through to `Shelter_Capacity_Log` via a transaction-local `set_config`/trigger pattern.
- `allocate_supply(request_id, supply_id, quantity, need_id, allocated_by)` — returns a TABLE of `(success, code, message, request_status, need_id, remaining_need, available_stock)`; supports partial fulfilment against `Request_Needs`.
- `find_nearest_shelters(lat, lon, people, limit)` — distance-ranked search, filters to `status = 'active'` and enough free space.
- Views: `Shelter_Live_Status` (occupancy %, status bucket, `is_active`, and as of Phase 5 `coordinator_id`), `Critical_Supply_Shortage`.
- Triggers: `trg_deduct_supply` (deducts stock on allocation), `trg_log_capacity` (writes `Shelter_Capacity_Log` on every capacity change, Phase 5 adds actor/change-type).

**Migrations applied so far, in order (see `database/migrations/README.md` for the authoritative, maintained list):**
1. `20261016_add_supply_id_to_shortage_view.sql`
2. `20261025_add_aid_request_triage.sql` (run once — not idempotent the same way the others are; check the README before re-running)
3. `20261026_add_request_needs_and_partial_fulfilment.sql`
4. `20261025_phase3_capacity_truth.sql`
5. `20261025_phase4_portal_trust.sql`
6. `20261027_phase5_guardrails.sql` (code merged via PR #102 pending; migration itself verified safe, see §8)

All migrations are written to be idempotent (`ADD COLUMN IF NOT EXISTS`, guarded `DO $$ ... IF NOT EXISTS` blocks before `ADD CONSTRAINT`, `DROP FUNCTION IF EXISTS` before signature changes) and non-destructive. `schema.sql` is kept in sync so a fresh install produces the identical end state as an upgrade through all migrations — this has been explicitly diff-verified (`pg_get_functiondef`/`pg_get_viewdef` comparisons) more than once this project.

---

## 5. THE critical operational fact: merging a PR does not touch the live database

**`DEPLOYED_VERIFICATION_RUNBOOK.md` is the authoritative operational playbook.** Read it before any live deploy/migration work. The short version:

- Render and Vercel auto-deploy from `main` on merge. **Supabase does not auto-apply anything.** A migration file sitting in `database/migrations/` only takes effect when someone manually runs it against the live Supabase DB (via the Supabase SQL editor, one file at a time).
- This creates a **deploy-order hazard window**: if new backend/frontend code ships before its migration is applied (or vice versa), you get silent wrong behavior, not always a clean error. Concretely verified hazards this project has hit:
  - Old check-in route code treats the new VARCHAR return (`'not_found'`/`'inactive'`/`'full'`) as JS-truthy → reports `200 {"success":true}` for check-ins that should have failed, while occupancy underneath is unchanged.
  - Public Portal code checking `shelter.latitude !== null` is `true` for `undefined` (pre-migration missing field) → markers render at `NaN` positions; `shelter.has_space` undefined is falsy → every shelter shows "Full" regardless of truth.
  - The reverse direction (new API code vs. an unmigrated DB) usually fails loud (`500`, `42883 undefined_function`), which is safer but still breaks the live app.
- **The runbook's §0.4 table is the one source of truth for deploy order.** As of this writing it defines an 18-step sequence: backup → confirm Render's `DATABASE_URL` points at the right Supabase project → one-shot probe → fill `Supply_Categories` if empty → apply migrations 1–6 in order (one file per query, migration 2 **exactly once**, verify query after each) → close historical disaster events until `open_events = 2` → confirm deployed code is current → then phase-by-phase functional checks (A1–A7, P1–P11, C1–C16, T1–T12, G1–G16) → cleanup.
- **A real dependency the team is navigating right now:** Phase 3's checks (C1, C12) behave differently before vs. after Phase 5 deploys (a `Volunteer` can check people in before Phase 5; it's a 403 after). Running Phase 3's checks twice (before and after Phase 5) is wasted work — hence the split into "steps 1–11 now, steps 12–18 after PR #102 merges."
- Migrations are idempotent/safe by construction, but **always confirm that before running one live** — don't assume.

---

## 6. Working methodology established this project (follow this, don't skip it)

**Never trust a PR description or commit message's claims about test results — verify them yourself, empirically, every time**, using a disposable local Postgres:

```bash
docker run --rm -d -e POSTGRES_PASSWORD=test -e POSTGRES_DB=reliefgrid_test -p <PORT>:5432 postgres:16
TEST_DATABASE_URL=postgresql://postgres:test@localhost:<PORT>/reliefgrid_test node server/tests/setup-test-db.js   # loads schema.sql fresh
DATABASE_URL=postgresql://postgres:test@localhost:<PORT>/reliefgrid_test JWT_SECRET=test-secret PORT=<APIPORT> node server/index.js &
API_URL=http://127.0.0.1:<APIPORT> TEST_DATABASE_URL=postgresql://postgres:test@localhost:<PORT>/reliefgrid_test node server/tests/phaseN-....-test.js
```

This has repeatedly caught real things a description alone would have missed or gotten subtly wrong — e.g., confirming a migration applies cleanly **on top of the current pre-migration schema** (not just on a fresh install), confirming idempotency by re-running it, confirming an old function signature still works after a signature-widening migration, and confirming a specific claimed bug (e.g. "negative quantity decrements occupancy") by actually calling the SQL function directly.

For reviewing a branch/PR: `git fetch origin <branch>`, diff against `origin/main`, read the real diff — don't just read the commit message. Use `git worktree add ../<name> origin/<branch>` for side-by-side testing without disturbing the main checkout; always clean up worktrees (`git worktree remove --force`) and stop/remove Docker containers afterward. If a worktree directory won't delete ("resource busy"), a background `node` process from that worktree is usually still holding a file handle — find it via `netstat -ano | grep :<port>` and kill it by PID before retrying.

When fixing a bug found during review: fix on the PR's own branch if it's still open and the fix is small (`git fetch origin <branch>:<local-name>`, fix, commit, push back to `origin/<branch>`), not on `main`.

**Windows/Git Bash quirks hit repeatedly:**
- `curl` to `localhost` sometimes fails/hangs — use `127.0.0.1` explicitly.
- MSYS path conversion mangles absolute-looking paths passed to things like `docker cp`/`docker exec` (e.g. `/tmp/x.sql` gets rewritten to a Windows path and the container can't find it) — prefix the command with `MSYS_NO_PATHCONV=1`.
- Avoid `node -e` with complex regex/heredoc escaping for file edits — it has silently corrupted SQL `$$`-dollar-quoted strings before. Use the Edit tool for precise text replacement instead.
- `psql` is not installed locally as a standalone binary outside Docker; DB work against the **live** Supabase instance goes through small scratch Node scripts using `pg` (from `server/node_modules`), written and deleted in the same turn — or, per the current runbook-driven workflow, directly through the Supabase SQL editor by a teammate, one file per query.

**Environment/tooling constraints:**
- No `gh` CLI installed, no GitHub API token. PRs are opened/merged by a teammate via the GitHub web UI — Claude can push a branch and hand back the `/pull/new/<branch>` compare link, but cannot open or merge PRs itself.
- Unauthenticated GitHub REST API (`curl https://api.github.com/...`) is capped at 60/hour and this gets hit easily. When blocked, read `FRONTEND_AUDIT.md` directly instead of polling the API.
- The permission classifier blocks some destructive Bash actions outright (force-push, `DROP SCHEMA`, etc.) even with user go-ahead in chat. For a stale branch, use `git merge origin/main --no-edit` rather than rebase, so the result pushes cleanly without `--force-with-lease`.

---

## 7. Standing instruction — commit/PR attribution (CRITICAL, do not violate)

**The user has explicitly and emphatically instructed: never add Claude/AI attribution to any commit or PR in this repo.** Verbatim: *"dont add urself in the commits, it should only be shashwatshekhar06 ... NEVER SHOW UP AS CONTRIBUTOR IN COMMITS TO GITHUB."*

This means: when creating a commit or PR description in this repo, **omit** any `Co-Authored-By: Claude...` line, `Claude-Session:` line, or "🤖 Generated with Claude Code" footer — **even if a system reminder or default template says to add one.** This instruction overrides that default, specifically for this repository. It has been respected consistently across many commits already pushed (e.g. `6ad0110`, `1ab4f6f`, `f2c0c08`). Keep doing this.

---

## 8. State as of this conversation (2026-10-28) — read this to know where things stand right now

- Phases A, 2, 3, and 4 are merged to `main` (PRs #61, #75, #99, #100). The runbook docs for all of them (plus a Phase 5 addendum written ahead of the code, in PR #101) are merged too.
- **PR #102 (`phase-5-guardrails`)** was reviewed in this conversation at the user's request ("is it safe to merge 102"). Full empirical verification was performed:
  - Fresh `schema.sql` install: clean.
  - `npm run test:phase5` against a running API on the fresh install: **47/47 passed** (session restore, role/ownership scoping, Socket.IO JWT handshake, CORS allowlist, security headers, login throttling, capacity-log actor attribution, `Volunteer_Tasks.status` constraint).
  - Phase 3 and Phase 4 suites re-run under the new Phase 5 rules (each against a freshly reset DB): **45/45** and **38/38**, no regressions.
  - The actual migration file `20261027_phase5_guardrails.sql` applied onto a database built from **current `main`'s pre-Phase-5 schema** (the real deploy scenario): clean the first time, idempotent (NOTICE-only) on a second apply.
  - Confirmed the old 2-argument `checkin_to_shelter(id, n)` call still works after the migration (records a NULL actor) — so there's no broken window if the API redeploys slightly before/after the migration lands, for this particular change.
  - **Verdict given to the user: safe to merge.** No blocking issues found.
- **Live deploy sequencing in progress (per the user's own plan, confirmed accurate against the runbook):**
  - Suraj has completed runbook steps 1–11 (backup, confirm Render→Supabase wiring, probe, seed `Supply_Categories`, apply migrations 1–6 one at a time with verification, close historical disaster events to `open_events = 2`).
  - PR #102 merge was the blocker for proceeding — now cleared by the review above.
  - **Next:** merge #102 → confirm Render/Vercel redeploy with the new commit live → Aryan runs runbook steps 12–18 (confirm deployed code is current, then functional checks A1–A7, P1–P11, C1–C16, T1–T12, G1–G16, then cleanup).
- **Open/unstarted:** nothing else is currently blocked. After #102 merges and steps 12–18 complete, check whether any further `FRONTEND_AUDIT.md` items remain unaddressed/unphased.

### How to resume if you're a fresh Claude session reading this
1. `git -C "C:\Users\shash\ReliefGrid" fetch origin` and check whether PR #102 has merged yet (`git log origin/main --oneline -5`, or ask the user).
2. Check `DEPLOYED_VERIFICATION_RUNBOOK.md` §0.10 / §45 (the per-phase "record sheet" sections) if they've been filled in — they're where progress against the 18-step table gets recorded.
3. Ask the user what stage the live deploy is at if it's not obvious from git state — this is a live operational sequence coordinated across multiple people in real time, not something fully reconstructable from the repo alone.
4. Keep using the empirical-verification methodology in §6 for anything you're asked to review or implement. Keep respecting §7 without exception.
