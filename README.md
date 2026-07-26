# PH-L Alliance APC Console

Dark War Survival toolkit for **Phoenix Legacy (PH-L)** APC CP submissions and officer analytics.

Member mode lets players submit Garage APC CP. Alliance roster, rankings, readiness, faction coverage, demo tools and exports unlock after admin authentication.

Default admin access code: `PHL-R5-2026`

## Features

- **Guided** or **Quick submit** entry (paste lines like `PlayerOne i5 820/760/710/655`)
- **Gap to frontline** benchmarks on scan, wizard, roster and rankings
- Officer tools: Discord copy, CSV export, JSON sync, stale / below-frontline filters
- Optional **Supabase** cloud roster for multi-device sync

## Assets

- `assets/phl-logo.png` — Phoenix Legacy logo
- `assets/phl-apc.png` — APC render
- `assets/*.wav` — Sound effects and ambient music

## Local run

```bash
python3 -m http.server 5500
```

Open `http://localhost:5500`.

## Multi-device sync

### Fast path (no backend)

1. Admin → **Sync** → **Export JSON**
2. On another device → **Sync** → **Import JSON**

### Supabase (live shared roster)

1. Create a Supabase project.
2. Run:

```sql
create table if not exists phl_roster (
  alliance_id text primary key,
  members jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now()
);

alter table phl_roster enable row level security;

create policy "phl roster read"
  on phl_roster for select
  using (true);

create policy "phl roster write"
  on phl_roster for insert
  with check (true);

create policy "phl roster update"
  on phl_roster for update
  using (true);
```

3. Put the project URL + anon key in `config.js`.
4. Use **Sync → Push/Pull** (admins).

> Note: open anon policies are fine for a private alliance tool URL, but not for a fully public hardened backend. Tighten RLS when you need stronger auth.

## Security note

Without Supabase, data stays in browser `localStorage` on that device only.
