-- Image support for articles & guides.
--
-- Adds a single nullable `hero_image_url` column to articles, submissions, and
-- revisions for the card / banner thumbnail, plus an `article_uploads` audit
-- table that tracks every uploaded asset for moderation. Inline body images
-- live as `<img src=…>` inside `body_html`; the source URL is validated by the
-- sanitiser at write time against the public bucket prefix, so external hosts
-- are rejected without needing a separate column.
--
-- The actual storage bucket (`article-images`, public read, service-role
-- write) is created via the Supabase dashboard / CLI — schema migrations
-- can't reach the storage API.

----------------------------------------------------------------------
-- 1. Hero image columns
----------------------------------------------------------------------

alter table public.articles
    add column if not exists hero_image_url text;

alter table public.article_submissions
    add column if not exists hero_image_url text;

alter table public.article_revisions
    add column if not exists hero_image_url text;

----------------------------------------------------------------------
-- 2. Upload audit table
----------------------------------------------------------------------

create table if not exists public.article_uploads (
    id uuid primary key default gen_random_uuid(),
    uploaded_by uuid not null references public.profiles(id) on delete cascade,
    submission_id uuid references public.article_submissions(id) on delete set null,
    storage_path text not null unique,
    public_url text not null,
    mime text not null,
    byte_size integer not null,
    width integer,
    height integer,
    created_at timestamptz not null default now()
);

create index if not exists idx_article_uploads_uploader_recent
    on public.article_uploads (uploaded_by, created_at desc);

create index if not exists idx_article_uploads_submission
    on public.article_uploads (submission_id)
    where submission_id is not null;

alter table public.article_uploads enable row level security;

-- Uploaders can see their own upload history (powers per-user moderation pages).
create policy "Uploaders see own uploads"
    on public.article_uploads for select
    using (auth.uid() = uploaded_by);

-- Reviewers and admins see everything.
create policy "Reviewers see all uploads"
    on public.article_uploads for select
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid()
              and role in ('contributor', 'admin')
        )
    );

-- All writes go through the service-role client in the upload endpoint.
