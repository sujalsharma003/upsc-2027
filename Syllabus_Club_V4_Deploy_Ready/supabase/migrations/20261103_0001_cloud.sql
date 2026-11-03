-- Syllabus Club V4: run once in the Supabase SQL Editor.
-- Private user data is only ever accessed by its owner. Server functions use
-- the service role after independently verifying the Supabase access token.
create extension if not exists pgcrypto;

create table if not exists public.study_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.articles (
  id uuid primary key,
  owner_id uuid references auth.users(id) on delete cascade, -- null = public-source article
  source text not null check (source in ('PIB','PRS','PDF')),
  url text,
  title text not null,
  published_date date not null,
  date_precision text not null default 'day' check (date_precision in ('day','month')),
  added_at timestamptz not null default now(),
  source_text text not null default '',
  excerpt text not null default '',
  tags jsonb not null default '[]'::jsonb,
  relevance smallint not null default 15 check (relevance between 0 and 100),
  analysis jsonb,
  analyzed_at timestamptz,
  file_name text,
  file_path text,
  content_hash text not null unique
);
create index if not exists articles_date_idx on public.articles (published_date desc);
create index if not exists articles_owner_idx on public.articles (owner_id, published_date desc);

create table if not exists public.article_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  article_id uuid not null references public.articles(id) on delete cascade,
  read_status text not null default 'unread' check (read_status in ('unread','read','saved')),
  revision_stage integer not null default 0 check (revision_stage between 0 and 10),
  revision_due date,
  updated_at timestamptz not null default now(),
  primary key (user_id, article_id)
);
create index if not exists progress_revision_idx on public.article_progress (user_id, revision_due);

create table if not exists public.study_documents (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  file_name text not null,
  file_path text not null,
  media_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  uploaded_at timestamptz not null default now(),
  primary key (user_id,id)
);

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  article_id uuid references public.articles(id) on delete set null
);
create index if not exists ai_usage_daily_idx on public.ai_usage(user_id, created_at desc);

create table if not exists public.ingestion_runs (
  id text primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items_added integer not null default 0,
  errors jsonb not null default '[]'::jsonb
);

-- Atomic revision-aware save to avoid one device silently overwriting another.
create or replace function public.save_study_state(
  p_user_id uuid, p_payload jsonb, p_expected_revision bigint
) returns bigint language plpgsql security definer set search_path=public as $$
declare v_revision bigint;
begin
  if p_expected_revision < 0 then raise exception 'Invalid expected revision'; end if;
  if p_expected_revision = 0 then
    insert into public.study_state(user_id,payload,revision,updated_at)
    values (p_user_id,p_payload,1,now()) on conflict do nothing
    returning revision into v_revision;
  else
    update public.study_state set payload=p_payload, revision=revision+1,updated_at=now()
    where user_id=p_user_id and revision=p_expected_revision
    returning revision into v_revision;
  end if;
  return v_revision; -- null means a concurrent edit; app must resolve conflict.
end $$;
revoke all on function public.save_study_state(uuid,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.save_study_state(uuid,jsonb,bigint) to service_role;

-- Create private Storage bucket, cap individual uploads at 4 MB for Vercel API.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('study-private','study-private',false,4194304,array['application/pdf','image/png','image/jpeg','text/plain'])
on conflict (id) do update set public=false, file_size_limit=4194304,
allowed_mime_types=array['application/pdf','image/png','image/jpeg','text/plain'];

-- Default deny: our server-side API handles writes after authenticating the user.
alter table public.study_state enable row level security;
alter table public.articles enable row level security;
alter table public.article_progress enable row level security;
alter table public.study_documents enable row level security;
alter table public.ingestion_runs enable row level security;
alter table public.ai_usage enable row level security;

revoke all on public.study_state, public.articles, public.article_progress,
 public.study_documents, public.ingestion_runs, public.ai_usage from anon,authenticated;
grant select on public.study_state, public.articles, public.article_progress,
 public.study_documents to authenticated;

create policy "own study state" on public.study_state for select to authenticated
 using ((select auth.uid())=user_id);
create policy "public and own source articles" on public.articles for select to authenticated
 using (owner_id is null or (select auth.uid())=owner_id);
create policy "own article progress" on public.article_progress for select to authenticated
 using ((select auth.uid())=user_id);
create policy "own study documents" on public.study_documents for select to authenticated
 using ((select auth.uid())=user_id);

-- No client grants/policies on storage.objects. Server-side signed URLs are
-- issued only after ownership checks. Never add public bucket access.
