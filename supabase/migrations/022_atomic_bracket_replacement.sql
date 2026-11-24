-- Replace a tournament bracket in one transaction so regeneration failures
-- leave the previous bracket intact.

create or replace function public.replace_tournament_bracket(
    p_tournament_id uuid,
    p_matches jsonb
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if jsonb_typeof(p_matches) is distinct from 'array' then
        raise exception 'Bracket matches must be a JSON array.';
    end if;

    if jsonb_array_length(p_matches) = 0 then
        raise exception 'At least one bracket match is required.';
    end if;

    perform 1
    from public.tournaments
    where id = p_tournament_id
    for update;

    if not found then
        raise exception 'Tournament not found.';
    end if;

    delete from public.tournament_matches
    where tournament_id = p_tournament_id;

    insert into public.tournament_matches (
        tournament_id,
        round,
        match_number,
        team_a_id,
        team_b_id,
        winner_team_id,
        status,
        completed_at
    )
    select
        p_tournament_id,
        bracket_match.round,
        bracket_match.match_number,
        bracket_match.team_a_id,
        bracket_match.team_b_id,
        bracket_match.winner_team_id,
        coalesce(bracket_match.status, 'pending'),
        bracket_match.completed_at
    from jsonb_to_recordset(p_matches) as bracket_match (
        round integer,
        match_number integer,
        team_a_id uuid,
        team_b_id uuid,
        winner_team_id uuid,
        status text,
        completed_at timestamptz
    );

    update public.tournaments
    set status = 'in_progress'
    where id = p_tournament_id;
end;
$$;

revoke all on function public.replace_tournament_bracket(uuid, jsonb) from public;
grant execute on function public.replace_tournament_bracket(uuid, jsonb) to service_role;
