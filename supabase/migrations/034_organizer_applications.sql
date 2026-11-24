-- Organizer applications and tournament unlisting.
-- Applicants apply from Settings. Admins review the queue. Approval sets
-- profiles.is_tournament_organizer through the service-role server path.
-- This migration is not applied automatically.
--
-- organizer_applications
--   pending   — one open application per user
--   approved  — admin accepted it; the server also grants organizer access
--   rejected  — kept so the applicant can read the note; reapply after 30 days

create table public.organizer_applications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    discord_handle text not null check (char_length(discord_handle) between 2 and 100),
    past_events text not null check (char_length(past_events) between 1 and 2000),
    event_format text not null check (char_length(event_format) between 2 and 80),
    region text not null check (char_length(region) between 2 and 80),
    frequency text not null check (char_length(frequency) between 2 and 80),
    expected_player_count integer not null check (expected_player_count between 2 and 10000),
    status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected')),
    review_note text check (review_note is null or char_length(review_note) <= 2000),
    reviewed_by uuid references public.profiles(id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index idx_organizer_applications_one_pending
    on public.organizer_applications (user_id)
    where status = 'pending';

create index idx_organizer_applications_status_created
    on public.organizer_applications (status, created_at desc);

create index idx_organizer_applications_user
    on public.organizer_applications (user_id, created_at desc);

alter table public.organizer_applications enable row level security;

create policy "Applicants read own organizer applications"
    on public.organizer_applications for select
    to authenticated
    using (auth.uid() = user_id);

create policy "Admins read organizer applications"
    on public.organizer_applications for select
    to authenticated
    using (
        exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
              and profiles.role = 'admin'
        )
    );

-- Applicants can file a pending application for themselves. Status, reviewer,
-- and note are pinned so a client insert cannot approve itself.
create policy "Applicants insert own organizer applications"
    on public.organizer_applications for insert
    to authenticated
    with check (
        auth.uid() = user_id
        and status = 'pending'
        and reviewed_by is null
        and reviewed_at is null
        and review_note is null
    );

create policy "Admins update organizer applications"
    on public.organizer_applications for update
    to authenticated
    using (
        exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
              and profiles.role = 'admin'
        )
    )
    with check (
        exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
              and profiles.role = 'admin'
        )
    );

revoke all on table public.organizer_applications from public, anon, authenticated;
grant select, insert, update on table public.organizer_applications to authenticated;
grant select, insert, update, delete on table public.organizer_applications to service_role;

-- Steam, one-pending, and the 30-day rejection cooldown also hold for direct
-- client inserts. Service-role review updates the row; it does not insert a
-- pre-approved application. Granting organizer access is not done here.
create or replace function public.enforce_organizer_application_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_steam text;
    v_organizer boolean;
    v_rejected_at timestamptz;
begin
    if new.status is distinct from 'pending' then
        raise exception 'Applications must be submitted as pending';
    end if;

    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := null;

    select verified_steam_id, is_tournament_organizer
      into v_steam, v_organizer
    from public.profiles
    where id = new.user_id;

    if v_steam is null then
        raise exception 'Steam must be linked before applying';
    end if;

    if coalesce(v_organizer, false) then
        raise exception 'Organizer access is already granted';
    end if;

    select reviewed_at
      into v_rejected_at
    from public.organizer_applications
    where user_id = new.user_id
      and status = 'rejected'
    order by reviewed_at desc nulls last
    limit 1;

    if v_rejected_at is not null and v_rejected_at > now() - interval '30 days' then
        raise exception 'Reapply is available 30 days after a rejection';
    end if;

    return new;
end;
$$;

revoke all on function public.enforce_organizer_application_insert() from public, anon, authenticated;

drop trigger if exists organizer_applications_enforce_insert on public.organizer_applications;
create trigger organizer_applications_enforce_insert
    before insert on public.organizer_applications
    for each row execute function public.enforce_organizer_application_insert();

drop trigger if exists organizer_applications_touch_updated_at on public.organizer_applications;
create trigger organizer_applications_touch_updated_at
    before update on public.organizer_applications
    for each row execute function public.touch_updated_at();

-- role and is_tournament_organizer stay server-owned. Authenticated clients
-- can still edit their callsign and social fields.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    jwt_role text;
begin
    jwt_role := coalesce(
        current_setting('request.jwt.claims', true)::json->>'role',
        ''
    );

    if jwt_role = 'service_role' then
        return new;
    end if;

    if jwt_role = '' and current_user in ('postgres', 'supabase_admin') then
        return new;
    end if;

    if tg_op = 'INSERT' then
        if new.role is distinct from 'user' or coalesce(new.is_tournament_organizer, false) then
            raise exception 'role and organizer access can only be changed by the server';
        end if;
    end if;

    if tg_op = 'UPDATE' then
        if new.role is distinct from old.role
           or new.is_tournament_organizer is distinct from old.is_tournament_organizer then
            raise exception 'role and organizer access can only be changed by the server';
        end if;
    end if;

    return new;
end;
$$;

revoke all on function public.protect_profile_privileges() from public, anon, authenticated;

drop trigger if exists enforce_profile_privileges on public.profiles;
create trigger enforce_profile_privileges
    before insert or update on public.profiles
    for each row execute function public.protect_profile_privileges();

revoke insert (role, is_tournament_organizer) on public.profiles from anon, authenticated;
revoke update (role, is_tournament_organizer) on public.profiles from anon, authenticated;
grant update (role, is_tournament_organizer) on public.profiles to service_role;

-- Unlisting hides a tournament from public reads. The row, registrations, and
-- results stay. Revoking organizer access does not delete tournaments.
alter table public.tournaments
    add column if not exists unlisted_at timestamptz,
    add column if not exists unlisted_by uuid references public.profiles(id) on delete set null,
    add column if not exists unlist_note text check (unlist_note is null or char_length(unlist_note) <= 500);

drop index if exists idx_tournaments_public_time;
create index idx_tournaments_public_time
    on public.tournaments (starts_at desc)
    where status <> 'draft' and unlisted_at is null;

drop policy if exists "Public tournaments are readable" on public.tournaments;
create policy "Public tournaments are readable"
    on public.tournaments for select
    using (status <> 'draft' and unlisted_at is null);

drop policy if exists "Public registrations are readable" on public.tournament_registrations;
create policy "Public registrations are readable"
    on public.tournament_registrations for select
    using (
        exists (
            select 1 from public.tournaments
            where tournaments.id = tournament_id
              and tournaments.status <> 'draft'
              and tournaments.unlisted_at is null
        )
    );

drop policy if exists "Public matches are readable" on public.tournament_matches;
create policy "Public matches are readable"
    on public.tournament_matches for select
    using (
        exists (
            select 1 from public.tournaments
            where tournaments.id = tournament_id
              and tournaments.status <> 'draft'
              and tournaments.unlisted_at is null
        )
    );

drop policy if exists "Published tournament free agents are readable" on public.tournament_free_agents;
create policy "Published tournament free agents are readable"
    on public.tournament_free_agents for select
    using (
        auth.uid() = user_id
        or (
            status = 'available' and exists (
                select 1 from public.tournaments
                where tournaments.id = tournament_id
                  and tournaments.status <> 'draft'
                  and tournaments.unlisted_at is null
            )
        )
    );

drop policy if exists "Published tournament recruiting teams are readable" on public.tournament_team_recruitment;
create policy "Published tournament recruiting teams are readable"
    on public.tournament_team_recruitment for select
    using (
        exists (
            select 1 from public.tournaments
            where tournaments.id = tournament_id
              and tournaments.status <> 'draft'
              and tournaments.unlisted_at is null
        )
        or exists (
            select 1 from public.teams
            where teams.id = team_id
              and teams.captain_id = auth.uid()
        )
    );

drop policy if exists "Published tournament rosters are readable" on public.tournament_roster_members;
create policy "Published tournament rosters are readable"
    on public.tournament_roster_members for select
    using (
        exists (
            select 1 from public.tournaments
            where tournaments.id = tournament_id
              and tournaments.status <> 'draft'
              and tournaments.unlisted_at is null
        )
        or exists (
            select 1 from public.teams
            where teams.id = team_id
              and teams.captain_id = auth.uid()
        )
    );

drop policy if exists "Published tournament games are readable" on public.tournament_match_games;
create policy "Published tournament games are readable"
    on public.tournament_match_games for select
    using (
        exists (
            select 1
            from public.tournament_matches matches
            join public.tournaments tournaments on tournaments.id = matches.tournament_id
            where matches.id = match_id
              and tournaments.status <> 'draft'
              and tournaments.unlisted_at is null
        )
    );

drop policy if exists "Published game stats are readable" on public.tournament_game_player_stats;
create policy "Published game stats are readable"
    on public.tournament_game_player_stats for select
    using (
        exists (
            select 1
            from public.tournament_match_games games
            join public.tournament_matches matches on matches.id = games.match_id
            join public.tournaments tournaments on tournaments.id = matches.tournament_id
            where games.id = game_id
              and tournaments.status <> 'draft'
              and tournaments.unlisted_at is null
        )
    );

drop policy if exists "Players and organizers can read active lineups" on public.tournament_game_lineups;
create policy "Players and organizers can read active lineups"
    on public.tournament_game_lineups for select
    using (
        auth.uid() = user_id
        or exists (
            select 1
            from public.tournament_match_games games
            join public.tournament_matches matches on matches.id = games.match_id
            join public.tournaments tournaments on tournaments.id = matches.tournament_id
            where games.id = game_id
              and tournaments.organizer_id = auth.uid()
        )
        or exists (
            select 1
            from public.tournament_match_games games
            join public.tournament_matches matches on matches.id = games.match_id
            join public.tournaments tournaments on tournaments.id = matches.tournament_id
            where games.id = game_id
              and tournaments.unlisted_at is null
              and (matches.status = 'completed' or tournaments.status = 'completed')
        )
    );

drop policy if exists "Owners organizers and released builds can read submissions" on public.tournament_build_submissions;
create policy "Owners organizers and released builds can read submissions"
    on public.tournament_build_submissions for select
    using (
        auth.uid() = user_id
        or exists (
            select 1 from public.tournaments
            where tournaments.id = tournament_id
              and tournaments.organizer_id = auth.uid()
        )
        or (
            visibility = 'immediate'
            and exists (
                select 1 from public.tournaments
                where tournaments.id = tournament_id
                  and tournaments.status <> 'draft'
                  and tournaments.unlisted_at is null
            )
        )
        or (
            visibility = 'after_tournament'
            and exists (
                select 1 from public.tournaments
                where tournaments.id = tournament_id
                  and tournaments.status = 'completed'
                  and tournaments.unlisted_at is null
            )
        )
        or (
            visibility = 'after_match'
            and exists (
                select 1
                from public.tournament_game_lineups lineups
                join public.tournament_match_games games on games.id = lineups.game_id
                join public.tournament_matches matches on matches.id = games.match_id
                join public.tournaments tournaments on tournaments.id = matches.tournament_id
                where lineups.build_submission_id = tournament_build_submissions.id
                  and matches.status = 'completed'
                  and tournaments.unlisted_at is null
            )
        )
    );

comment on table public.organizer_applications is 'Applications for tournament organizer access. Approval grants profiles.is_tournament_organizer from the server.';
comment on column public.tournaments.unlisted_at is 'When set, the tournament stays in the database but is hidden from public reads.';
