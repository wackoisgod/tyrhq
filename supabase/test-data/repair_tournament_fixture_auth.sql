-- Run once in the Supabase SQL editor for the project containing the tournament
-- fixtures. Safe to rerun: users_repaired is 0 once all matching rows are fixed.
--
-- Scope: only the exact 68 ID/email pairs from tournament_feature_fixture.sql.
-- Only NULL token/change fields become empty strings, as expected by GoTrue.
-- Existing non-NULL values, passwords, identities, roles, profiles, teams, builds,
-- and tournament progress are preserved. No records are deleted or recreated.
--
-- See https://supabase.com/docs/guides/troubleshooting/database-error-saving-new-user-RU_EwB

begin;

with fixture_users as (
    select
        ('a1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid as id,
        'aggro.tournament.player.' || lpad(n::text, 2, '0') || '@example.invalid' as email
    from generate_series(1, 68) as numbers(n)
), repaired as (
    update auth.users as users
    set confirmation_token = coalesce(users.confirmation_token, ''),
        recovery_token = coalesce(users.recovery_token, ''),
        email_change_token_current = coalesce(users.email_change_token_current, ''),
        email_change_token_new = coalesce(users.email_change_token_new, ''),
        email_change = coalesce(users.email_change, ''),
        phone_change_token = coalesce(users.phone_change_token, ''),
        phone_change = coalesce(users.phone_change, ''),
        reauthentication_token = coalesce(users.reauthentication_token, '')
    from fixture_users
    where users.id = fixture_users.id
      and users.email = fixture_users.email
      and (
          users.confirmation_token is null
          or users.recovery_token is null
          or users.email_change_token_current is null
          or users.email_change_token_new is null
          or users.email_change is null
          or users.phone_change_token is null
          or users.phone_change is null
          or users.reauthentication_token is null
      )
    returning users.id
)
select
    (select count(*) from auth.users as users
     join fixture_users on users.id = fixture_users.id and users.email = fixture_users.email)
        as fixture_users_found,
    count(*) as users_repaired
from repaired;

commit;
