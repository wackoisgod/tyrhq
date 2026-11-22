-- Account merge function for consolidating duplicate accounts
-- Allows users to merge a secondary account into their primary account
-- after proving ownership of both accounts via authentication

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
    v_contributions_moved integer := 0;
    v_tank_notes_moved integer := 0;
    v_api_creds_moved integer := 0;
    v_team_members_moved integer := 0;
    v_team_join_requests_moved integer := 0;
    v_tournament_registrations_moved integer := 0;
    v_tournament_free_agents_moved integer := 0;
    v_tournament_free_agent_requests_moved integer := 0;
    v_tournament_roster_members_moved integer := 0;
    v_tournament_build_submissions_moved integer := 0;
    v_tournament_team_recruitment_moved integer := 0;
    v_community_events_moved integer := 0;
    v_secondary_steam_id text;
    v_secondary_steam_name text;
    v_secondary_steam_verified_at timestamptz;
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
    
    -- Get Steam data from secondary profile (if any)
    SELECT verified_steam_id, steam_display_name, steam_verified_at, display_name
    INTO v_secondary_steam_id, v_secondary_steam_name, v_secondary_steam_verified_at, v_secondary_display_name
    FROM public.profiles
    WHERE id = p_secondary_user_id;
    
    -- Get primary display name to check if it's an auto-generated fallback
    SELECT display_name
    INTO v_primary_display_name
    FROM public.profiles
    WHERE id = p_primary_user_id;
    
    -- If primary has auto-generated Player_###### name and secondary has real name, use secondary's
    IF v_primary_display_name ~ '^Player_\d{6}$' AND 
       v_secondary_display_name IS NOT NULL AND 
       v_secondary_display_name != '' AND
       NOT (v_secondary_display_name ~ '^Player_\d{6}$') THEN
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
    
    -- 5. Move contributions (article authorship set null on delete, keep as is)
    UPDATE public.article_submissions
    SET author_user_id = p_primary_user_id
    WHERE author_user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_contributions_moved = ROW_COUNT;
    
    -- 6. Move tank and build notes
    UPDATE public.reviewer_notes
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
    
    -- 8. Move team memberships (handle duplicates - can't be on same team twice)
    DELETE FROM public.team_members tm
    WHERE tm.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.team_members
        WHERE user_id = p_primary_user_id
        AND team_id = tm.team_id
    );
    
    UPDATE public.team_members
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_team_members_moved = ROW_COUNT;
    
    -- 9. Move team join requests (handle duplicates)
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
    
    -- 10. Move tournament registrations (handle duplicates)
    DELETE FROM public.tournament_registrations tr
    WHERE tr.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.tournament_registrations
        WHERE user_id = p_primary_user_id
        AND tournament_id = tr.tournament_id
    );
    
    UPDATE public.tournament_registrations
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_tournament_registrations_moved = ROW_COUNT;
    
    -- 11. Move tournament free agent listings (handle duplicates)
    DELETE FROM public.tournament_free_agents tfa
    WHERE tfa.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.tournament_free_agents
        WHERE user_id = p_primary_user_id
        AND tournament_id = tfa.tournament_id
    );
    
    UPDATE public.tournament_free_agents
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_tournament_free_agents_moved = ROW_COUNT;
    
    -- 12. Move free agent requests (handle duplicates)
    DELETE FROM public.tournament_free_agent_requests tfar
    WHERE tfar.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.tournament_free_agent_requests
        WHERE user_id = p_primary_user_id
        AND tournament_free_agent_id = tfar.tournament_free_agent_id
    );
    
    UPDATE public.tournament_free_agent_requests
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_tournament_free_agent_requests_moved = ROW_COUNT;
    
    -- 13. Move tournament roster members (handle duplicates)
    DELETE FROM public.tournament_roster_members trm
    WHERE trm.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.tournament_roster_members
        WHERE user_id = p_primary_user_id
        AND tournament_registration_id = trm.tournament_registration_id
    );
    
    UPDATE public.tournament_roster_members
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_tournament_roster_members_moved = ROW_COUNT;
    
    -- 14. Move tournament build submissions (handle duplicates)
    DELETE FROM public.tournament_build_submissions tbs
    WHERE tbs.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.tournament_build_submissions
        WHERE user_id = p_primary_user_id
        AND tournament_registration_id = tbs.tournament_registration_id
    );
    
    UPDATE public.tournament_build_submissions
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_tournament_build_submissions_moved = ROW_COUNT;
    
    -- 15. Move tournament team recruitment posts (handle duplicates)
    DELETE FROM public.tournament_team_recruitment ttr
    WHERE ttr.user_id = p_secondary_user_id
    AND EXISTS (
        SELECT 1 FROM public.tournament_team_recruitment
        WHERE user_id = p_primary_user_id
        AND tournament_registration_id = ttr.tournament_registration_id
    );
    
    UPDATE public.tournament_team_recruitment
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_tournament_team_recruitment_moved = ROW_COUNT;
    
    -- 16. Move community events
    UPDATE public.community_events
    SET user_id = p_primary_user_id
    WHERE user_id = p_secondary_user_id;
    
    GET DIAGNOSTICS v_community_events_moved = ROW_COUNT;
    
    -- 17. Move Steam verification to primary (if secondary has it)
    IF v_secondary_steam_id IS NOT NULL THEN
        -- Clear Steam data from primary first (in case it has different Steam ID)
        UPDATE public.profiles
        SET verified_steam_id = NULL,
            steam_display_name = NULL,
            steam_verified_at = NULL
        WHERE id = p_primary_user_id;
        
        -- Move Steam data to primary
        UPDATE public.profiles
        SET verified_steam_id = v_secondary_steam_id,
            steam_display_name = v_secondary_steam_name,
            steam_verified_at = v_secondary_steam_verified_at
        WHERE id = p_primary_user_id;
    END IF;
    
    -- 18. Update display name if keeping secondary's
    IF v_keep_secondary_display_name THEN
        UPDATE public.profiles
        SET display_name = v_secondary_display_name
        WHERE id = p_primary_user_id;
    END IF;
    
    -- 19. Delete secondary profile (cascade will handle profile references)
    DELETE FROM public.profiles
    WHERE id = p_secondary_user_id;
    
    -- 20. Delete secondary auth user
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
            'contributions', v_contributions_moved,
            'tank_notes', v_tank_notes_moved,
            'api_credentials', v_api_creds_moved,
            'team_members', v_team_members_moved,
            'team_join_requests', v_team_join_requests_moved,
            'tournament_registrations', v_tournament_registrations_moved,
            'tournament_free_agents', v_tournament_free_agents_moved,
            'tournament_free_agent_requests', v_tournament_free_agent_requests_moved,
            'tournament_roster_members', v_tournament_roster_members_moved,
            'tournament_build_submissions', v_tournament_build_submissions_moved,
            'tournament_team_recruitment', v_tournament_team_recruitment_moved,
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
