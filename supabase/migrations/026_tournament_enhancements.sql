-- Tournament enhancements: max teams, prize info, target scores per round
--
-- Add new fields to tournaments table:
-- - max_teams: configurable maximum number of teams (default 10)
-- - prize_info: optional prize pool text or prize tournament flag
--
-- Add target_score to tournament_matches for per-round scoring targets

alter table public.tournaments
    add column if not exists max_teams integer not null default 10 
        check (max_teams > 0 and max_teams <= 256);

alter table public.tournaments
    add column if not exists prize_info text 
        check (prize_info is null or char_length(prize_info) <= 500);

comment on column public.tournaments.max_teams is 'Maximum number of teams allowed to register';
comment on column public.tournaments.prize_info is 'Optional prize pool description or prize tournament note';

alter table public.tournament_matches
    add column if not exists target_score integer
        check (target_score is null or (target_score > 0 and target_score <= 100));

comment on column public.tournament_matches.target_score is 'Target score for this round (e.g., first to 3)';

-- Update register_tournament_team function to check max_teams limit
create or replace function public.register_tournament_team(
    p_tournament_id uuid,
    p_team_id uuid,
    p_registered_by uuid,
    p_force boolean default false
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
    v_tournament public.tournaments%rowtype;
    v_team public.teams%rowtype;
    v_roster_count integer;
    v_registered_count integer;
begin
    select * into v_tournament
    from public.tournaments
    where id = p_tournament_id
    for update;

    if not found then
        raise exception 'Tournament not found.';
    end if;

    select * into v_team
    from public.teams
    where id = p_team_id and not is_disabled;

    if not found then
        raise exception 'Team not found.';
    end if;

    if exists (select 1 from public.tournament_matches where tournament_id = p_tournament_id) then
        raise exception 'Registration is locked after bracket generation.';
    end if;

    if p_force then
        if v_tournament.status not in ('draft', 'open') then
            raise exception 'Tournament registration is locked.';
        end if;
    else
        if v_team.captain_id <> p_registered_by then
            raise exception 'Only the team captain can register.';
        end if;
        if v_tournament.status <> 'open' or v_tournament.registration_mode <> 'open'
           or v_tournament.starts_at <= now()
           or (v_tournament.registration_closes_at is not null and v_tournament.registration_closes_at <= now()) then
            raise exception 'Tournament registration is closed.';
        end if;
    end if;

    -- Check if max_teams limit would be exceeded (only for new registrations, not re-registering withdrawn teams)
    select count(*) into v_registered_count
    from public.tournament_registrations
    where tournament_id = p_tournament_id
      and status in ('registered', 'checked_in')
      and team_id <> p_team_id;

    if v_registered_count >= v_tournament.max_teams then
        raise exception 'Tournament has reached the maximum number of teams (%).', v_tournament.max_teams;
    end if;

    if not exists (
        select 1 from public.tournament_roster_members
        where tournament_id = p_tournament_id and team_id = p_team_id
    ) then
        insert into public.tournament_roster_members (tournament_id, team_id, user_id, source)
        select p_tournament_id, p_team_id, members.user_id, 'team'
        from public.team_members members
        where members.team_id = p_team_id;
    end if;

    select count(*) into v_roster_count
    from public.tournament_roster_members
    where tournament_id = p_tournament_id and team_id = p_team_id;

    if not p_force and (
        v_roster_count < v_tournament.team_size
        or v_roster_count > v_tournament.team_size + v_tournament.substitute_count
    ) then
        raise exception 'Tournament roster size is invalid.';
    end if;

    insert into public.tournament_registrations (
        tournament_id, team_id, status, seed, registered_by
    ) values (
        p_tournament_id, p_team_id, 'registered', null, p_registered_by
    )
    on conflict (tournament_id, team_id) do update
    set status = 'registered', seed = null, registered_by = excluded.registered_by;

    insert into public.tournament_team_recruitment (tournament_id, team_id, is_recruiting)
    values (p_tournament_id, p_team_id, false)
    on conflict (tournament_id, team_id) do nothing;

    return v_roster_count;
end;
$$;

revoke all on function public.register_tournament_team(uuid, uuid, uuid, boolean) from public;
grant execute on function public.register_tournament_team(uuid, uuid, uuid, boolean) to service_role;
