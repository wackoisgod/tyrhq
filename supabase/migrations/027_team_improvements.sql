-- Team improvements: description field, roster roles, and tournament W/L tracking
--
-- This migration adds:
-- 1. Team description field (already exists in schema, ensuring it's there)
-- 2. Additional roster roles: co-captain and substitute
-- 3. Tournament-specific W/L tracking (already computed dynamically, no schema change needed)

-- Update team_members role constraint to include new roles
alter table public.team_members
    drop constraint if exists team_members_role_check;

alter table public.team_members
    add constraint team_members_role_check
    check (role in ('captain', 'co-captain', 'member', 'substitute'));

-- Note: We keep the unique constraint for one captain per team
-- Co-captains are still subject to the same constraint as members

-- Note: Team description field already exists in teams table from migration 019
-- Note: Tournament W/L records are calculated dynamically from tournament_matches
-- and do not require database schema changes
