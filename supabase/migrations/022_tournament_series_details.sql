-- Game-by-game tournament series details, player vehicle lineups, and
-- tournament build submissions. All detail is optional so existing brackets
-- and quick-result workflows continue to work.

alter table public.tournament_matches
    add column if not exists best_of integer not null default 5,
    add column if not exists scheduled_at timestamptz,
    add column if not exists stream_url text,
    add column if not exists notes text;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'tournament_matches_best_of_check'
    ) then
        alter table public.tournament_matches
            add constraint tournament_matches_best_of_check
            check (best_of between 1 and 15 and best_of % 2 = 1);
    end if;
    if not exists (
        select 1 from pg_constraint where conname = 'tournament_matches_stream_url_check'
    ) then
        alter table public.tournament_matches
            add constraint tournament_matches_stream_url_check
            check (stream_url is null or char_length(stream_url) <= 500);
    end if;
    if not exists (
        select 1 from pg_constraint where conname = 'tournament_matches_notes_check'
    ) then
        alter table public.tournament_matches
            add constraint tournament_matches_notes_check
            check (notes is null or char_length(notes) <= 1000);
    end if;
end;
$$;

-- Existing generated brackets used aggregate results only. Give every round a
-- best-of-five default and make the last round best-of-seven.
with final_rounds as (
    select tournament_id, max(round) as final_round
    from public.tournament_matches
    group by tournament_id
)
update public.tournament_matches matches
set best_of = case when matches.round = final_rounds.final_round then 7 else 5 end
from final_rounds
where final_rounds.tournament_id = matches.tournament_id;

create table public.tournament_match_games (
    id uuid primary key default gen_random_uuid(),
    match_id uuid not null references public.tournament_matches(id) on delete cascade,
    game_number integer not null check (game_number between 1 and 15),
    map_id text not null check (char_length(map_id) between 1 and 120),
    map_picked_by_team_id uuid not null references public.teams(id) on delete restrict,
    winner_team_id uuid references public.teams(id) on delete set null,
    vod_url text check (vod_url is null or char_length(vod_url) <= 500),
    notes text check (notes is null or char_length(notes) <= 500),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (match_id, game_number)
);

create index idx_tournament_match_games_match
    on public.tournament_match_games (match_id, game_number);

alter table public.tournament_match_games enable row level security;

create policy "Published tournament games are readable"
    on public.tournament_match_games for select
    using (
        exists (
            select 1
            from public.tournament_matches matches
            join public.tournaments tournaments on tournaments.id = matches.tournament_id
            where matches.id = match_id
              and tournaments.status <> 'draft'
        )
    );

create table public.tournament_build_submissions (
    id uuid primary key default gen_random_uuid(),
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    build_id uuid references public.builds(id) on delete set null,
    build_slug_snapshot text not null,
    build_title_snapshot text not null,
    vehicle_id text not null,
    build_snapshot jsonb not null,
    visibility text not null default 'after_match'
        check (visibility in ('immediate', 'after_match', 'after_tournament')),
    submitted_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (tournament_id, user_id)
        references public.tournament_roster_members(tournament_id, user_id) on delete cascade,
    unique (tournament_id, user_id, build_id)
);

create index idx_tournament_build_submissions_tournament
    on public.tournament_build_submissions (tournament_id, submitted_at);

create index idx_tournament_build_submissions_user
    on public.tournament_build_submissions (user_id, submitted_at desc);

alter table public.tournament_build_submissions enable row level security;

create table public.tournament_game_lineups (
    game_id uuid not null references public.tournament_match_games(id) on delete cascade,
    team_id uuid not null references public.teams(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    vehicle_id text not null,
    build_submission_id uuid references public.tournament_build_submissions(id) on delete set null,
    submitted_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (game_id, user_id)
);

create index idx_tournament_game_lineups_game_team
    on public.tournament_game_lineups (game_id, team_id);

create index idx_tournament_game_lineups_build
    on public.tournament_game_lineups (build_submission_id)
    where build_submission_id is not null;

alter table public.tournament_game_lineups enable row level security;

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
              and (matches.status = 'completed' or tournaments.status = 'completed')
        )
    );

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
            )
        )
        or (
            visibility = 'after_tournament'
            and exists (
                select 1 from public.tournaments
                where tournaments.id = tournament_id
                  and tournaments.status = 'completed'
            )
        )
        or (
            visibility = 'after_match'
            and exists (
                select 1
                from public.tournament_game_lineups lineups
                join public.tournament_match_games games on games.id = lineups.game_id
                join public.tournament_matches matches on matches.id = games.match_id
                where lineups.build_submission_id = tournament_build_submissions.id
                  and matches.status = 'completed'
            )
        )
    );

create trigger tournament_match_games_touch_updated_at
    before update on public.tournament_match_games
    for each row execute function public.touch_updated_at();

create trigger tournament_build_submissions_touch_updated_at
    before update on public.tournament_build_submissions
    for each row execute function public.touch_updated_at();

create trigger tournament_game_lineups_touch_updated_at
    before update on public.tournament_game_lineups
    for each row execute function public.touch_updated_at();

-- Include the inherited series format when a bracket is atomically replaced.
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
        completed_at,
        best_of
    )
    select
        p_tournament_id,
        bracket_match.round,
        bracket_match.match_number,
        bracket_match.team_a_id,
        bracket_match.team_b_id,
        bracket_match.winner_team_id,
        coalesce(bracket_match.status, 'pending'),
        bracket_match.completed_at,
        coalesce(bracket_match.best_of, 5)
    from jsonb_to_recordset(p_matches) as bracket_match (
        round integer,
        match_number integer,
        team_a_id uuid,
        team_b_id uuid,
        winner_team_id uuid,
        status text,
        completed_at timestamptz,
        best_of integer
    );

    update public.tournaments
    set status = 'in_progress'
    where id = p_tournament_id;
end;
$$;

revoke all on function public.replace_tournament_bracket(uuid, jsonb) from public;
grant execute on function public.replace_tournament_bracket(uuid, jsonb) to service_role;
