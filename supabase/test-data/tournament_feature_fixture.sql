-- Tournament feature test fixture.
--
-- Run this in the Supabase SQL editor after migrations 016 through 022.
-- It expects the real organizer account to already exist as
-- Wacko's account, aspiering@gmail.com. The script aborts without changing
-- data if that account or the tournament-series tables are missing.
--
-- This fixture is rerunnable. Each run deletes only records using the
-- aggro-test-* slugs and aggro.tournament.player.*@example.invalid emails,
-- then recreates:
--   * an open tournament for registration, recruiting, and free-agent flows;
--   * an eight-team in-progress tournament using the standard snake bracket;
--   * a completed tournament with a best-of-seven final archive;
--   * nine teams, 68 synthetic profile fixtures, builds, map picks, and lineups.
--
-- Synthetic auth rows exist only to satisfy profile foreign keys and are not
-- login accounts. Sign in as aspiering@gmail.com to test organizer actions.

begin;

do $fixture$
declare
    v_organizer_id uuid;
    v_open_tournament_id uuid := 'a3000000-0000-4000-8000-000000000001';
    v_live_tournament_id uuid := 'a3000000-0000-4000-8000-000000000002';
    v_complete_tournament_id uuid := 'a3000000-0000-4000-8000-000000000003';
begin
    if to_regclass('public.tournament_match_games') is null
       or to_regclass('public.tournament_build_submissions') is null
       or to_regclass('public.tournament_roster_members') is null then
        raise exception 'Tournament migrations through 022 must be applied first.';
    end if;

    select users.id
    into v_organizer_id
    from auth.users users
    where lower(users.email) = 'aspiering@gmail.com'
    order by users.created_at
    limit 1;

    if v_organizer_id is null then
        raise exception 'No auth user exists for aspiering@gmail.com.';
    end if;

    -- Remove a prior copy of this fixture in dependency order.
    delete from public.tournaments
    where slug in ('aggro-test-open', 'aggro-test-live', 'aggro-test-complete');

    delete from public.builds
    where slug in ('aggro-test-build-alpha', 'aggro-test-build-bravo', 'aggro-test-build-charlie');

    delete from public.teams
    where slug like 'aggro-test-team-%'
       or slug = 'aggro-test-wacko-squad';

    delete from auth.users
    where email like 'aggro.tournament.player.%@example.invalid';

    -- Create 68 deterministic placeholder users. They intentionally have no
    -- password or auth identity, so Supabase will not treat them as sign-in
    -- accounts. The existing new-user trigger creates their profile rows.
    with fixture_users as (
        select
            n,
            ('a1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid as id,
            'aggro.tournament.player.' || lpad(n::text, 2, '0') || '@example.invalid' as email
        from generate_series(1, 68) as numbers(n)
    )
    insert into auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
    )
    select
        '00000000-0000-0000-0000-000000000000'::uuid,
        id,
        'authenticated',
        'authenticated',
        email,
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('name', 'Tournament Test Player ' || lpad(n::text, 2, '0')),
        now(),
        now()
    from fixture_users;

    with fixture_users as (
        select
            n,
            ('a1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid as id
        from generate_series(1, 68) as numbers(n)
    )
    insert into public.profiles (id, display_name)
    select id, 'Tournament Test Player ' || lpad(n::text, 2, '0')
    from fixture_users
    on conflict (id) do update
    set display_name = excluded.display_name;

    insert into public.profiles (id, display_name, is_tournament_organizer)
    values (v_organizer_id, 'wacko', true)
    on conflict (id) do update
    set is_tournament_organizer = true;

    -- Eight full synthetic teams plus a Wacko-owned squad for testing captain
    -- approval and free-agent pickup flows while signed into the real account.
    with fixture_teams as (
        select
            n,
            ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid as id,
            ('a1000000-0000-4000-8000-' || lpad((((n - 1) * 8) + 1)::text, 12, '0'))::uuid as captain_id
        from generate_series(1, 8) as numbers(n)
    )
    insert into public.teams (id, slug, name, description, captain_id)
    select
        id,
        'aggro-test-team-' || n,
        'Aggro Test Team ' || n,
        'Synthetic tournament fixture team ' || n || '.',
        captain_id
    from fixture_teams;

    insert into public.teams (id, slug, name, description, captain_id)
    values (
        'a2000000-0000-4000-8000-000000000009',
        'aggro-test-wacko-squad',
        'Aggro Test Wacko Squad',
        'A test team captained by the real Wacko account.',
        v_organizer_id
    );

    with fixture_members as (
        select
            team_number,
            player_number,
            ((team_number - 1) * 8) + player_number as global_player_number
        from generate_series(1, 8) as teams(team_number)
        cross join generate_series(1, 8) as players(player_number)
    )
    insert into public.team_members (team_id, user_id, role)
    select
        ('a2000000-0000-4000-8000-' || lpad(team_number::text, 12, '0'))::uuid,
        ('a1000000-0000-4000-8000-' || lpad(global_player_number::text, 12, '0'))::uuid,
        case when player_number = 1 then 'captain' else 'member' end
    from fixture_members;

    insert into public.team_members (team_id, user_id, role)
    values ('a2000000-0000-4000-8000-000000000009', v_organizer_id, 'captain');

    insert into public.tournaments (
        id,
        slug,
        name,
        summary,
        organizer_id,
        starts_at,
        registration_closes_at,
        registration_mode,
        status,
        team_size,
        substitute_count,
        rules_url,
        discord_url
    ) values
        (
            v_open_tournament_id,
            'aggro-test-open',
            'Aggro Test: Open Registration',
            'Use this tournament to test registration reopening, forced registration, recruiting, and free agents.',
            v_organizer_id,
            now() + interval '14 days',
            now() + interval '7 days',
            'open',
            'open',
            8,
            1,
            'https://example.com/test-rules',
            'https://discord.com'
        ),
        (
            v_live_tournament_id,
            'aggro-test-live',
            'Aggro Test: Live Snake Bracket',
            'Eight seeded teams with a standard 1v8, 2v7, 3v6, 4v5 bracket and recorded series details.',
            v_organizer_id,
            now() - interval '1 day',
            now() - interval '8 days',
            'open',
            'in_progress',
            8,
            1,
            'https://example.com/test-rules',
            null
        ),
        (
            v_complete_tournament_id,
            'aggro-test-complete',
            'Aggro Test: Completed Archive',
            'Completed four-team bracket with a best-of-seven final, maps, vehicles, and released builds.',
            v_organizer_id,
            now() - interval '30 days',
            now() - interval '37 days',
            'open',
            'completed',
            8,
            1,
            'https://example.com/test-rules',
            null
        );

    -- Open tournament: Wacko's squad plus three synthetic teams.
    insert into public.tournament_registrations (
        tournament_id, team_id, status, registered_by
    ) values
        (v_open_tournament_id, 'a2000000-0000-4000-8000-000000000009', 'registered', v_organizer_id),
        (v_open_tournament_id, 'a2000000-0000-4000-8000-000000000001', 'registered', v_organizer_id),
        (v_open_tournament_id, 'a2000000-0000-4000-8000-000000000002', 'registered', v_organizer_id),
        (v_open_tournament_id, 'a2000000-0000-4000-8000-000000000003', 'registered', v_organizer_id);

    -- Live tournament: all eight seeds in standard order.
    insert into public.tournament_registrations (
        tournament_id, team_id, status, seed, registered_by
    )
    select
        v_live_tournament_id,
        ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
        'checked_in',
        n,
        v_organizer_id
    from generate_series(1, 8) as seeds(n);

    -- Completed tournament: the first four teams.
    insert into public.tournament_registrations (
        tournament_id, team_id, status, seed, registered_by
    )
    select
        v_complete_tournament_id,
        ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
        'checked_in',
        n,
        v_organizer_id
    from generate_series(1, 4) as seeds(n);

    insert into public.tournament_roster_members (tournament_id, team_id, user_id, source)
    select registrations.tournament_id, registrations.team_id, members.user_id, 'team'
    from public.tournament_registrations registrations
    join public.team_members members on members.team_id = registrations.team_id
    where registrations.tournament_id in (
        v_open_tournament_id,
        v_live_tournament_id,
        v_complete_tournament_id
    );

    insert into public.tournament_team_recruitment (tournament_id, team_id, is_recruiting)
    select
        registrations.tournament_id,
        registrations.team_id,
        registrations.tournament_id = v_open_tournament_id
            and registrations.team_id = 'a2000000-0000-4000-8000-000000000009'::uuid
    from public.tournament_registrations registrations
    where registrations.tournament_id in (
        v_open_tournament_id,
        v_live_tournament_id,
        v_complete_tournament_id
    );

    insert into public.tournament_free_agents (
        tournament_id, user_id, status, preferred_role, note
    ) values
        (
            v_open_tournament_id,
            'a1000000-0000-4000-8000-000000000065',
            'available',
            'Flex',
            'Pending pickup request to Wacko Squad.'
        ),
        (
            v_open_tournament_id,
            'a1000000-0000-4000-8000-000000000066',
            'available',
            'Scout',
            'Available free agent with no requests.'
        ),
        (
            v_open_tournament_id,
            'a1000000-0000-4000-8000-000000000067',
            'withdrawn',
            'Support',
            'Withdrawn fixture entry.'
        );

    insert into public.tournament_free_agent_requests (
        tournament_id, team_id, user_id, status
    ) values (
        v_open_tournament_id,
        'a2000000-0000-4000-8000-000000000009',
        'a1000000-0000-4000-8000-000000000065',
        'pending'
    );

    insert into public.team_join_requests (team_id, user_id, status)
    values (
        'a2000000-0000-4000-8000-000000000009',
        'a1000000-0000-4000-8000-000000000068',
        'pending'
    );

    -- Live standard snake bracket: 1v8, 2v7, 3v6, and 4v5.
    insert into public.tournament_matches (
        id, tournament_id, round, match_number, team_a_id, team_b_id,
        score_a, score_b, winner_team_id, status, completed_at, best_of,
        scheduled_at, stream_url, notes
    ) values
        ('a4000000-0000-4000-8000-000000000001', v_live_tournament_id, 1, 1, 'a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000008', 3, 1, 'a2000000-0000-4000-8000-000000000001', 'completed', now() - interval '3 hours', 5, now() - interval '5 hours', 'https://example.com/vod/live-quarterfinal-1', 'Completed quarterfinal with full game details.'),
        ('a4000000-0000-4000-8000-000000000002', v_live_tournament_id, 1, 2, 'a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000007', 1, 1, null, 'pending', null, 5, now() + interval '2 hours', 'https://example.com/live/test-stream', 'Series currently tied.'),
        ('a4000000-0000-4000-8000-000000000003', v_live_tournament_id, 1, 3, 'a2000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000006', 0, 0, null, 'pending', null, 5, now() + interval '5 hours', null, null),
        ('a4000000-0000-4000-8000-000000000004', v_live_tournament_id, 1, 4, 'a2000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000005', 0, 0, null, 'pending', null, 5, now() + interval '8 hours', null, null),
        ('a4000000-0000-4000-8000-000000000005', v_live_tournament_id, 2, 1, 'a2000000-0000-4000-8000-000000000001', null, 0, 0, null, 'pending', null, 5, now() + interval '1 day', null, 'Awaiting the 2v7 winner.'),
        ('a4000000-0000-4000-8000-000000000006', v_live_tournament_id, 2, 2, null, null, 0, 0, null, 'pending', null, 5, now() + interval '1 day', null, null),
        ('a4000000-0000-4000-8000-000000000007', v_live_tournament_id, 3, 1, null, null, 0, 0, null, 'pending', null, 7, now() + interval '2 days', null, 'Best-of-seven final.');

    insert into public.tournament_match_games (
        id, match_id, game_number, map_id, map_picked_by_team_id,
        winner_team_id, vod_url, notes
    ) values
        ('a5000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 1, 'divide', 'a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'https://example.com/vod/live-qf1-game1', 'Opening game.'),
        ('a5000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000001', 2, 'dunes', 'a2000000-0000-4000-8000-000000000008', 'a2000000-0000-4000-8000-000000000008', 'https://example.com/vod/live-qf1-game2', 'Team 8 ties the series.'),
        ('a5000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000001', 3, 'fields', 'a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'https://example.com/vod/live-qf1-game3', null),
        ('a5000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000001', 4, 'ravine', 'a2000000-0000-4000-8000-000000000008', 'a2000000-0000-4000-8000-000000000001', 'https://example.com/vod/live-qf1-game4', 'Team 1 closes the series 3-1.'),
        ('a5000000-0000-4000-8000-000000000005', 'a4000000-0000-4000-8000-000000000002', 1, 'scorch', 'a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', null, null),
        ('a5000000-0000-4000-8000-000000000006', 'a4000000-0000-4000-8000-000000000002', 2, 'wind-valley', 'a2000000-0000-4000-8000-000000000007', 'a2000000-0000-4000-8000-000000000007', null, 'Series tied 1-1.');

    -- Completed four-team bracket with a best-of-seven final.
    insert into public.tournament_matches (
        id, tournament_id, round, match_number, team_a_id, team_b_id,
        score_a, score_b, winner_team_id, status, completed_at, best_of,
        scheduled_at, notes
    ) values
        ('a4100000-0000-4000-8000-000000000001', v_complete_tournament_id, 1, 1, 'a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000004', 3, 0, 'a2000000-0000-4000-8000-000000000001', 'completed', now() - interval '29 days', 5, now() - interval '29 days 3 hours', 'Semifinal 1.'),
        ('a4100000-0000-4000-8000-000000000002', v_complete_tournament_id, 1, 2, 'a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000003', 3, 2, 'a2000000-0000-4000-8000-000000000002', 'completed', now() - interval '29 days', 5, now() - interval '29 days 3 hours', 'Semifinal 2.'),
        ('a4100000-0000-4000-8000-000000000003', v_complete_tournament_id, 2, 1, 'a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 4, 2, 'a2000000-0000-4000-8000-000000000001', 'completed', now() - interval '28 days', 7, now() - interval '28 days 4 hours', 'Best-of-seven championship final.');

    insert into public.tournament_match_games (
        id, match_id, game_number, map_id, map_picked_by_team_id,
        winner_team_id, vod_url, notes
    ) values
        ('a5100000-0000-4000-8000-000000000001', 'a4100000-0000-4000-8000-000000000003', 1, 'divide', 'a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'https://example.com/vod/final-game1', null),
        ('a5100000-0000-4000-8000-000000000002', 'a4100000-0000-4000-8000-000000000003', 2, 'dunes', 'a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 'https://example.com/vod/final-game2', null),
        ('a5100000-0000-4000-8000-000000000003', 'a4100000-0000-4000-8000-000000000003', 3, 'fields', 'a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'https://example.com/vod/final-game3', null),
        ('a5100000-0000-4000-8000-000000000004', 'a4100000-0000-4000-8000-000000000003', 4, 'ravine', 'a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'https://example.com/vod/final-game4', null),
        ('a5100000-0000-4000-8000-000000000005', 'a4100000-0000-4000-8000-000000000003', 5, 'scorch', 'a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'https://example.com/vod/final-game5', null),
        ('a5100000-0000-4000-8000-000000000006', 'a4100000-0000-4000-8000-000000000003', 6, 'wind-valley', 'a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'https://example.com/vod/final-game6', 'Team 1 wins the championship 4-2.');

    insert into public.builds (
        id, user_id, slug, title, vehicle_id, selection, is_public
    ) values
        ('a6000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'aggro-test-build-alpha', 'Fixture Alecto: Alpha', 'blink', '{"vehicleId":"blink","ammoIds":["standard","standard","standard"],"previewAmmoSlot":0,"componentIds":["","",""],"talentPoints":{}}', true),
        ('a6000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000064', 'aggro-test-build-bravo', 'Fixture Alecto: Bravo', 'blink', '{"vehicleId":"blink","ammoIds":["standard","standard","standard"],"previewAmmoSlot":0,"componentIds":["","",""],"talentPoints":{}}', true),
        ('a6000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000009', 'aggro-test-build-charlie', 'Fixture Alecto: Charlie', 'blink', '{"vehicleId":"blink","ammoIds":["standard","standard","standard"],"previewAmmoSlot":0,"componentIds":["","",""],"talentPoints":{}}', true);

    insert into public.tournament_build_submissions (
        id, tournament_id, user_id, build_id, build_slug_snapshot,
        build_title_snapshot, vehicle_id, build_snapshot, visibility
    ) values
        ('a7000000-0000-4000-8000-000000000001', v_live_tournament_id, 'a1000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'aggro-test-build-alpha', 'Fixture Alecto: Alpha', 'blink', '{"vehicleId":"blink","ammoIds":["standard","standard","standard"],"previewAmmoSlot":0,"componentIds":["","",""],"talentPoints":{}}', 'immediate'),
        ('a7000000-0000-4000-8000-000000000002', v_live_tournament_id, 'a1000000-0000-4000-8000-000000000064', 'a6000000-0000-4000-8000-000000000002', 'aggro-test-build-bravo', 'Fixture Alecto: Bravo', 'blink', '{"vehicleId":"blink","ammoIds":["standard","standard","standard"],"previewAmmoSlot":0,"componentIds":["","",""],"talentPoints":{}}', 'after_match'),
        ('a7000000-0000-4000-8000-000000000003', v_complete_tournament_id, 'a1000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'aggro-test-build-alpha', 'Fixture Alecto: Alpha', 'blink', '{"vehicleId":"blink","ammoIds":["standard","standard","standard"],"previewAmmoSlot":0,"componentIds":["","",""],"talentPoints":{}}', 'immediate'),
        ('a7000000-0000-4000-8000-000000000004', v_complete_tournament_id, 'a1000000-0000-4000-8000-000000000009', 'a6000000-0000-4000-8000-000000000003', 'aggro-test-build-charlie', 'Fixture Alecto: Charlie', 'blink', '{"vehicleId":"blink","ammoIds":["standard","standard","standard"],"previewAmmoSlot":0,"componentIds":["","",""],"talentPoints":{}}', 'after_tournament');

    insert into public.tournament_game_lineups (
        game_id, team_id, user_id, vehicle_id, build_submission_id, submitted_by
    ) values
        ('a5000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'blink', 'a7000000-0000-4000-8000-000000000001', v_organizer_id),
        ('a5000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000064', 'blink', 'a7000000-0000-4000-8000-000000000002', v_organizer_id),
        ('a5000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'brawler', null, v_organizer_id),
        ('a5000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000064', 'canopener', null, v_organizer_id),
        ('a5000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000009', 'blink', null, v_organizer_id),
        ('a5000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000049', 'sonar', null, v_organizer_id),
        ('a5100000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'blink', 'a7000000-0000-4000-8000-000000000003', v_organizer_id),
        ('a5100000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000009', 'blink', 'a7000000-0000-4000-8000-000000000004', v_organizer_id),
        ('a5100000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'brawler', null, v_organizer_id),
        ('a5100000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000009', 'canopener', null, v_organizer_id);
end
$fixture$;

commit;

-- Verification result sets shown by the Supabase SQL editor.
select
    tournaments.slug,
    tournaments.name,
    tournaments.status,
    tournaments.starts_at,
    count(distinct registrations.team_id) as registered_teams,
    count(distinct matches.id) as bracket_matches
from public.tournaments tournaments
left join public.tournament_registrations registrations
    on registrations.tournament_id = tournaments.id
left join public.tournament_matches matches
    on matches.tournament_id = tournaments.id
where tournaments.slug in ('aggro-test-open', 'aggro-test-live', 'aggro-test-complete')
group by tournaments.id
order by tournaments.starts_at desc;

select
    (select count(*) from public.teams where slug like 'aggro-test-%') as test_teams,
    (select count(*) from auth.users where email like 'aggro.tournament.player.%@example.invalid') as test_users,
    (
        select count(*) from public.tournament_match_games
        where id::text like 'a5000000-%' or id::text like 'a5100000-%'
    ) as recorded_games,
    (
        select count(*) from public.tournament_build_submissions
        where id::text like 'a7000000-%'
    ) as submitted_builds;
