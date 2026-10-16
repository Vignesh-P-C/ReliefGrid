# ReliefGrid

![License](https://img.shields.io/badge/license-MIT-green)
![Database](https://img.shields.io/badge/database-PostgreSQL-336791?logo=postgresql&logoColor=white)
![Backend](https://img.shields.io/badge/backend-Node.js%20%2B%20Express-339933?logo=node.js&logoColor=white)
![Frontend](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61DAFB?logo=react&logoColor=black)
![Language](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)
![Realtime](https://img.shields.io/badge/realtime-Socket.io-black?logo=socket.io&logoColor=white)

ReliefGrid is a university DBMS course project: a PostgreSQL-centered disaster-relief coordination system for modeling shelters, aid requests, supplies, volunteers, and resource allocation. The web applications exercise the database-backed system; database design, constraints, transactions, and concurrency are the main academic focus.

## Deployment links

| Service | Open |
| --- | --- |
| Vercel projects (public portal and coordinator dashboard) | [Vercel dashboard](https://vercel.com/dashboard) |
| Render service (backend API) | [Render dashboard](https://dashboard.render.com) |
| Supabase project (PostgreSQL database) | [Supabase dashboard](https://supabase.com/dashboard) |

These links open the hosting dashboards. The deployed app/API URLs and Supabase project-specific link are not recorded in this repository, so confirm the current deployments in those dashboards before sharing them. Do not add database connection strings, API keys, or other credentials here.

---

## Problem Statement — ReliefGrid
### Disaster Relief Resource & Shelter Coordination System

### 1. Background

When disaster strikes, the bottleneck is rarely the availability of aid — it's the **coordination** of it. Dozens of shelters spring up within hours, but information about who is where and what is running out is managed through WhatsApp groups and spreadsheets — tools never designed for a live, time-critical allocation problem.

### 2. The Problem

**No live shelter visibility.** Occupancy lives in notebooks and phones. Full shelters stay listed as "open," so families waste critical time traveling to shelters that cannot take them.

**No smart matching.** Nobody can manually compare every request against every shelter's space and distance. Requests are served in the order they're noticed, not by urgency, while nearby shelters with space go unused.

**No early shortage warning.** Shelters discover they've run out of water or medicine only when someone asks. Nothing flags stock falling toward zero *before* it becomes a crisis.

**No over-booking protection.** When two volunteers simultaneously check two families into the last two beds, both believe they succeeded — and the shelter is over capacity. Concurrent check-ins need a guarantee spreadsheets can't offer.

**Root cause:** response data is not centralized, transactional, or queryable in real time.

### 3. Stakeholders

- **Aid seeker** — find the nearest shelter with confirmed free space, now
- **Coordinator** — record check-ins/allocations safely; see live occupancy and stock
- **Admin** — one prioritized request queue, shortage alerts, occupancy trends
- **Volunteer** — clear task assignments instead of ad-hoc chat instructions

### 4. Objectives

ReliefGrid is a centralized, database-driven platform that:

1. Shows **live shelter status** (occupancy %, available/near-full/full) synced in real time across dashboards
2. **Matches aid seekers to shelters** by distance and actual free space
3. **Prioritizes requests** by urgency and waiting time
4. **Protects shelter capacity under concurrent check-ins** — row locking serializes the check-and-update, with a database constraint as a final guard
5. Makes **supply allocation atomic** — stock deduction, logging, and status update succeed or fail together
6. **Flags shortages proactively** when stock hits reorder thresholds
7. **Logs capacity changes** into daily trend views for planning

### 5. Scope

Single district, web-only. Shelters, aid requests, supplies, allocations, volunteers, and live updates. Out of scope (future work): payments, SMS gateways, multi-region support, spatial indexing.

### 6. Why Database-Centric

The problem is **shared mutable state under concurrency** — what relational databases are built for:

- **Strong consistency over availability:** an unreachable system beats a silently over-booked one; capacity must never go negative (CAP reasoning rules out eventually-consistent stores)
- **Logic lives in the database:** matching, prioritization, alerting, auditing, and reporting are stored functions, triggers, and views — guarantees hold no matter which client calls
- **Transactions are the product:** concurrency-safe check-in and atomic allocation *are* the core feature

In short: **ReliefGrid replaces spreadsheet-and-chat coordination with a transactional, strongly consistent, real-time database system.**

---

## DBMS Course Project

The project demonstrates relational design and PostgreSQL mechanisms, including constraints, stored functions, triggers, views, transactions, row locking, isolation levels, and deadlock handling. `database/schema.sql` is the source for the implemented database behavior; `database/normalization.md` walks through the normalization examples. A full BCNF claim should be supported table by table with functional dependencies and candidate keys.

The safe check-in function (`checkin_to_shelter`) locks the shelter row before checking and changing occupancy. The `Shelters` capacity constraint also rejects occupancy above total capacity. `allocate_supply` locks stock and checks availability; inserting an allocation fires `trg_deduct_supply`, which deducts the quantity. The function then updates request status. These steps run atomically, so a failure rolls back the allocation and deduction together. Capacity changes are logged for the daily trend materialized view, which must be refreshed to include later changes.

The seed combines source-grounded historical context with derived and fabricated operational records. Provenance and limitations are documented in `database/DATA_SOURCES.md`. These records are a small demo dataset, not a live operational dataset. The CSV package provides reproducible schema-ready simulation fixtures; an automated bulk loader, measured query-plan/performance results, and benchmark plots remain future work. Do not present expected outcomes as measurements.

## Test Data

The [database test-data package](database/datasets/README.md) provides one schema-column-matched CSV for each PostgreSQL table, a cited Kerala district snapshot, provenance metadata, and deterministic synthetic records for simulation scenarios. Load it only into a disposable local database; its fixture accounts cannot authenticate, and the rows are not current relief information.

