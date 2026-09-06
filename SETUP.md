# Nota Blaugrana — complete beta setup

You do not need to write more code for the first real match test. Complete these account-side steps in order.

## 1. Create the Supabase project

1. Go to `https://database.new` and create a free project.
2. In the Supabase dashboard, open **SQL Editor → New query**.
3. Copy all of `supabase/migrations/202608020001_initial_matchday_five.sql` into the editor and run it once.
4. Confirm that the Table Editor now shows `clubs`, `competitions`, `players`, `matches`, `match_players`, `match_events`, `rating_templates`, and `ratings`.
5. Open **Project Settings → API** and collect:
   - Project URL
   - Publishable key (`sb_publishable_…`)
   - Secret/service-role key

Keep the service-role key private. It bypasses row-level security and belongs only in server environment variables.

## 2. Configure authentication

1. In **Authentication → Providers → Email**, keep email/password enabled.
2. For the fastest private test, email confirmation can be disabled temporarily. Turn it back on before inviting anyone else.
3. In **Authentication → URL Configuration**, use `http://localhost:3000` as the development Site URL.
4. After Vercel gives you a production address, change the Site URL to that address and add both the production address and `http://localhost:3000/**` to Redirect URLs.

## 3. Current-season football data

No paid football account or API key is required. The app reads Barcelona's publicly rendered match pages, caches fixtures in Supabase, and checks the detailed match page near kickoff for confirmed lineups and substitutions.

This is appropriate for a low-traffic personal project, but it is an unofficial integration. If the public page format changes, the manual match editor remains the fallback while the importer is repaired.

## 4. Create the local environment file

Copy `.env.example` to `.env.local` and fill in the values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_PRIVATE_SERVICE_ROLE_KEY
ADMIN_EMAILS=the-email-you-will-use-to-sign-in@example.com
CRON_SECRET=use-a-long-random-value-here
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_TIMEZONE=America/New_York
FOTMOB_TEAM_ID=8634
```

Never commit `.env.local` or paste its secret values into a chat. The project’s `.gitignore` already excludes it.

## 5. Test the complete flow locally

```powershell
npm run dev
```

Then:

1. Open `http://localhost:3000`.
2. Select **Sign in → Create account** using the same address listed in `ADMIN_EMAILS`.
3. The page automatically checks the cached schedule and should switch from test data to the next Barcelona match. **Sync match** remains available to the admin account for an immediate refresh.
4. If the official lineup is not published yet, the match appears with a “Lineup not announced” state. Use **Edit match / lineup** for a local fallback or sync again near kickoff.
5. Rate one player, refresh the page, and confirm the rating returns.
6. Open the site in another browser or phone, sign in, and confirm the same rating appears.
7. Download a match poster.

## 6. Deploy to Vercel

From this project folder:

```powershell
npx vercel@latest
```

Sign in, create a new Vercel project when prompted, and accept the detected Next.js settings. In **Vercel → Project → Settings → Environment Variables**, add every value from `.env.local` to Production, Preview, and Development. Use the production Vercel address for `NEXT_PUBLIC_SITE_URL`.

Deploy the production version:

```powershell
npx vercel@latest --prod
```

Return to Supabase Authentication URL Configuration and add the final `https://…vercel.app/**` address. Redeploy after changing public environment variables.

Vercel reads `vercel.json` and calls `/api/football/sync` once per day. When `CRON_SECRET` is configured, Vercel sends it as a bearer token and the route accepts the scheduled import. Signed-in manual sync is restricted to addresses in `ADMIN_EMAILS`.

## Match-day checklist

- Earlier that day: open the app; it automatically refreshes the cached fixture.
- About 60 minutes before kickoff: open it again; the automatic refresh checks for the starting XI and formation.
- At half-time: complete the HT sheet.
- After substitutions or at full-time: sync again for used substitutes, events, and final score.
- Complete the FT sheet and download/share the poster.

The public page is checked at most every 12 hours normally, every 15 minutes near kickoff, and every two minutes during a live match. All other app loads use cached Supabase rows.

## If something goes wrong

- **“Cloud import is not configured yet”** — a required Supabase server variable is missing in the environment where the app is running.
- **“This account is not allowed to sync”** — the signed-in email does not exactly match an address in `ADMIN_EMAILS`.
- **Test match remains after sync** — run the SQL migration, then inspect the sync response or Vercel function logs.
- **Match imports but lineup is empty** — the provider has not published the lineup yet. Use the manual editor and retry near kickoff.
- **Free match feed format changed** — the public page structure changed. Use the manual fallback until the importer is updated.
- **Ratings save locally but not to cloud** — confirm the user is signed in and the `ratings` RLS policies were created by the migration.
