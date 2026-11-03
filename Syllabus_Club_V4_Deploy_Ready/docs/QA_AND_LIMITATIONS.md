# V4 testing record — 3 November 2026

## Tests performed successfully

- Python API compilation using `python -m compileall`
- JavaScript syntax verification using `node --check` for `public/app.js` and `public/cloud-bridge.js`
- 12 offline integration/unit tests with `fastapi.testclient` and mocked private storage:
  - Public config never exposes the service key
  - Authentication is required for personal API routes
  - Cron cannot be invoked without the configured secret
  - Study revisions reject concurrent stale writes with 409
  - Invalid state payloads are rejected
  - Private articles are inaccessible to other users
  - Non-PDF uploads, unsupported media types and invalid document IDs are rejected
  - Article queries explicitly include owner filters
  - PIB parser filters unsafe source URLs and parses dates
  - PRS monthly archive uses month-precision dating
  - Supabase signed paths are mapped to validated storage URLs

## Not tested live

- Actual Vercel deployment and framework routing in your Vercel account
- Real Supabase sign-in, confirmation email delivery, database migration and storage access
- Live PIB RSS and PRS retrieval, which requires provider websites to be accessible
- Live OpenAI completion billing and model permissions
- Browser end-to-end smoke tests: the test container's Chromium blocks local/file navigation due to an administrator policy; no browser E2E test has been reported as passed

## Critical prerequisites for deployment

Must supply `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_EMAIL` and `CRON_SECRET`. A production deployment is not considered functional merely because the static UI renders. Run the SQL migration before enabling login.

## Known functional limitations

- Browser-only older PDF bytes cannot be automatically copied between origins. Export the JSON backup and separately re-upload actual documents.
- Source collector brings metadata and RSS text only; it does not claim full 15-year Current Affairs ingestion.
- Source site templates might change; errors are reported rather than filled with invented results.
- Larger-than-4MB uploads require a later direct-upload architecture.
- Reminders only notify while the browser page remains open; no native push/email job yet.
