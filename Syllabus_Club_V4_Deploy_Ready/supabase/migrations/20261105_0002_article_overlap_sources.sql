-- Deduplication metadata for Current Affairs imported PDFs.
-- Conservative matches are informational. No existing notes, documents or
-- article progress are modified or removed by this migration.
alter table public.articles
  add column if not exists overlap_sources jsonb not null default '[]'::jsonb;

comment on column public.articles.overlap_sources is
  'Source-linked duplicate coverage detected in imported news PDFs; no source deletion.';
