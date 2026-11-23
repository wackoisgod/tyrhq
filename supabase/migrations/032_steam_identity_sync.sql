-- Steam Identity Synchronization
-- Keeps profiles.verified_steam_id in sync with auth.identities when Steam is used as OIDC provider
-- Part of TYR-19: Steam as real Supabase auth provider

-- Function to sync verified_steam_id when Steam identity is added/updated
CREATE OR REPLACE FUNCTION public.sync_steam_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_steam_id text;
    v_persona_name text;
BEGIN
    -- Only process Steam identities
    IF NEW.provider = 'steam' THEN
        -- Extract Steam ID from identity subject (format: steam:<steamid64>)
        v_steam_id := regexp_replace(
            COALESCE(NEW.identity_data->>'sub', ''),
            '^steam:',
            ''
        );
        
        -- Extract persona name from identity
        v_persona_name := NEW.identity_data->>'name';
        
        -- Update profile with Steam ID and persona name
        IF v_steam_id != '' THEN
            UPDATE public.profiles
            SET verified_steam_id = v_steam_id,
                steam_verified_at = now(),
                steam_display_name = v_persona_name
            WHERE id = NEW.user_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

-- Trigger on identity insert/update
DROP TRIGGER IF EXISTS on_steam_identity_change ON auth.identities;
CREATE TRIGGER on_steam_identity_change
    AFTER INSERT OR UPDATE ON auth.identities
    FOR EACH ROW
    WHEN (NEW.provider = 'steam')
    EXECUTE FUNCTION public.sync_steam_identity();

-- Function to cleanup verified_steam_id when Steam identity is removed
CREATE OR REPLACE FUNCTION public.cleanup_steam_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_steam_id text;
BEGIN
    -- Only process Steam identities
    IF OLD.provider = 'steam' THEN
        -- Extract Steam ID from deleted identity
        v_steam_id := regexp_replace(
            COALESCE(OLD.identity_data->>'sub', ''),
            '^steam:',
            ''
        );
        
        -- Clear verified_steam_id if it matches the deleted identity
        IF v_steam_id != '' THEN
            UPDATE public.profiles
            SET verified_steam_id = NULL,
                steam_verified_at = NULL
            WHERE id = OLD.user_id
            AND verified_steam_id = v_steam_id;
        END IF;
    END IF;
    
    RETURN OLD;
END;
$$;

-- Trigger on identity delete
DROP TRIGGER IF EXISTS on_steam_identity_delete ON auth.identities;
CREATE TRIGGER on_steam_identity_delete
    AFTER DELETE ON auth.identities
    FOR EACH ROW
    WHEN (OLD.provider = 'steam')
    EXECUTE FUNCTION public.cleanup_steam_identity();

-- Migration note: No data migration needed
-- Only Andrew's test account has Steam, and he will re-link after this is deployed
-- The trigger will automatically populate verified_steam_id on first Steam OIDC sign-in
