-- Steam Identity Synchronization
-- Keeps profiles.verified_steam_id in sync with auth.identities when Steam is used as OIDC provider
-- Part of TYR-19: Steam as real Supabase auth provider

-- Function to sync verified_steam_id when Steam identity is added/updated
-- Handles Supabase custom provider identifier 'custom:steam'
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
    -- Only process Steam identities (custom:steam)
    IF NEW.provider = 'custom:steam' THEN
        -- Extract Steam ID from identity
        -- For OIDC custom providers, Supabase may store it as provider_id or in identity_data->>'sub'
        -- Format: steam:<steamid64>
        v_steam_id := regexp_replace(
            COALESCE(NEW.provider_id, NEW.identity_data->>'sub', ''),
            '^steam:',
            ''
        );
        
        -- Extract persona name from identity
        v_persona_name := NEW.identity_data->>'name';
        
        -- Update profile with Steam ID and persona name
        -- Use INSERT ... ON CONFLICT to avoid unique violation blocking sign-in
        IF v_steam_id != '' THEN
            BEGIN
                UPDATE public.profiles
                SET verified_steam_id = v_steam_id,
                    steam_verified_at = now(),
                    steam_display_name = v_persona_name
                WHERE id = NEW.user_id;
            EXCEPTION WHEN unique_violation THEN
                -- Another user already has this Steam ID
                -- Don't block the identity insert, just log a warning
                RAISE WARNING 'Steam ID % already linked to another account', v_steam_id;
            END;
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
    WHEN (NEW.provider = 'custom:steam')
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
    -- Only process Steam identities (custom:steam)
    IF OLD.provider = 'custom:steam' THEN
        -- Extract Steam ID from deleted identity
        v_steam_id := regexp_replace(
            COALESCE(OLD.provider_id, OLD.identity_data->>'sub', ''),
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
    WHEN (OLD.provider = 'custom:steam')
    EXECUTE FUNCTION public.cleanup_steam_identity();

-- Migration note: No data migration needed
-- Only Andrew's test account has Steam, and he will re-link after this is deployed
-- The trigger will automatically populate verified_steam_id on first Steam OIDC sign-in
