-- Replay upload support for tournament matches
-- Stores extracted replay data and verified Steam accounts for player matching

-- Add verified Steam ID to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS verified_steam_id TEXT,
ADD COLUMN IF NOT EXISTS steam_display_name TEXT,
ADD COLUMN IF NOT EXISTS steam_verified_at TIMESTAMPTZ;

-- Create unique index on verified Steam ID (one profile per Steam account)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_verified_steam_id
ON public.profiles(verified_steam_id)
WHERE verified_steam_id IS NOT NULL;

-- SECURITY: Protect Steam ID columns from direct user modification
-- Only service_role can set these (via Steam callback server action)
CREATE OR REPLACE FUNCTION public.protect_verified_steam_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow service_role to change anything
  IF current_setting('role') = 'service_role' THEN
    RETURN NEW;
  END IF;
  
  -- Block changes to verified Steam columns for non-service roles
  IF TG_OP = 'UPDATE' THEN
    IF NEW.verified_steam_id IS DISTINCT FROM OLD.verified_steam_id
       OR NEW.steam_display_name IS DISTINCT FROM OLD.steam_display_name
       OR NEW.steam_verified_at IS DISTINCT FROM OLD.steam_verified_at THEN
      RAISE EXCEPTION 'verified_steam_id, steam_display_name, and steam_verified_at can only be modified by the server';
    END IF;
  END IF;
  
  IF TG_OP = 'INSERT' THEN
    IF NEW.verified_steam_id IS NOT NULL
       OR NEW.steam_display_name IS NOT NULL
       OR NEW.steam_verified_at IS NOT NULL THEN
      RAISE EXCEPTION 'verified_steam_id, steam_display_name, and steam_verified_at can only be set by the server';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER enforce_steam_protection
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_verified_steam_columns();

-- Add replay GUID tracking to tournament_match_games
ALTER TABLE public.tournament_match_games
ADD COLUMN IF NOT EXISTS replay_guid TEXT,
ADD COLUMN IF NOT EXISTS replay_changelist INTEGER,
ADD COLUMN IF NOT EXISTS replay_uploaded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS replay_uploaded_by UUID REFERENCES public.profiles(id);

-- Create unique constraint on replay GUID globally
-- (one real match can't be used for multiple tournament games)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_match_games_replay_guid
ON public.tournament_match_games(replay_guid)
WHERE replay_guid IS NOT NULL;

-- Add index for querying by replay changelist (version filtering)
CREATE INDEX IF NOT EXISTS idx_tournament_match_games_replay_changelist
ON public.tournament_match_games(replay_changelist)
WHERE replay_changelist IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.verified_steam_id IS 'Verified Steam ID (SteamID64) from Steam OpenID authentication';
COMMENT ON COLUMN public.tournament_match_games.replay_guid IS 'Unique GUID from replay file header (16-byte hex string)';
