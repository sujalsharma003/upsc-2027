# Syllabus Club ✳ — V4 Cloud Edition

**Vercel Hobby + Supabase Free.** The Gen-Z UPSC dashboard is carried forward, including your **187-topic syllabus**, 179-day plan (3 Nov 2026–30 Apr 2027), notes, revision queue, study timer/session history, mock/PYQ tracker, reminders and weekly reading briefs. A cloud account is now available to save most metadata across devices. PIB/PRS ingestion and private PDF uploads use a stateless FastAPI backend.

## START HERE — deploy in 8 steps

1. **Back up your previous study data.** In your existing Syllabus Club V2/V3, open Settings → Export JSON. Save the file somewhere safe. Original PDFs stored in the V3 `local-data/uploads` folder must be backed up separately. Do not delete V3 yet.
2. **Create a Supabase Free project** at https://supabase.com/dashboard. Keep its project URL, **publishable key** and **secret key** (from Project Settings → API Keys). Never share the service-role key. Free-plan projects can pause after inactivity.
3. In **Supabase → SQL Editor**, paste and execute `supabase/migrations/20261103_0001_cloud.sql` **once**. This creates private user tables, RLS policies, atomic sync function, and the private `study-private` storage bucket. Confirm the SQL succeeds.
4. **Set up email/password sign-in** under Supabase → Authentication → Providers. For the built-in SMTP, confirmations are restricted to team-authorized email addresses; for another address, configure custom SMTP. Keep email confirmations enabled. After creating your account, consider disabling public registrations because this is a one-person project.
5. Upload this extracted **project folder to your own GitHub repository** (without `.env` or secrets), then at https://vercel.com/new choose **Import Git Repository**. Leave the Vercel root directory at the folder containing `api/`, `public/`, `requirements.txt`, and `vercel.json`. Vercel detects the Python FastAPI entrypoint `api/index.py`.
6. In **Vercel → Project → Settings → Environment Variables**, add these variables for Production (and Preview if you explicitly want preview environments). Values are described below. **Never paste secret keys in a Git commit or chat.**
7. **Redeploy**, open your `*.vercel.app` site, click **☁ Cloud** at the bottom-left, and create/sign in to the account matching `OWNER_EMAIL`. If you enabled email confirmations, verify your email first.
8. Import your old V3/V2 **Settings → Import JSON** backup if needed. Click ☁ Cloud → **Sync now**. Visit Current Affairs to manually **Sync PIB + PRS** (or let the daily scheduled job run). Confirm that you can log in from a second device and see the same recorded progress.

### Required environment variables

| Name | Use |
|---|---|
| `SUPABASE_URL` | `https://your-project.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Current public `sb_publishable_...` key, used for Supabase Auth in the browser |
| `SUPABASE_SECRET_KEY` | Current private `sb_secret_...` key; **server only** |
| `OWNER_EMAIL` | Your own sign-in email; all other users are denied by the backend |
| `CRON_SECRET` | A random secret, at least 16 characters; recommend 32+ |
| `OPENAI_API_KEY` | *Optional* — AI study notes are disabled without it |
| `OPENAI_MODEL` | *Optional*, e.g. `gpt-4.1-mini`, choose an available JSON-capable model |
| `DAILY_AI_LIMIT` | *Optional* — default **10**, limits API-cost exposure |

The public configuration endpoint deliberately returns the configured **publishable key**, which is a **public** key. Never put the **service role** or OpenAI key in frontend files or in variables prefixed `NEXT_PUBLIC_`/`VITE_`.

### Verify after deployment

- `https://YOUR-SITE.vercel.app/api/config` should report `"configured":true` and **must not contain secrets**.
- Visit the site root. Dashboard should appear, retaining the lavender/lime **Syllabus Club** design.
- Sign in through the ☁ button, change a topic/complete a task, choose **Sync now**; then sign in on another device. Your updated progress and timer session history should be visible.
- Visit **Current Affairs → Sync PIB + PRS**; note that sources may block automated fetching or change their HTML/RSS structure. No source articles are fabricated.
- Upload a **text-based PDF under 4 MB**, choosing its real issue date. Scanned or encrypted documents are not supported by the automatic text parser.
- If AI is configured, choose a source with enough original text and click **Generate AI notes**. Verify every answer against the linked official source.
- Check **Vercel → Project → Settings → Cron Jobs**; the daily job points to `/api/cron/ingest`. If it fails, check Function logs rather than publishing credentials.

### Daily ingestion

- Cron schedule `15 2 * * *` uses **UTC**, so the job targets **07:45 IST** daily. Vercel Hobby cron timing is approximate, not exact.
- The job checks official PIB RSS and the PRS monthly-review archive. It de-duplicates using a stable fingerprint. It does **not** scrape all linked news documents or guarantee that every press release is available in the feed.
- The on-demand button is rate-limited to one full refresh every ~2 hours; scheduled jobs check no more than once per hour. This reduces accidental repeated requests.
- The software will remain functional when official servers refuse traffic, although automatic updates will show an error and require investigation.

### Data model / cross-device synchronization

- **Cloud snapshot:** Syllabus statuses, tasks, hand-written notes, reminders, mock scores, reading list, study timer/session history, and revision metadata are saved to `public.study_state`.
- **Private documents:** New uploads in V4 go to a private Supabase Storage bucket, never a public `public/` folder. Access is via short-lived signed URLs after ownership checks. File size limit is 4 MB per upload due to Vercel Function payload limits.
- **Current Affairs:** PIB/PRS records are shared official source metadata; your uploaded PDFs and article-progress states are user-specific.
- **Merge protection:** Every cloud save checks a revision number in PostgreSQL. If another device changed the same account, saving stops rather than silently replacing remote work; use **☁ Cloud → Download browser backup → Use cloud version** or **Replace cloud with local version** deliberately.
- **Local fallback:** If you are logged out or temporarily offline, most planner tools still work in the current browser. Browser-local files from older versions are not automatically transferred to Supabase: re-upload originals after authenticating.
- **No real-time push sync:** Saves are debounced; reloading the second device obtains the latest snapshot. Simultaneous edits on two devices may require manual conflict resolution. This is intentional to prevent data loss.

### Important limitations

- **This archive is deployable source code**, not a deployment we have already run in your Supabase/Vercel accounts. Live hosting, cloud DB behavior, real authorization emails, real PIB/PRS fetches and actual OpenAI requests still require verification after your environment is configured.
- **Reminder notifications are still browser-based**. Push/email reminders when the app is closed are **not implemented**. Timer tracking is preserved, but browser tab closure may pause an active timer.
- **AI notes are optional** and can have usage charges; free hosting does not mean free AI calls. The AI engine uses a conservative source-grounded prompt, but outputs need factual review.
- **Existing V3 SQLite article archives** cannot be imported automatically in this build. Re-upload your PDFs and use official feed refresh for recent news; keep your V3 archive backup.
- **Vercel Functions have a ~4.5 MB request/response payload limit.** This MVP caps PDF/doc uploads at 4 MB. For magazines larger than this, a future direct-to-Supabase signed-upload system is required.
- **Supabase Free** currently includes a limited database and approximately 1 GB of file storage; pay attention to quotas, as monthly Current Affairs magazines could consume it quickly. Export backups periodically.
- Google Chrome/Edge **will not send push notifications after the page closes**; adding reliable reminders requires scheduled server jobs plus an email/push channel.

### Local development

Use `vercel dev` from the project root after linking your Vercel project and pulling your environment variables. This serves the `public/` directory and the FastAPI routes together. Alternatively, to run only the API locally, `uvicorn api.index:app --reload` works, but the static site then needs its own server and correctly configured API routing. Open `public/index.html` alone only for an offline UI preview, **not** for cloud features.

Run offline API tests:

```bash
python -m pip install -r requirements.txt pytest
python -m pytest tests -q
```

## Security and cost

- Your `OWNER_EMAIL` must match the Supabase Auth user. Legacy `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` remain accepted as fallbacks but are deprecated by Supabase. Unauthorized accounts receive HTTP 403 from the app backend.
- Each incoming access token is verified against Supabase Auth, and every private article/document operation performs an owner check.
- Postgres RLS protects data from direct browser access; the service-role key remains server-side.
- Cron routes use `CRON_SECRET`; generating AI notes also requires the owner to be signed in and is capped by `DAILY_AI_LIMIT`.
- This project is intended for personal, non-commercial use on the Vercel Hobby plan. Keep your credentials private.

## Project structure

```text
api/index.py                 FastAPI API, auth checks, private PDFs, AI, cron
api/core.py                  Supabase REST helpers and PIB/PRS source parsers
public/index.html            Syllabus Club application shell
public/app.js                Planner, notes, timer, revision, mock tests
public/cloud-bridge.js       Sign-in form, cross-device sync, conflict resolution
public/data.js               187-topic syllabus and 179-day plan
public/styles*.css           Responsive Gen-Z interface
public/weekly-briefs/        26 pre-generated study resource briefs
supabase/migrations/*.sql    Database, private storage, RLS policies, sync RPC
vercel.json                  Daily 07:45 IST cron
.env.example                 Environment-variable template, no live secrets
tests/test_v4.py             Offline security and API smoke tests
```

## Official setup references

- https://vercel.com/docs/functions/runtimes/python
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/uploads/file-limits
