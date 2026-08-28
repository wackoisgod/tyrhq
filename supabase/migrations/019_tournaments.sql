-- Tournament and team MVP.
--
-- The storage bucket for logos (`tournament-images`, public read) must be
-- created outside schema migrations, matching the existing article image flow.

alter table public.profiles
    add column if not exists is_tournament_organizer boolean not null default false;

create index if not exists idx_profiles_tournament_organizers
    on public.profiles (is_tournament_organizer)
    where is_tournament_organizer;

create table public.teams (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique check (char_length(slug) <= 80),
    name text not null check (char_length(name) between 3 and 40),
    description text check (char_length(description) <= 500),
    logo_url text,
    captain_id uuid not null references public.profiles(id) on delete restrict,
    is_disabled boolean not null default false,
    disabled_reason text check (char_length(disabled_reason) <= 500),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index idx_teams_name_ci
    on public.teams (lower(name));

create index idx_teams_captain
    on public.teams (captain_id, created_at desc);

alter table public.teams enable row level security;

create policy "Enabled teams are publicly readable"
    on public.teams for select
    using (not is_disabled);

create policy "Captains can read own disabled teams"
    on public.teams for select
    using (auth.uid() = captain_id);

create policy "Reviewers can read all teams"
    on public.teams for select
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid()
              and role in ('contributor', 'admin')
        )
    );

create table public.team_members (
    team_id uuid not null references public.teams(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    role text not null default 'member' check (role in ('captain', 'member')),
    joined_at timestamptz not null default now(),
    primary key (team_id, user_id)
);

create unique index idx_team_members_one_captain
    on public.team_members (team_id)
    where role = 'captain';

create index idx_team_members_user
    on public.team_members (user_id, joined_at desc);

alter table public.team_members enable row level security;

create policy "Team rosters are publicly readable"
    on public.team_members for select
    using (
        exists (
            select 1 from public.teams
            where teams.id = team_id
              and not teams.is_disabled
        )
    );

create policy "Members can read own memberships"
    on public.team_members for select
    using (auth.uid() = user_id);

create table public.tournaments (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique check (char_length(slug) <= 80),
    name text not null check (char_length(name) between 3 and 120),
    summary text check (char_length(summary) <= 500),
    logo_url text,
    organizer_id uuid not null references public.profiles(id) on delete restrict,
    starts_at timestamptz not null,
    registration_closes_at timestamptz,
    registration_mode text not null default 'open'
        check (registration_mode in ('open', 'manual_bracket')),
    status text not null default 'draft'
        check (status in ('draft', 'open', 'in_progress', 'completed', 'cancelled')),
    team_size integer not null default 8 check (team_size = 8),
    substitute_count integer not null default 1 check (substitute_count >= 0 and substitute_count <= 16),
    rules_url text check (rules_url is null or char_length(rules_url) <= 500),
    discord_url text check (discord_url is null or char_length(discord_url) <= 500),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index idx_tournaments_public_time
    on public.tournaments (starts_at desc)
    where status <> 'draft';

create index idx_tournaments_organizer
    on public.tournaments (organizer_id, starts_at desc);

alter table public.tournaments enable row level security;

create policy "Public tournaments are readable"
    on public.tournaments for select
    using (status <> 'draft');

create policy "Organizers can read own draft tournaments"
    on public.tournaments for select
    using (auth.uid() = organizer_id);

create policy "Reviewers can read all tournaments"
    on public.tournaments for select
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid()
              and role in ('contributor', 'admin')
        )
    );

create table public.tournament_registrations (
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    team_id uuid not null references public.teams(id) on delete cascade,
    status text not null default 'registered'
        check (status in ('registered', 'checked_in', 'withdrawn')),
    seed integer check (seed is null or seed > 0),
    registered_by uuid references public.profiles(id) on delete set null,
    registered_at timestamptz not null default now(),
    primary key (tournament_id, team_id)
);

create unique index idx_tournament_registrations_seed
    on public.tournament_registrations (tournament_id, seed)
    where seed is not null and status <> 'withdrawn';

alter table public.tournament_registrations enable row level security;

create policy "Public registrations are readable"
    on public.tournament_registrations for select
    using (
        exists (
            select 1 from public.tournaments
            where tournaments.id = tournament_id
              and tournaments.status <> 'draft'
        )
    );

create policy "Captains can read own registrations"
    on public.tournament_registrations for select
    using (
        exists (
            select 1 from public.teams
            where teams.id = team_id
              and teams.captain_id = auth.uid()
        )
    );

create table public.tournament_matches (
    id uuid primary key default gen_random_uuid(),
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    round integer not null check (round > 0),
    match_number integer not null check (match_number > 0),
    team_a_id uuid references public.teams(id) on delete set null,
    team_b_id uuid references public.teams(id) on delete set null,
    score_a integer not null default 0 check (score_a >= 0),
    score_b integer not null default 0 check (score_b >= 0),
    winner_team_id uuid references public.teams(id) on delete set null,
    status text not null default 'pending'
        check (status in ('pending', 'completed')),
    completed_at timestamptz,
    updated_at timestamptz not null default now(),
    unique (tournament_id, round, match_number)
);

create index idx_tournament_matches_tournament
    on public.tournament_matches (tournament_id, round, match_number);

create index idx_tournament_matches_team_a
    on public.tournament_matches (team_a_id)
    where team_a_id is not null;

create index idx_tournament_matches_team_b
    on public.tournament_matches (team_b_id)
    where team_b_id is not null;

alter table public.tournament_matches enable row level security;

create policy "Public matches are readable"
    on public.tournament_matches for select
    using (
        exists (
            select 1 from public.tournaments
            where tournaments.id = tournament_id
              and tournaments.status <> 'draft'
        )
    );

create trigger teams_touch_updated_at
    before update on public.teams
    for each row execute function public.touch_updated_at();

create trigger tournaments_touch_updated_at
    before update on public.tournaments
    for each row execute function public.touch_updated_at();

create trigger tournament_matches_touch_updated_at
    before update on public.tournament_matches
    for each row execute function public.touch_updated_at();
