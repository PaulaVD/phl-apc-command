# PH-L Migration Command

Private migration workspace for Phoenix Legacy. React/Vinext on Sites, D1 persistence per authenticated owner, optimistic revision checks.

## Data

Initial snapshot: 97 members, 45 priority members and six candidate states from the connected Google Sheet on 2026-10-20. `lib/seed.json` is used only for owners without saved data. It is not a live Sheets connection. User edits persist through **Save workspace**. JSON export/import provides full backups; CSV export provides a flat roster.

Priority, migration intent, technical checklist and completed migration are separate states. Tower levels are not interpreted as HQ levels. Four-part CP is not interpreted as official score or tier. The historical 54 places are never treated as current confirmed capacity. Event rules and dates remain configurable and unverified by default.

## Development and checks

- `node node_modules/typescript/bin/tsc --noEmit`
- `node tests/model.mjs`
- `node tests/storage.mjs`
- `npm run db:generate` after schema changes

Use the Sites build/source workflow for publication. D1 migrations are schema-only. The API rejects unauthenticated access, validates payloads, checks origin on writes, isolates owner data, and rejects stale revisions with HTTP 409.

## Scope

Private, single-owner coordination tool, responsive layout. Draft messages are copy-only. Dates entered locally are stored in UTC. No push notifications, automatic in-game integration or automatic Sheets synchronization. Browser QA was unavailable in the authoring environment; build, type checks, domain tests and SQLite API round-trip checks passed.
