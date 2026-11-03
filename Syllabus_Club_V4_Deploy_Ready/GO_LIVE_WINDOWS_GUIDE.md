# Syllabus Club V4 — Go-live checklist (Windows, Vercel + Supabase)

**What you need:** A browser, a personal GitHub account, a Vercel Hobby account, and a Supabase Free account. No paid domain required. The OpenAI API key is optional and billed separately.

**Start with the file `Syllabus_Club_V4_Deploy_Ready.zip`, not the older V4 archive.** This package supports Supabase's newer publishable/secret keys. The app is not yet hosted or verified against your live accounts.

## Phase A — protect your study data
1. If you've used a previous version, open it and choose **Settings → Export JSON**; save the backup. Save original uploaded PDF files separately. Don't uninstall/delete the previous version yet.
2. Download/extract the project ZIP on Windows. Inside the extracted root look for `api`, `public`, `supabase`, `vercel.json`, `.python-version`, and `requirements.txt`. Do not upload the ZIP file to GitHub; upload the extracted contents.

## Phase B — create Supabase backend
3. At https://supabase.com/dashboard choose **New project**. Select your organization, a name such as `syllabus-club`, a strong database password, the Free plan, and a region near you. Keep the database password private.
4. When project creation completes, open **SQL Editor → New query**. On your PC open `supabase/migrations/20261103_0001_cloud.sql` in Notepad/VS Code, copy *all* of the SQL, paste it into Supabase, then click **Run**. Confirm success. In **Table Editor**, look for `study_state`, `articles`, `article_progress`, `study_documents`, `ai_usage`, and `ingestion_runs`; in **Storage**, look for private bucket `study-private`.
5. In **Project Settings → API Keys**, copy the *publishable* (`sb_publishable_...`) and *secret* (`sb_secret_...`) keys. Also copy the project URL from the Connect dialog / settings. **Never put the secret key in GitHub, source files, frontend code or a chat message.**
6. In **Authentication → Sign In / Providers**, keep Email enabled and Confirm Email on. For a personal account, use your Supabase project's organization team email as the dashboard account, so the built-in SMTP can send the confirmation email. If you want a different email, configure custom SMTP first: Supabase's default email sender is restricted to team-member addresses. After you register, disable **Allow new users to sign up**.

## Phase C — upload source to private GitHub repository
7. At https://github.com/new create a repository `syllabus-club`, choose **Private**, and create it. No README initialization is necessary.
8. In the empty repo choose **uploading an existing file** (or **Add file → Upload files**). Drag the *contents* of your extracted project folder. Ensure GitHub shows `api/`, `public/`, `supabase/`, `vercel.json`, `requirements.txt`, `.python-version`. Do not commit `.env` / `.env.local`, credentials, PDFs containing personal information, or browser backups. Click **Commit changes**. If your repo has an extra outer folder, you'll need to select that folder as Vercel's Root Directory.

## Phase D — Vercel deploy
9. At https://vercel.com/new sign in with GitHub and import `syllabus-club`. Under **Configure Project**, leave Root Directory as `./` if the root contains `api`, `public`, and `vercel.json`; otherwise point it at the folder that contains them. Use Framework Preset **Other** (don't choose Next.js), and don't add a build command or output directory unless Vercel specifically requests one.
10. Add these to Vercel **Environment Variables**, with scope **Production**, using your real values:

| Name | What to enter |
|---|---|
| `SUPABASE_URL` | `https://PROJECT-REF.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` (server-only) |
| `OWNER_EMAIL` | Your exact confirmed Supabase Auth email (e.g. `you@example.com`) |
| `CRON_SECRET` | New random high-entropy password, 32+ characters |
| `OPENAI_API_KEY` | Leave unset for first deploy; add later if desired |
| `OPENAI_MODEL` | Optional: `gpt-4.1-mini` |
| `DAILY_AI_LIMIT` | Optional: `10` |

11. Click **Deploy**. When the deployment is ready, open its production URL `https://YOUR-PROJECT.vercel.app`.
12. In **Supabase → Authentication → URL Configuration**, set Site URL to the exact production site URL (no trailing path) and add that same URL to Redirect URLs if needed. Do this **before** registering so email confirmations redirect to the right site.
13. Visit `https://YOUR-PROJECT.vercel.app/api/config`. It should return JSON with `configured:true`, your project URL, and a *public* key. It must not reveal the secret key. If `configured:false`, check Vercel environment variable spellings, scope, and redeploy (changes only affect new deployments).
14. On your live homepage click **☁ Cloud** at the bottom-left → **Create account** using the email from `OWNER_EMAIL`; confirm the email if prompted, then **Sign in**. If confirmation email is blocked with `email_address_not_authorized`, use your Supabase organization team email or configure custom SMTP. Keep confirmation enabled.
15. Mark one topic complete or start and save a short study session, then click **☁ Cloud → Sync now**. In a second device or Incognito window, sign in and verify the same changes show up. If migrating old notes, first **Settings → Import JSON** and then **☁ Cloud → Sync now**; use the Cloud conflict controls with caution, and keep the original backup.
16. Open **Current Affairs** → **Sync PIB + PRS**. The sources might refuse automated requests; check Vercel Functions logs if no items appear. Test a small, text-based PDF under 4 MB and choose the actual issue date. If enabled, test one AI note and verify citations against the official source.
17. In Vercel **Project Settings → Cron Jobs**, confirm `/api/cron/ingest` is registered. Schedule `15 2 * * *` corresponds to a daily morning IST window; Hobby timing isn't minute-precise. Only production deployments run cron jobs. Cron must use the same `CRON_SECRET` variable you entered.

## Common problems
- **404 on `/api/config`:** GitHub/Vercel Root Directory is wrong, or Python function failed to deploy. Check the source tree and Vercel deployment logs.
- **`configured:false`:** Missing or incorrectly named Supabase variables, or you haven't redeployed after adding them.
- **Supabase API 401/Invalid JWT:** Use this patched package; new `sb_secret_` keys must go in `apikey`, *not* `Authorization: Bearer`.
- **Database 404 or API 503:** SQL migration hasn't completed, credentials are incorrect, or the Supabase project is paused.
- **Sign in `403 Forbidden`:** Account email must match `OWNER_EMAIL` exactly. Confirm you signed into the intended account.
- **Email address not authorized:** Supabase built-in SMTP only sends to project team addresses. Configure custom SMTP if using another address.
- **Uploaded PDF rejected:** Limit 4 MB, text-based PDF, maximum 120 pages; scans and encrypted PDFs are unsupported by this MVP.
- **AI notes disabled:** Add `OPENAI_API_KEY` to Vercel and redeploy; API usage may cost money.
- **Cron doesn't appear to run exactly at 07:45 IST:** Free Hobby runs once a day at an approximate time in the configured UTC hour.
- **Progress is different across devices:** Check cloud sign-in, click Sync now, reload the other device; resolve any revision conflict without overwriting a backup.

## Useful official documentation
- https://vercel.com/docs/git
- https://vercel.com/docs/functions/runtimes/python
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/redirect-urls

**Important:** Successful static site deployment is only step one. Cloud data saving, real PDF access, PIB/PRS, sign-in and AI require live checking. Free hosting has usage limits; OpenAI API use isn't free.
