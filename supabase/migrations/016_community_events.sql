-- Community events
-- Backs the /community/events page: reviewers ("contributor") and admins can
-- publish events directly, while regular signed-in users submit events that
-- land in a moderation queue on /admin/events.
--
--   community_events — one row per event; `status` doubles as the queue state
--     pending   — submitted by a regular user, awaiting a decision
--     approved  — visible on the public events page
--     rejected  — kept for the submitter's own history, never public

create table public.community_events (
    id uuid primary key default gen_random_uuid(),
    title text not null check (char_length(title) <= 140),
    description text not null default '' check (char_length(description) <= 2000),
    -- Free-form "where" label, e.g. "NA servers", "Official Discord", "EU custom lobby".
    location text check (char_length(location) <= 120),
    -- Optional external link (Discord invite, sign-up form, stream, …).
    url text check (char_length(url) <= 1024),
    starts_at timestamptz not null,
    ends_at timestamptz check (ends_at >= starts_at),
    status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected')),
    submitter_id uuid not null references public.profiles(id) on delete cascade,
    -- Reviewer/admin who approved or rejected the event. Null while pending,
    -- and for reviewer-authored events it records the author (self-approval
    -- is the intended flow for elevated roles, unlike article submissions).
    decided_by uuid references public.profiles(id) on delete set null,
    decided_at timestamptz,
    review_notes text check (char_length(review_notes) <= 2000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index idx_community_events_status_starts_at
    on public.community_events (status, starts_at);

create index idx_community_events_submitter
    on public.community_events (submitter_id, created_at desc);

alter table public.community_events enable row level security;

-- Public can read approved events
create policy "Approved events are publicly readable"
    on public.community_events for select
    using (status = 'approved');

-- Submitters can read their own events in any status
create policy "Submitters see own events"
    on public.community_events for select
    using (auth.uid() = submitter_id);

-- Reviewers and admins can read everything (moderation queue)
create policy "Reviewers see all events"
    on public.community_events for select
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid()
              and role in ('contributor', 'admin')
        )
    );

-- All writes go through the service-role client (server endpoints) — no client-side write policies.

create trigger community_events_touch_updated_at
    before update on public.community_events
    for each row execute function public.touch_updated_at();
