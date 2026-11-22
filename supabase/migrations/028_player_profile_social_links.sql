-- Add Discord and Steam profile fields for player contact information.
-- These are plain text fields (no OAuth linking yet) so captains can contact
-- players when looking for team members.

alter table public.profiles
    add column if not exists discord_handle text check (char_length(discord_handle) <= 100),
    add column if not exists steam_profile text check (char_length(steam_profile) <= 200);

-- Discord/Steam fields are publicly readable (opt-in for players who want to be contacted)
-- RLS policies already allow reading profiles, so no new policies needed for select.

-- Users can update their own social links
-- This is covered by the existing "Users can update own profile" policy.

comment on column public.profiles.discord_handle is 'Discord username or handle (e.g., username#1234 or @username) for team recruitment contact.';
comment on column public.profiles.steam_profile is 'Steam profile URL or username for team recruitment contact.';
