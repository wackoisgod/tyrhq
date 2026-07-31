-- Tournament-specific rosters and a player-initiated free-agent pool.

create table public.tournament_free_agents (
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    status text not null default 'available'
        check (status in ('available', 'placed', 'withdrawn')),
    preferred_role text check (preferred_role is null or char_length(preferred_role) <= 80),
    note text check (note is null or char_length(note) <= 280),
    registered_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (tournament_id, user_id)
);

create index idx_tournament_free_agents_available
    on public.tournament_free_agents (tournament_id, registered_at)
    where status = 'available';

alter table public.tournament_free_agents enable row level security;

create policy "Published tournament free agents are readable"
    on public.tournament_free_agents for select
    using (
        auth.uid() = user_id
        or (
            status = 'available' and exists (
            select 1 from public.tournaments
            where tournaments.id = tournament_id
              and tournaments.status <> 'draft'
            )
        )
    );

create table public.tournament_team_recruitment (
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    team_id uuid not null references public.teams(id) on delete cascade,
    is_recruiting boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (tournament_id, team_id)
);

alter table public.tournament_team_recruitment enable row level security;

create policy "Published tournament recruiting teams are readable"
    on public.tournament_team_recruitment for select
    using (
        exists (
            select 1 from public.tournaments
            where tournaments.id = tournament_id
              and tournaments.status <> 'draft'
        )
        or exists (
            select 1 from public.teams
            where teams.id = team_id
              and teams.captain_id = auth.uid()
        )
    );

create table public.tournament_roster_members (
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    team_id uuid not null references public.teams(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    source text not null default 'team'
        check (source in ('team', 'free_agent')),
    joined_at timestamptz not null default now(),
    primary key (tournament_id, team_id, user_id),
    unique (tournament_id, user_id)
);

create index idx_tournament_roster_members_team
    on public.tournament_roster_members (tournament_id, team_id, joined_at);

alter table public.tournament_roster_members enable row level security;

create policy "Published tournament rosters are readable"
    on public.tournament_roster_members for select
    using (
        exists (
            select 1 from public.tournaments
            where tournaments.id = tournament_id
              and tournaments.status <> 'draft'
        )
        or exists (
            select 1 from public.teams
            where teams.id = team_id
              and teams.captain_id = auth.uid()
        )
    );

insert into public.tournament_roster_members (tournament_id, team_id, user_id, source)
select registrations.tournament_id, registrations.team_id, members.user_id, 'team'
from public.tournament_registrations registrations
join public.team_members members on members.team_id = registrations.team_id
where registrations.status <> 'withdrawn'
on conflict (tournament_id, user_id) do nothing;

insert into public.tournament_team_recruitment (tournament_id, team_id, is_recruiting)
select tournament_id, team_id, false
from public.tournament_registrations
where status <> 'withdrawn'
on conflict (tournament_id, team_id) do nothing;

create table public.tournament_free_agent_requests (
    tournament_id uuid not null,
    team_id uuid not null,
    user_id uuid not null,
    status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected', 'cancelled')),
    requested_at timestamptz not null default now(),
    reviewed_at timestamptz,
    reviewed_by uuid references public.profiles(id) on delete set null,
    primary key (tournament_id, team_id, user_id),
    foreign key (tournament_id, user_id)
        references public.tournament_free_agents(tournament_id, user_id) on delete cascade,
    foreign key (tournament_id, team_id)
        references public.tournament_team_recruitment(tournament_id, team_id) on delete cascade
);

create index idx_tournament_free_agent_requests_pending_team
    on public.tournament_free_agent_requests (tournament_id, team_id, requested_at)
    where status = 'pending';

alter table public.tournament_free_agent_requests enable row level security;

create policy "Free agents can read own pickup requests"
    on public.tournament_free_agent_requests for select
    using (auth.uid() = user_id);

create policy "Captains can read pickup requests"
    on public.tournament_free_agent_requests for select
    using (
        exists (
            select 1 from public.teams
            where teams.id = team_id
              and teams.captain_id = auth.uid()
        )
    );

create trigger tournament_free_agents_touch_updated_at
    before update on public.tournament_free_agents
    for each row execute function public.touch_updated_at();

create trigger tournament_team_recruitment_touch_updated_at
    before update on public.tournament_team_recruitment
    for each row execute function public.touch_updated_at();

create or replace function public.clear_available_free_agents_on_team_join()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    delete from public.tournament_free_agents
    where user_id = new.user_id
      and status = 'available';
    return new;
end;
$$;

create trigger team_members_clear_available_free_agents
    after insert on public.team_members
    for each row execute function public.clear_available_free_agents_on_team_join();

create or replace function public.set_tournament_team_recruiting(
    p_tournament_id uuid,
    p_team_id uuid,
    p_is_recruiting boolean
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
    v_tournament public.tournaments%rowtype;
    v_roster_count integer;
begin
    select * into v_tournament
    from public.tournaments
    where id = p_tournament_id
    for update;

    if not found then
        raise exception 'Tournament not found.';
    end if;

    if v_tournament.status <> 'open' or v_tournament.registration_mode <> 'open' then
        raise exception 'Tournament registration is not open.';
    end if;

    if v_tournament.starts_at <= now()
       or (v_tournament.registration_closes_at is not null and v_tournament.registration_closes_at <= now())
       or exists (select 1 from public.tournament_matches where tournament_id = p_tournament_id) then
        raise exception 'Tournament registration is closed.';
    end if;

    if not exists (
        select 1 from public.teams
        where id = p_team_id and not is_disabled
    ) then
        raise exception 'Team not found.';
    end if;

    if p_is_recruiting and not exists (
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

    if p_is_recruiting and v_roster_count >= v_tournament.team_size + v_tournament.substitute_count then
        raise exception 'Tournament roster is already full.';
    end if;

    insert into public.tournament_team_recruitment (tournament_id, team_id, is_recruiting)
    values (p_tournament_id, p_team_id, p_is_recruiting)
    on conflict (tournament_id, team_id) do update
    set is_recruiting = excluded.is_recruiting;

    return v_roster_count;
end;
$$;

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

create or replace function public.review_tournament_free_agent_request(
    p_tournament_id uuid,
    p_team_id uuid,
    p_user_id uuid,
    p_decision text,
    p_reviewed_by uuid
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
    v_tournament public.tournaments%rowtype;
    v_roster_count integer;
begin
    if p_decision not in ('approve', 'reject') then
        raise exception 'Invalid pickup request decision.';
    end if;

    select * into v_tournament
    from public.tournaments
    where id = p_tournament_id
    for update;

    if not found then
        raise exception 'Tournament not found.';
    end if;

    if v_tournament.status <> 'open'
       or v_tournament.registration_mode <> 'open'
       or v_tournament.starts_at <= now()
       or (v_tournament.registration_closes_at is not null and v_tournament.registration_closes_at <= now())
       or exists (select 1 from public.tournament_matches where tournament_id = p_tournament_id) then
        raise exception 'Tournament registration is closed.';
    end if;

    perform 1
    from public.tournament_free_agent_requests
    where tournament_id = p_tournament_id
      and team_id = p_team_id
      and user_id = p_user_id
      and status = 'pending'
    for update;

    if not found then
        raise exception 'Pickup request is no longer pending.';
    end if;

    if p_decision = 'reject' then
        update public.tournament_free_agent_requests
        set status = 'rejected', reviewed_at = now(), reviewed_by = p_reviewed_by
        where tournament_id = p_tournament_id and team_id = p_team_id and user_id = p_user_id;
        return;
    end if;

    if not exists (
        select 1 from public.tournament_team_recruitment
        where tournament_id = p_tournament_id and team_id = p_team_id and is_recruiting
    ) then
        raise exception 'Team is no longer recruiting.';
    end if;

    perform 1
    from public.tournament_free_agents
    where tournament_id = p_tournament_id
      and user_id = p_user_id
      and status = 'available'
    for update;

    if not found then
        raise exception 'Free agent is no longer available.';
    end if;

    if exists (select 1 from public.team_members where user_id = p_user_id) then
        raise exception 'Free agent has already joined a permanent team.';
    end if;

    select count(*) into v_roster_count
    from public.tournament_roster_members
    where tournament_id = p_tournament_id and team_id = p_team_id;

    if v_roster_count >= v_tournament.team_size + v_tournament.substitute_count then
        raise exception 'Tournament roster is full.';
    end if;

    insert into public.tournament_roster_members (tournament_id, team_id, user_id, source)
    values (p_tournament_id, p_team_id, p_user_id, 'free_agent');

    update public.tournament_free_agents
    set status = 'placed'
    where tournament_id = p_tournament_id and user_id = p_user_id;

    update public.tournament_free_agent_requests
    set
        status = case when team_id = p_team_id then 'approved' else 'cancelled' end,
        reviewed_at = now(),
        reviewed_by = case when team_id = p_team_id then p_reviewed_by else null end
    where tournament_id = p_tournament_id
      and user_id = p_user_id
      and status = 'pending';

    if v_roster_count + 1 >= v_tournament.team_size + v_tournament.substitute_count then
        update public.tournament_team_recruitment
        set is_recruiting = false
        where tournament_id = p_tournament_id and team_id = p_team_id;
    end if;
end;
$$;

revoke all on function public.set_tournament_team_recruiting(uuid, uuid, boolean) from public;
revoke all on function public.register_tournament_team(uuid, uuid, uuid, boolean) from public;
revoke all on function public.review_tournament_free_agent_request(uuid, uuid, uuid, text, uuid) from public;

grant execute on function public.set_tournament_team_recruiting(uuid, uuid, boolean) to service_role;
grant execute on function public.register_tournament_team(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.review_tournament_free_agent_request(uuid, uuid, uuid, text, uuid) to service_role;
