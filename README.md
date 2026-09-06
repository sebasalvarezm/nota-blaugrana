# Nota Blaugrana

Nota Blaugrana is a mobile-first FC Barcelona match-rating app. It is ready to run as a local beta without accounts, and the same code turns on cloud accounts, current-season match imports, personal history, and community averages when Supabase is configured.

## What works

- Responsive 4–3–3 pitch and phone-friendly rating sheet
- Separate half-time and full-time ratings
- Position-aware rating templates for goalkeeper, centre-back, full-back, pivot, midfielder, winger, and striker
- Local autosave for zero-configuration testing
- Supabase email/password accounts and cross-device rating sync
- Row-level security: each user can only read and change their own individual ratings
- Anonymous community aggregates without exposing individual rating sheets
- Cached current-season fixture, score, lineup, substitute, and event imports from public match pages
- Protected manual sync plus a low-frequency Vercel cron
- Editable manual match and lineup fallback
- 1080×1350 PNG poster download and native mobile share sheet
- Installable PWA shell

## Run the local beta

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`. With no `.env.local`, the app deliberately uses local test data and saves ratings in the browser.

## Turn on the complete beta

Follow [SETUP.md](./SETUP.md). It covers the only account-side work that cannot be committed to this project: creating Supabase, safely adding secrets, and deploying to Vercel.

## Verification commands

```powershell
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
```

## Important files

- `components/matchday-app.tsx` — complete rating experience, auth controls, manual fallback, and poster export
- `app/api/football/sync/route.ts` — protected football-data sync endpoint
- `lib/fotmob.ts` — free public-page normalization, caching, lineup roles, substitutions, and events
- `supabase/migrations/202608020001_initial_matchday_five.sql` — schema, indexes, triggers, RLS policies, and community aggregate function
- `.env.example` — required configuration names without secrets
- `vercel.json` — daily cached fixture sync

## Privacy and branding

Individual cloud ratings are private to their owner. Community results are aggregated by the database. The Supabase service-role key is server-only and must never be prefixed with `NEXT_PUBLIC_`.

This is an unofficial supporter project. The current-season importer reads publicly rendered match pages and can require maintenance if their structure changes. The manual fallback remains available. The FC Barcelona crest is loaded remotely for the private interface and is intentionally omitted from generated posters. If the project becomes public, review FC Barcelona trademark rules and the data source's terms first.
