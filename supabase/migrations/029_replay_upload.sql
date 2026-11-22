-- Replay upload support for tournament matches
-- Stores extracted replay data and verified Steam accounts for player matching

-- Add verified Steam ID to profiles
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS verified_steam_id TEXT,
ADD COLUMN IF NOT EXISTS steam_display_name TEXT,
ADD COLUMN IF NOT EXISTS steam_verified_at TIMESTAMPTZ;

-- Create unique index on verified Steam ID (one profile per Steam account)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_verified_steam_id
ON profiles(verified_steam_id)
WHERE verified_steam_id IS NOT NULL;

-- Add replay GUID tracking to tournament_match_games
ALTER TABLE tournament_match_games
ADD COLUMN IF NOT EXISTS replay_guid TEXT,
ADD COLUMN IF NOT EXISTS replay_changelist INTEGER,
ADD COLUMN IF NOT EXISTS replay_uploaded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS replay_uploaded_by UUID REFERENCES profiles(id);

-- Create unique constraint on replay GUID per tournament
-- (same replay can't be used twice in one tournament)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_match_games_replay_guid
ON tournament_match_games(replay_guid, match_id)
WHERE replay_guid IS NOT NULL;

-- Add index for querying by replay changelist (version filtering)
CREATE INDEX IF NOT EXISTS idx_tournament_match_games_replay_changelist
ON tournament_match_games(replay_changelist)
WHERE replay_changelist IS NOT NULL;

-- Table to store extracted replay player stats
-- Tracks per-player performance from the replay file
CREATE TABLE IF NOT EXISTS tournament_game_replay_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES tournament_match_games(id) ON DELETE CASCADE,
  
  -- Player identity from replay
  player_name TEXT NOT NULL, -- As recorded in replay
  team_id INTEGER NOT NULL, -- 0 or 1 from replay
  steam_id64 TEXT, -- Extracted from replay if available
  
  -- Matched profile (after organizer review)
  matched_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  
  -- Tank/vehicle
  tank_codename TEXT NOT NULL, -- e.g. "Bush"
  tank_display_name TEXT, -- e.g. "Ark"
  
  -- Combat stats
  kills INTEGER NOT NULL DEFAULT 0,
  damage INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(game_id, player_name, team_id)
);

-- Index for looking up stats by game
CREATE INDEX IF NOT EXISTS idx_tournament_game_replay_stats_game_id
ON tournament_game_replay_stats(game_id);

-- Index for looking up stats by Steam ID (for auto-matching)
CREATE INDEX IF NOT EXISTS idx_tournament_game_replay_stats_steam_id64
ON tournament_game_replay_stats(steam_id64)
WHERE steam_id64 IS NOT NULL;

-- Index for looking up unmatched players
CREATE INDEX IF NOT EXISTS idx_tournament_game_replay_stats_unmatched
ON tournament_game_replay_stats(game_id)
WHERE matched_profile_id IS NULL;

-- RLS policies for tournament_game_replay_stats
ALTER TABLE tournament_game_replay_stats ENABLE ROW LEVEL SECURITY;

-- Allow public read access to replay stats for completed matches
CREATE POLICY "Public can view replay stats for completed matches"
ON tournament_game_replay_stats
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tournament_match_games tmg
    JOIN tournament_matches tm ON tmg.match_id = tm.id
    WHERE tmg.id = tournament_game_replay_stats.game_id
  )
);

-- Tournament organizers can manage replay stats
CREATE POLICY "Organizers can manage replay stats for their tournaments"
ON tournament_game_replay_stats
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM tournament_match_games tmg
    JOIN tournament_matches tm ON tmg.match_id = tm.id
    JOIN tournaments t ON tm.tournament_id = t.id
    WHERE tmg.id = tournament_game_replay_stats.game_id
    AND t.organizer_id = auth.uid()
  )
);

-- Add comment for documentation
COMMENT ON COLUMN profiles.verified_steam_id IS 'Verified Steam ID (SteamID64) from Steam OpenID authentication';
COMMENT ON COLUMN tournament_match_games.replay_guid IS 'Unique GUID from replay file header (16-byte hex string)';
COMMENT ON TABLE tournament_game_replay_stats IS 'Player performance stats extracted from replay files for tournament match verification';
