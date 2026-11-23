-- Per-player scoreboard stats captured from a client-parsed replay.
-- The .replay file is not stored. replay_guid on tournament_match_games
-- (migration 029) dedupes the match. This migration is not applied automatically.

CREATE TABLE IF NOT EXISTS public.tournament_game_player_stats (
    game_id UUID NOT NULL REFERENCES public.tournament_match_games(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
    placement SMALLINT CHECK (placement IS NULL OR placement BETWEEN 1 AND 32),
    kills INTEGER,
    damage INTEGER,
    blocked INTEGER,
    assist INTEGER,
    tank_codename TEXT,
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

DROP TRIGGER IF EXISTS tournament_game_player_stats_touch_updated_at ON public.tournament_game_player_stats;
CREATE TRIGGER tournament_game_player_stats_touch_updated_at
    BEFORE UPDATE ON public.tournament_game_player_stats
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.tournament_game_player_stats IS 'Per-player scoreboard stats from a confirmed replay upload';
COMMENT ON COLUMN public.tournament_game_player_stats.placement IS '1-based scoreboard rank from the replay. Winning side is ranked first.';
COMMENT ON COLUMN public.tournament_game_player_stats.tank_codename IS 'Replay tank codename, such as Bush. Maps to Gameplay.Vehicle.<codename>.';
COMMENT ON COLUMN public.tournament_game_player_stats.party_id IS 'Squad id from the replay scoreboard.';
