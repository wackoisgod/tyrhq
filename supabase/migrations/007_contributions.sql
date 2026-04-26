-- Community content contribution system
-- Adds a `role` column to profiles, plus four tables backing the in-site
-- authoring loop:
--   articles            — published, public-facing content (replaces .md files)
--   article_revisions   — append-only history of every published version
--   article_submissions — author drafts + reviewer queue
--   submission_events   — audit trail of all state transitions

----------------------------------------------------------------------
-- 1. Roles
----------------------------------------------------------------------

alter table public.profiles
    add column if not exists role text not null default 'user'
    check (role in ('user', 'contributor', 'admin'));

create index if not exists idx_profiles_role
    on public.profiles (role)
    where role <> 'user';

----------------------------------------------------------------------
-- 2. Articles (live content)
----------------------------------------------------------------------

create table public.articles (
    id uuid primary key default gen_random_uuid(),
    type text not null check (type in ('guide', 'news')),
    slug text not null,
    title text not null check (char_length(title) <= 200),
    summary text check (char_length(summary) <= 500),
    body_markdown text not null,
    body_html text not null,
    author_display text check (char_length(author_display) <= 80),
    author_user_id uuid references public.profiles(id) on delete set null,
    tags text[] not null default '{}',
    vehicle_slugs text[],
    status text not null default 'draft'
        check (status in ('draft', 'published', 'withdrawn')),
    published_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    current_revision_id uuid,
    unique (type, slug)
);

create index idx_articles_type_status_published_at
    on public.articles (type, status, published_at desc);

create index idx_articles_author_user_id
    on public.articles (author_user_id, updated_at desc);

alter table public.articles enable row level security;

-- Public can read published articles
create policy "Published articles are publicly readable"
    on public.articles for select
    using (status = 'published');

-- Authors can read their own articles in any status (so the "edit your contribution" flow works)
create policy "Authors can read own articles"
    on public.articles for select
    using (auth.uid() = author_user_id);

-- Contributors and admins can read everything
create policy "Reviewers can read all articles"
    on public.articles for select
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid()
              and role in ('contributor', 'admin')
        )
    );

-- All writes go through the service-role client (server endpoints) — no client-side write policies.

----------------------------------------------------------------------
-- 3. Article revisions (append-only history)
----------------------------------------------------------------------

create table public.article_revisions (
    id uuid primary key default gen_random_uuid(),
    article_id uuid not null references public.articles(id) on delete cascade,
    source_submission_id uuid,  -- FK added below after submissions table exists
    title text not null,
    summary text,
    body_markdown text not null,
    body_html text not null,
    tags text[] not null default '{}',
    vehicle_slugs text[],
    author_display text,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now()
);

create index idx_article_revisions_article_id_created_at
    on public.article_revisions (article_id, created_at desc);

alter table public.article_revisions enable row level security;

-- Reviewers can see all revision history
create policy "Reviewers can read all revisions"
    on public.article_revisions for select
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid()
              and role in ('contributor', 'admin')
        )
    );

-- Now that the table exists, point articles.current_revision_id at it
alter table public.articles
    add constraint articles_current_revision_fk
    foreign key (current_revision_id)
    references public.article_revisions(id)
    on delete set null;

----------------------------------------------------------------------
-- 4. Article submissions (drafts + reviewer queue)
----------------------------------------------------------------------

create table public.article_submissions (
    id uuid primary key default gen_random_uuid(),
    type text not null check (type in ('guide', 'news')),
    parent_article_id uuid references public.articles(id) on delete set null,
    submitter_id uuid not null references public.profiles(id) on delete cascade,
    title text not null default '' check (char_length(title) <= 200),
    summary text check (char_length(summary) <= 500),
    slug text check (char_length(slug) <= 80),
    body_markdown text not null default '',
    body_html text not null default '',
    tags text[] not null default '{}',
    vehicle_slugs text[],
    status text not null default 'draft'
        check (status in ('draft', 'pending', 'changes_requested', 'approved', 'rejected', 'published')),
    reviewer_id uuid references public.profiles(id) on delete set null,
    review_notes text,
    content_hash text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    submitted_at timestamptz,
    decided_at timestamptz
);

-- Note: "reviewer ≠ submitter unless admin" is enforced in the application
-- layer (see decideSubmission in src/lib/server/submissions.ts), not via a
-- CHECK constraint — the rule needs to inspect profiles.role, which CHECK
-- can't do. Migration 009 also drops a removed CHECK that tried to do this
-- and broke legitimate admin self-approval; this comment exists so a future
-- reader doesn't reintroduce it.

create index idx_article_submissions_submitter
    on public.article_submissions (submitter_id, updated_at desc);

create index idx_article_submissions_status
    on public.article_submissions (status, submitted_at desc);

create index idx_article_submissions_parent
    on public.article_submissions (parent_article_id)
    where parent_article_id is not null;

alter table public.article_submissions enable row level security;

-- Submitters see their own
create policy "Submitters see own submissions"
    on public.article_submissions for select
    using (auth.uid() = submitter_id);

-- Reviewers see anything that's left the draft stage
create policy "Reviewers see non-draft submissions"
    on public.article_submissions for select
    using (
        status <> 'draft'
        and exists (
            select 1 from public.profiles
            where id = auth.uid()
              and role in ('contributor', 'admin')
        )
    );

-- Admins see everything (incl. drafts of others, for moderation)
create policy "Admins see all submissions"
    on public.article_submissions for select
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid()
              and role = 'admin'
        )
    );

-- All writes go through service-role server endpoints.

-- Backfill the submissions reference on revisions now that the table exists
alter table public.article_revisions
    add constraint article_revisions_submission_fk
    foreign key (source_submission_id)
    references public.article_submissions(id)
    on delete set null;

----------------------------------------------------------------------
-- 5. Submission events (audit trail)
----------------------------------------------------------------------

create table public.submission_events (
    id bigint generated always as identity primary key,
    submission_id uuid not null references public.article_submissions(id) on delete cascade,
    actor_id uuid references public.profiles(id) on delete set null,
    kind text not null check (kind in (
        'created', 'edited', 'submitted', 'approved', 'rejected',
        'changes_requested', 'published', 'withdrawn'
    )),
    note text,
    created_at timestamptz not null default now()
);

create index idx_submission_events_submission_id_created_at
    on public.submission_events (submission_id, created_at desc);

alter table public.submission_events enable row level security;

create policy "Submitters see own submission events"
    on public.submission_events for select
    using (
        exists (
            select 1 from public.article_submissions s
            where s.id = submission_id
              and s.submitter_id = auth.uid()
        )
    );

create policy "Reviewers see all submission events"
    on public.submission_events for select
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid()
              and role in ('contributor', 'admin')
        )
    );

----------------------------------------------------------------------
-- 6. Helper: keep articles.updated_at fresh on row updates
----------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger articles_touch_updated_at
    before update on public.articles
    for each row execute function public.touch_updated_at();

create trigger article_submissions_touch_updated_at
    before update on public.article_submissions
    for each row execute function public.touch_updated_at();
