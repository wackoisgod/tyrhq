# Tyr HQ agent notes

## Setup

After fetching, run `git submodule update --init --recursive`. An empty `GameData` directory means setup is unfinished, not that game data is missing from the product. Do not commit `GameData` submodule pointer changes, or `package-lock.json` drift.

## Changelog

Any pull request with a player-visible change (a new feature, a UI change, or a behavior fix) must add or extend an entry in `src/lib/changelog.ts` in the same pull request.

- Newest entry on top.
- Reuse the top entry if it is the same unreleased release. Otherwise add a new one dated the day it ships to main.
- Tags: New, Improved, Fixed.
- Plain player-facing wording. One sentence per item. Say what the player can now do, or what changed for them.
- No PR numbers, ticket ids, file names, internal names, or jargon.
- Skip internal-only work (refactors, tests, CI, migrations with no visible effect).
- Game balance numbers belong on Patch Notes, not here.
- Don't claim anything that was not actually shipped.

Good: `Register as a free agent when you are looking for a team.`

Bad: `Add free-agent registration in tournament_free_agents (migration 021).`
