# ReliefGrid

![License](https://img.shields.io/badge/license-MIT-green)
![Database](https://img.shields.io/badge/database-PostgreSQL-336791?logo=postgresql&logoColor=white)
![Backend](https://img.shields.io/badge/backend-Node.js%20%2B%20Express-339933?logo=node.js&logoColor=white)
![Frontend](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61DAFB?logo=react&logoColor=black)
![Language](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)
![Realtime](https://img.shields.io/badge/realtime-Socket.io-black?logo=socket.io&logoColor=white)

Database-driven disaster relief coordination platform for managing shelters, aid requests, supplies, volunteers, and real-time resource allocation.

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
4. **Guarantees capacity safety under concurrency** — no over-booking, ever (row locking + isolation)
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

## A Note from the Database Perspective

Everything ReliefGrid promises above is enforced by PostgreSQL, not by application code. The schema is normalized to BCNF across 10 tables, so shelter, coordinator, and event data each live in exactly one place. Nearest-shelter matching is a stored function (`find_nearest_shelters`), the priority queue is a function (`get_priority_queue`), and shortage alerting is a view (`Critical_Supply_Shortage`) — the Express backend only forwards calls to them. Over-booking is impossible not because we wrote careful JavaScript, but because `checkin_to_shelter()` takes a `FOR UPDATE` row lock before checking capacity, and a trigger logs every capacity change for the trend-reporting materialized view. Supply allocation runs as a single ACID transaction, so stock deduction, allocation logging, and request status either all happen or none do. If you read only one file in this repo, make it `database/schema.sql` — it is the actual product.
