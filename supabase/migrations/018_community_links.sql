-- Community links
-- Backs the link directory on /community, previously hardcoded in
-- src/lib/content/community.ts. Admins curate groups and links from
-- /admin/community-links; everything here is public content.
--
--   community_link_groups — a heading ("Official Channels") with an optional
--     monospace annotation ("STOKE GAMES"). Rendered in `position` order.
--   community_links — one row per link, owned by a group and ordered within it.
--
-- Rows are seeded below with the links that used to live in the TypeScript
-- module, so the public page looks identical the moment this migration runs.
-- Idempotent: re-running the file converges to the same end state and leaves
-- existing curation untouched.

create table if not exists public.community_link_groups (
    id uuid primary key default gen_random_uuid(),
    heading text not null check (char_length(heading) between 2 and 80),
    -- Small monospace label beside the heading, e.g. "PLAYER-RUN".
    annotation text check (char_length(annotation) <= 40),
    -- Display order, ascending. Ties break on created_at so ordering is total.
    position integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.community_links (
    id uuid primary key default gen_random_uuid(),
    group_id uuid not null references public.community_link_groups(id) on delete cascade,
    label text not null check (char_length(label) between 2 and 120),
    -- https-only; enforced at the application layer where the URL is parsed.
    href text not null check (char_length(href) <= 1024),
    description text check (char_length(description) <= 300),
    -- Short badge rendered next to the label, e.g. "Discord", "Wiki".
    tag text check (char_length(tag) <= 24),
    position integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_community_link_groups_position
    on public.community_link_groups (position, created_at);

create index if not exists idx_community_links_group_position
    on public.community_links (group_id, position, created_at);

alter table public.community_link_groups enable row level security;
alter table public.community_links enable row level security;

-- The directory is public content — everything is readable by anyone.
drop policy if exists "Community link groups are publicly readable" on public.community_link_groups;
create policy "Community link groups are publicly readable"
    on public.community_link_groups for select
    using (true);

drop policy if exists "Community links are publicly readable" on public.community_links;
create policy "Community links are publicly readable"
    on public.community_links for select
    using (true);

-- All writes go through the service-role client (admin endpoints) — no
-- client-side write policies, matching community_events.

drop trigger if exists community_link_groups_touch_updated_at on public.community_link_groups;
create trigger community_link_groups_touch_updated_at
    before update on public.community_link_groups
    for each row execute function public.touch_updated_at();

drop trigger if exists community_links_touch_updated_at on public.community_links;
create trigger community_links_touch_updated_at
    before update on public.community_links
    for each row execute function public.touch_updated_at();

-- Seed: the groups and links that were previously hardcoded in
-- src/lib/content/community.ts (which now serves as the no-Supabase fallback).
-- Only seeds an empty table, so re-running this migration never duplicates
-- rows and never resurrects a group an admin has since deleted.
with seeded_groups as (
    insert into public.community_link_groups (heading, annotation, position)
    select *
    from (values
        ('Official Channels', 'STOKE GAMES', 0),
        ('Community Discords', 'PLAYER-RUN', 1),
        ('Sites & Tools', 'FAN-MADE', 2)
    ) as seed (heading, annotation, position)
    where not exists (select 1 from public.community_link_groups)
    returning id, heading
)
insert into public.community_links (group_id, label, href, description, tag, position)
select g.id, v.label, v.href, v.description, v.tag, v.position
from seeded_groups g
join (
    values
        ('Official Channels', 'Tyr Discord', 'https://discord.com/invite/tyr',
         'The official Tyr Discord — announcements, LFG, and direct dev contact.', 'Discord', 0),
        ('Official Channels', 'Steam Community Hub', 'https://steamcommunity.com/app/2445260',
         'Discussions, screenshots, and community content on Steam.', 'Steam', 1),
        ('Community Discords', 'The Tyr Hotline', 'https://discord.gg/kbJG4xrAM',
         'Community-run hub for Tyr players.', 'Discord', 0)
) as v (heading, label, href, description, tag, position)
  on v.heading = g.heading;
