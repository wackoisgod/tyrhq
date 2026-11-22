-- Account merge function for consolidating duplicate accounts
-- Allows users to merge a secondary account into their primary account
-- after proving ownership of both accounts via authentication

-- Table for tracking used merge nonces (prevents replay attacks)
CREATE TABLE IF NOT EXISTS public.merge_nonces (
    nonce text PRIMARY KEY,
    used_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-cleanup old nonces after 1 hour
CREATE INDEX IF NOT EXISTS idx_merge_nonces_used_at
    ON public.merge_nonces (used_at);

-- Only service_role can access this table
ALTER TABLE public.merge_nonces ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.merge_nonces FROM public, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.merge_nonces TO service_role;

-- Function to merge secondary account into primary account
-- This moves all data ownership from secondary to primary and removes secondary
CREATE OR REPLACE FUNCTION public.merge_accounts(
    p_primary_user_id uuid,
    p_secondary_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result jsonb := '{}';
    v_builds_moved integer := 0;
    v_build_stars_moved integer := 0;
    v_article_stars_moved integer := 0;
    v_map_rooms_moved integer := 0;
    v_article_submissions_moved integer := 0;
    v_tank_notes_moved integer := 0;
    v_api_creds_moved integer := 0;
    v_api_logs_moved integer := 0;
    v_articles_moved integer := 0;
    v_article_revisions_moved integer := 0;
    v_submission_events_moved integer := 0;
    v_article_uploads_moved integer := 0;
    v_team_members_moved integer := 0;
    v_team_join_requests_moved integer := 0;
    v_teams_recaptained integer := 0;
    v_tournament_registrations_moved integer := 0;
    v_tournament_free_agents_moved integer := 0;
    v_tournament_free_agent_requests_moved integer := 0;
    v_tournament_roster_members_moved integer := 0;
    v_tournament_build_submissions_moved integer := 0;
    v_tournament_game_lineups_moved integer := 0;
    v_community_events_moved integer := 0;
    v_tournaments_repointed integer := 0;
    v_replay_uploads_moved integer := 0;
    v_team_id uuid;
    v_rc integer;
    v_secondary_steam_id text;
    v_secondary_steam_name text;
    v_secondary_steam_verified_at timestamptz;
    v_primary_steam_id text;
    v_secondary_display_name text;
    v_primary_display_name text;
    v_keep_secondary_display_name boolean := false;
BEGIN
    -- Validate inputs
    IF p_primary_user_id IS NULL OR p_secondary_user_id IS NULL THEN
        RAISE EXCEPTION 'Both primary and secondary user IDs must be provided';
    END IF;
    
    IF p_primary_user_id = p_secondary_user_id THEN
        RAISE EXCEPTION 'Cannot merge an account into itself';
    END IF;
    
    -- Verify both users exist
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_primary_user_id) THEN
        RAISE EXCEPTION 'Primary user does not exist';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_secondary_user_id) THEN
        RAISE EXCEPTION 'Secondary user does not exist';
    END IF;
    
    -- Get Steam data from both profiles
    SELECT verified_steam_id, steam_display_name, steam_verified_at, display_name
    INTO v_secondary_steam_id, v_secondary_steam_name, v_secondary_steam_verified_at, v_secondary_display_name
    FROM public.profiles
    WHERE id = p_secondary_user_id;
    
    SELECT verified_steam_id, display_name
    INTO v_primary_steam_id, v_primary_display_name
    FROM public.profiles
    WHERE id = p_primary_user_id;
    
    -- If both have different non-null Steam IDs, fail
    IF v_primary_steam_id IS NOT NULL AND v_secondary_steam_id IS NOT NULL AND v_primary_steam_id != v_secondary_steam_id THEN
        RAISE EXCEPTION 'Both accounts have different Steam IDs. Cannot merge accounts with conflicting Steam identities.';
    END IF;
    
    -- If primary has empty or auto-generated Player_###### name and secondary has real name, use secondary's
    IF (v_primary_display_name IS NULL OR v_primary_display_name = '' OR v_primary_display_name ~ '^Player_\d+$') AND 
       v_secondary_display_name IS NOT NULL AND 
       v_secondary_display_name != '' AND
       NOT (v_secondary_display_name ~ '^Player_\d+$') THEN
        v_keep_secondary_display_name := true;
    END IF;
    
    -- Begin merge transaction
    -- All moves must succeed or entire operation rolls back
    
    -- 1. Move builds (cascade will handle build_stars via ON DELETE CASCADE)
    UPDATE public.builds
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_builds_moved = ROW_COUNT;
    
    -- 2. Move build stars (handle duplicates)
    -- Delete stars where primary already starred same build
    DELETE FROM public.build_stars bs
    WHERE bs.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.build_stars
        WHERE user_id = p_primary_user_id
        AND build_id = bs.build_id
    );
    
    -- Move remaining stars
    UPDATE public.build_stars
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_build_stars_moved = ROW_COUNT;
    
    -- 3. Move article stars (handle duplicates)
    DELETE FROM public.article_stars ast
    WHERE ast.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.article_stars
        WHERE user_id = p_primary_user_id
        AND article_id = ast.article_id
    );
    
    UPDATE public.article_stars
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_article_stars_moved = ROW_COUNT;
    
    -- 4. Move map rooms
    UPDATE public.map_rooms
    SET host_user_id = p_primary_user_id
    WHERE host_user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_map_rooms_moved = ROW_COUNT;
    
    -- 5. Move article submissions (contributions)
    UPDATE public.article_submissions
    SET submitter_id = p_primary_user_id
    WHERE submitter_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_article_submissions_moved = ROW_COUNT;
    
    -- Also update reviewer_id references
    UPDATE public.article_submissions
    SET reviewer_id = p_primary_user_id
    WHERE reviewer_id = p_secondary_user_id;
    
    -- 6. Move tank and build notes (handle composite PK duplicates)
    DELETE FROM public.tank_notes tn
    WHERE tn.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.tank_notes
        WHERE user_id = p_primary_user_id
        AND vehicle_id = tn.vehicle_id
    );
    
    UPDATE public.tank_notes
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_tank_notes_moved = ROW_COUNT;
    
    -- 7. Move API credentials (handle unique constraint on user_id)
    -- If primary already has API creds, delete secondary's
    -- Otherwise, move secondary's to primary
    IF EXISTS (SELECT 1 FROM public.api_credentials WHERE user_id = p_primary_user_id) THEN
        DELETE FROM public.api_credentials WHERE user_id = p_secondary_user_id;
    ELSE
        UPDATE public.api_credentials
        SET user_id = p_primary_user_id
        WHERE user_id = p_secondary_user_id;
        
        GET DIAGNOSTICS v_api_creds_moved = ROW_COUNT;
    END IF;
    
    -- 8. Move API request logs
    UPDATE public.api_request_logs
    SET credential_user_id = p_primary_user_id
    WHERE credential_user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_api_logs_moved = ROW_COUNT;
    
    -- 9. Move articles (authorship)
    UPDATE public.articles
    SET author_user_id = p_primary_user_id
    WHERE author_user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_articles_moved = ROW_COUNT;
    
    -- 10. Move article revisions
    UPDATE public.article_revisions
    SET created_by = p_primary_user_id
    WHERE created_by = p_secondary_user_id;
    
    GET DIAGNOSTICS v_article_revisions_moved = ROW_COUNT;
    
    -- 11. Move submission events
    UPDATE public.submission_events
    SET actor_id = p_primary_user_id
    WHERE actor_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_submission_events_moved = ROW_COUNT;
    
    -- 12. Move article uploads
    UPDATE public.article_uploads
    SET uploaded_by = p_primary_user_id
    WHERE uploaded_by = p_secondary_user_id;
    
    GET DIAGNOSTICS v_article_uploads_moved = ROW_COUNT;
    
    -- 13. Move team memberships (handle duplicates and captain role)
    -- If secondary was captain of a team, check if primary is also on that team
    FOR v_team_id IN 
        SELECT team_id FROM public.team_members 
        WHERE user_id = p_secondary_user_id AND role = 'captain'
    LOOP
        IF EXISTS (SELECT 1 FROM public.team_members WHERE team_id = v_team_id AND user_id = p_primary_user_id) THEN
            -- Primary already on team - delete secondary first to avoid unique constraint, then promote primary
            DELETE FROM public.team_members
            WHERE team_id = v_team_id AND user_id = p_secondary_user_id;
            
            GET DIAGNOSTICS v_rc = ROW_COUNT;
            v_teams_recaptained := v_teams_recaptained + v_rc;
            
            UPDATE public.team_members
            SET role = 'captain'
            WHERE team_id = v_team_id AND user_id = p_primary_user_id;
        ELSE
            -- Primary not on team - just move secondary's membership
            UPDATE public.team_members
            SET user_id = p_primary_user_id
            WHERE team_id = v_team_id AND user_id = p_secondary_user_id;
        END IF;
    END LOOP;
    
    -- Delete duplicate non-captain memberships
    DELETE FROM public.team_members tm
    WHERE tm.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.team_members
        WHERE user_id = p_primary_user_id
        AND team_id = tm.team_id
    );
    
    -- Move remaining memberships
    UPDATE public.team_members
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_team_members_moved = ROW_COUNT;
    
    -- 14. Update teams.captain_id references
    UPDATE public.teams
    SET captain_id = p_primary_user_id
    WHERE captain_id = p_secondary_user_id;
    
    -- 15. Move team join requests (handle duplicates)
    DELETE FROM public.team_join_requests tjr
    WHERE tjr.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.team_join_requests
        WHERE user_id = p_primary_user_id
        AND team_id = tjr.team_id
    );
    
    UPDATE public.team_join_requests
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_team_join_requests_moved = ROW_COUNT;
    
    -- Also update reviewed_by references
    UPDATE public.team_join_requests
    SET reviewed_by = p_primary_user_id
    WHERE reviewed_by = p_secondary_user_id;
    
    -- 16. Move tournament registrations (registered_by is nullable, just re-point)
    UPDATE public.tournament_registrations
    SET registered_by = p_primary_user_id
    WHERE registered_by = p_secondary_user_id;
    
    GET DIAGNOSTICS v_tournament_registrations_moved = ROW_COUNT;
    
    -- 17. Update tournaments.organizer_id references
    UPDATE public.tournaments
    SET organizer_id = p_primary_user_id
    WHERE organizer_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_tournaments_repointed = ROW_COUNT;
    
    -- 18. Move tournament free agent listings and requests (handle FK constraint)
    -- FK: tournament_free_agent_requests(tournament_id, user_id) -> tournament_free_agents(tournament_id, user_id)
    
    -- First, insert primary parent rows for any secondary's requests that primary doesn't have
    INSERT INTO public.tournament_free_agents (tournament_id, user_id, status, preferred_role, note, registered_at, updated_at)
    SELECT DISTINCT tfa.tournament_id, p_primary_user_id, tfa.status, tfa.preferred_role, tfa.note, tfa.registered_at, tfa.updated_at
    FROM public.tournament_free_agents tfa
    WHERE tfa.user_id = p_secondary_user_id
    ON CONFLICT (tournament_id, user_id) DO NOTHING;
    
    -- Delete duplicate requests (primary already has request for same tournament+team)
    DELETE FROM public.tournament_free_agent_requests tfar
    WHERE tfar.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.tournament_free_agent_requests
        WHERE user_id = p_primary_user_id
        AND tournament_id = tfar.tournament_id
        AND team_id = tfar.team_id
    );
    
    -- Re-point requests to primary
    UPDATE public.tournament_free_agent_requests
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_tournament_free_agent_requests_moved = ROW_COUNT;
    
    -- Also update reviewed_by references
    UPDATE public.tournament_free_agent_requests
    SET reviewed_by = p_primary_user_id
    WHERE reviewed_by = p_secondary_user_id;
    
    -- Delete secondary's free agent parent rows that weren't needed
    DELETE FROM public.tournament_free_agents tfa
    WHERE tfa.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.tournament_free_agents
        WHERE user_id = p_primary_user_id
        AND tournament_id = tfa.tournament_id
    );
    
    -- Move remaining free agent listings
    UPDATE public.tournament_free_agents
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_tournament_free_agents_moved = ROW_COUNT;
    
    -- 20. Move tournament roster members and build submissions (handle FK constraint)
    -- FK: tournament_build_submissions(tournament_id, user_id) -> tournament_roster_members(tournament_id, user_id)
    -- Unique: tournament_roster_members(tournament_id, user_id)
    
    -- Handle cross-team roster conflicts: if secondary on different team than primary in same tournament,
    -- drop secondary's roster + its submissions to maintain data integrity
    DELETE FROM public.tournament_build_submissions tbs
    WHERE tbs.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.tournament_roster_members trm1
        WHERE trm1.user_id = p_secondary_user_id
        AND trm1.tournament_id = tbs.tournament_id
        AND EXISTS (
            SELECT 1 FROM public.tournament_roster_members trm2
            WHERE trm2.user_id = p_primary_user_id
            AND trm2.tournament_id = trm1.tournament_id
            AND trm2.team_id != trm1.team_id  -- Different teams in same tournament
        )
    );
    
    DELETE FROM public.tournament_roster_members trm
    WHERE trm.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.tournament_roster_members
        WHERE user_id = p_primary_user_id
        AND tournament_id = trm.tournament_id
        AND team_id != trm.team_id  -- Different teams
    );
    
    -- Insert primary roster rows for secondary's submissions that primary doesn't have
    INSERT INTO public.tournament_roster_members (tournament_id, team_id, user_id, source, joined_at)
    SELECT DISTINCT trm.tournament_id, trm.team_id, p_primary_user_id, trm.source, trm.joined_at
    FROM public.tournament_roster_members trm
    WHERE trm.user_id = p_secondary_user_id
    ON CONFLICT (tournament_id, user_id) DO NOTHING;
    
    -- Delete duplicate submissions (primary already has same build for tournament)
    DELETE FROM public.tournament_build_submissions tbs
    WHERE tbs.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.tournament_build_submissions
        WHERE user_id = p_primary_user_id
        AND tournament_id = tbs.tournament_id
        AND build_id = tbs.build_id
    );
    
    -- Re-point build submissions to primary
    UPDATE public.tournament_build_submissions
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_tournament_build_submissions_moved = ROW_COUNT;
    
    -- Delete secondary's roster rows that weren't needed (same tournament as primary)
    DELETE FROM public.tournament_roster_members trm
    WHERE trm.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.tournament_roster_members
        WHERE user_id = p_primary_user_id
        AND tournament_id = trm.tournament_id
    );
    
    -- Move remaining roster members
    UPDATE public.tournament_roster_members
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_tournament_roster_members_moved = ROW_COUNT;
    
    -- 22. Move tournament game lineups (PK is game_id, user_id)
    DELETE FROM public.tournament_game_lineups tgl
    WHERE tgl.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.tournament_game_lineups
        WHERE user_id = p_primary_user_id
        AND game_id = tgl.game_id
    );
    
    UPDATE public.tournament_game_lineups
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_tournament_game_lineups_moved = ROW_COUNT;
    
    -- Also update submitted_by references
    UPDATE public.tournament_game_lineups
    SET submitted_by = p_primary_user_id
    WHERE submitted_by = p_secondary_user_id;
    
    -- 23. Update replay_uploaded_by references
    UPDATE public.tournament_match_games
    SET replay_uploaded_by = p_primary_user_id
    WHERE replay_uploaded_by = p_secondary_user_id;
    
    GET DIAGNOSTICS v_replay_uploads_moved = ROW_COUNT;
    
    -- 24. Move community events
    UPDATE public.community_events
    SET submitter_id = p_primary_user_id
    WHERE submitter_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_community_events_moved = ROW_COUNT;
    
    -- Also update decided_by references
    UPDATE public.community_events
    SET decided_by = p_primary_user_id
    WHERE decided_by = p_secondary_user_id;
    
    -- 25. Move Steam verification to primary (if secondary has it and primary doesn't, or they match)
    IF v_secondary_steam_id IS NOT NULL AND (v_primary_steam_id IS NULL OR v_primary_steam_id = v_secondary_steam_id) THEN
        -- Clear secondary's Steam data first (handles unique constraint idx_profiles_verified_steam_id)
        UPDATE public.profiles
        SET verified_steam_id = NULL,
            steam_display_name = NULL,
            steam_verified_at = NULL
        WHERE id = p_secondary_user_id;
        
        -- Move Steam data to primary
        UPDATE public.profiles
        SET verified_steam_id = v_secondary_steam_id,
            steam_display_name = v_secondary_steam_name,
            steam_verified_at = v_secondary_steam_verified_at
        WHERE id = p_primary_user_id;
    END IF;
    
    -- 26. Update display name if keeping secondary's
    IF v_keep_secondary_display_name THEN
        UPDATE public.profiles
        SET display_name = v_secondary_display_name
        WHERE id = p_primary_user_id;
    END IF;
    
    -- 27. Delete secondary profile (cascade will handle profile references)
    DELETE FROM public.profiles
    WHERE id = p_secondary_user_id;
    
    -- 28. Delete secondary auth user
    -- Note: This must be done by application code using admin.deleteUser()
    -- as SQL functions cannot directly delete from auth.users
    
    -- Build result summary
    v_result := jsonb_build_object(
        'success', true,
        'primary_user_id', p_primary_user_id,
        'secondary_user_id', p_secondary_user_id,
        'steam_moved', v_secondary_steam_id IS NOT NULL,
        'display_name_updated', v_keep_secondary_display_name,
        'data_moved', jsonb_build_object(
            'builds', v_builds_moved,
            'build_stars', v_build_stars_moved,
            'article_stars', v_article_stars_moved,
            'map_rooms', v_map_rooms_moved,
            'article_submissions', v_article_submissions_moved,
            'tank_notes', v_tank_notes_moved,
            'api_credentials', v_api_creds_moved,
            'api_request_logs', v_api_logs_moved,
            'articles', v_articles_moved,
            'article_revisions', v_article_revisions_moved,
            'submission_events', v_submission_events_moved,
            'article_uploads', v_article_uploads_moved,
            'team_members', v_team_members_moved,
            'teams_recaptained', v_teams_recaptained,
            'team_join_requests', v_team_join_requests_moved,
            'tournament_registrations', v_tournament_registrations_moved,
            'tournaments_as_organizer', v_tournaments_repointed,
            'tournament_free_agents', v_tournament_free_agents_moved,
            'tournament_free_agent_requests', v_tournament_free_agent_requests_moved,
            'tournament_roster_members', v_tournament_roster_members_moved,
            'tournament_build_submissions', v_tournament_build_submissions_moved,
            'tournament_game_lineups', v_tournament_game_lineups_moved,
            'replay_uploads', v_replay_uploads_moved,
            'community_events', v_community_events_moved
        )
    );
    
    RETURN v_result;
END;
$$;

-- Revoke public access - only service_role can execute
REVOKE ALL ON FUNCTION public.merge_accounts(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_accounts(uuid, uuid) TO service_role;

-- Add documentation
COMMENT ON FUNCTION public.merge_accounts IS 'Merges a secondary user account into a primary account. Moves all data ownership and deletes secondary profile. Must be called with service_role. Application must delete secondary auth user separately using admin.deleteUser().';
COMMENT ON TABLE public.merge_nonces IS 'Tracks used merge nonces to prevent replay attacks. Nonces should be cleaned up after 1 hour.';
