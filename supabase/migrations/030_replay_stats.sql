-- Player stats from replay auto-fill
-- Stores per-player performance stats extracted from replay files

CREATE TABLE IF NOT EXISTS public.tournament_game_player_stats (
    game_id UUID NOT NULL REFERENCES public.tournament_match_games(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
    
    -- Stats from endgame scoreboard
    kills INTEGER,
    damage INTEGER,
    blocked INTEGER, -- Blocked damage
    assist INTEGER, -- Spotting assist damage
    
    -- Tank played (codename from replay, e.g. "Bush" = Ark)
    tank_codename TEXT,
    
    -- Party/squad ID from replay (for identifying premades)
    party_id TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (game_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_game_player_stats_game
    ON public.tournament_game_player_stats(game_id);

CREATE INDEX IF NOT EXISTS idx_tournament_game_player_stats_user
    ON public.tournament_game_player_stats(user_id);

ALTER TABLE public.tournament_game_player_stats ENABLE ROW LEVEL SECURITY;

-- Stats are readable if the game is published
DROP POLICY IF EXISTS "Published game stats are readable" ON public.tournament_game_player_stats;
CREATE POLICY "Published game stats are readable"
    ON public.tournament_game_player_stats FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.tournament_match_games games
            JOIN public.tournament_matches matches ON matches.id = games.match_id
            JOIN public.tournaments tournaments ON tournaments.id = matches.tournament_id
            WHERE games.id = game_id
              AND tournaments.status <> 'draft'
        )
    );

-- Only tournament organizers can insert/update stats
DROP POLICY IF EXISTS "Organizers can manage game stats" ON public.tournament_game_player_stats;
CREATE POLICY "Organizers can manage game stats"
    ON public.tournament_game_player_stats FOR ALL
    USING (
        EXISTS (
            SELECT 1
            FROM public.tournament_match_games games
            JOIN public.tournament_matches matches ON matches.id = games.match_id
            JOIN public.tournaments tournaments ON tournaments.id = matches.tournament_id
            WHERE games.id = game_id
              AND tournaments.organizer_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.tournament_match_games games
            JOIN public.tournament_matches matches ON matches.id = games.match_id
            JOIN public.tournaments tournaments ON tournaments.id = matches.tournament_id
            WHERE games.id = game_id
              AND tournaments.organizer_id = auth.uid()
        )
    );

COMMENT ON TABLE public.tournament_game_player_stats IS 'Per-player performance stats from replay files';
COMMENT ON COLUMN public.tournament_game_player_stats.tank_codename IS 'Tank codename from replay (e.g. Bush, Healer) - maps to GameData vehicle keys';
COMMENT ON COLUMN public.tournament_game_player_stats.party_id IS 'Squad/party UUID from replay for identifying premade groups';
