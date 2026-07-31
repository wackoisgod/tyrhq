-- Save a complete tournament ranking in one transaction. Clearing the old
-- seeds first allows organizers to reorder teams without unique-index conflicts.

create or replace function public.replace_tournament_seeds(
    p_tournament_id uuid,
    p_team_ids jsonb
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
    v_ranked_count integer;
    v_registration_count integer;
begin
    if jsonb_typeof(p_team_ids) is distinct from 'array' then
        raise exception 'Team IDs must be a JSON array.';
    end if;

    v_ranked_count := jsonb_array_length(p_team_ids);
    if v_ranked_count = 0 then
        raise exception 'At least one team is required.';
    end if;

    perform 1
    from public.tournaments
    where id = p_tournament_id
      and status in ('draft', 'open')
    for update;

    if not found then
        raise exception 'Tournament is not editable.';
    end if;

    if exists (
        select 1
        from public.tournament_matches
        where tournament_id = p_tournament_id
    ) then
        raise exception 'Seeds are locked after bracket generation.';
    end if;

    select count(*)
    into v_registration_count
    from public.tournament_registrations
    where tournament_id = p_tournament_id
      and status <> 'withdrawn';

    if v_registration_count <> v_ranked_count then
        raise exception 'The ranking must include every registered team exactly once.';
    end if;

    if (
        select count(distinct ranked.team_id)
        from (
            select value::uuid as team_id
            from jsonb_array_elements_text(p_team_ids) as team_values(value)
        ) ranked
    ) <> v_ranked_count then
        raise exception 'The ranking contains duplicate teams.';
    end if;

    if exists (
        select 1
        from (
            select value::uuid as team_id
            from jsonb_array_elements_text(p_team_ids) as team_values(value)
        ) ranked
        left join public.tournament_registrations registration
          on registration.tournament_id = p_tournament_id
         and registration.team_id = ranked.team_id
         and registration.status <> 'withdrawn'
        where registration.team_id is null
    ) then
        raise exception 'The ranking contains a team that is not registered.';
    end if;

    update public.tournament_registrations
    set seed = null
    where tournament_id = p_tournament_id
      and status <> 'withdrawn';

    update public.tournament_registrations registration
    set seed = ranked.seed
    from (
        select value::uuid as team_id, ordinality::integer as seed
        from jsonb_array_elements_text(p_team_ids) with ordinality as team_values(value, ordinality)
    ) ranked
    where registration.tournament_id = p_tournament_id
      and registration.team_id = ranked.team_id
      and registration.status <> 'withdrawn';
end;
$$;

revoke all on function public.replace_tournament_seeds(uuid, jsonb) from public;
grant execute on function public.replace_tournament_seeds(uuid, jsonb) to service_role;
