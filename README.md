# Tyr HQ

Tyr HQ is an independent third-party companion site for Tyr. It combines site code in this repository with official game data and assets sourced through Stoke-controlled channels, along with build planning, armor viewing, map tools, community build sharing, and a small public API.

This repository is the website codebase. It is not affiliated with, endorsed by, or operated by Stoke Games. Tyr and all related names, logos, game assets, and references remain the property of Stoke Games.

## Stack

- SvelteKit 2 + Svelte 5 + TypeScript
- Tailwind CSS 4
- Supabase for auth, profiles, build persistence, API credentials, and live map rooms
- Threlte / Three.js for 3D viewers
- Vitest for tests

## Features

- Vehicle, ammo, component, talent, and map browsing
- Tank build planner and build sharing
- Armor viewer and model previews
- Articles section backed by local markdown content
- Public read-only API at `/api/v1/*` with Swagger docs at `/api/docs`
- Optional account system for saved builds and API key management
- Optional live map room features powered by Supabase

## Repository Layout

```text
src/
  lib/
    components/        Shared UI components
    content/           Site navigation and copy config
    data/              Game-data loaders and data-access helpers
    game-engine/       Planner and stat logic
    server/            Auth, API, content, and persistence helpers
  routes/              SvelteKit pages and endpoints
GameData/              Git submodule containing exported game data and assets
static/                Logos, fonts, images, models, exported assets
src/content/           Markdown content used by the site
scripts/               Python data export utility
supabase/migrations/   SQL migrations for community features
```

## Requirements

- Node.js 20+
- npm 10+

Python is only needed if you intend to regenerate the site data and exported assets through `scripts/export_data.py`.

## Quick Start

1. Install dependencies:

```sh
npm install
```

2. Initialize the data submodule:

```sh
git submodule update --init --recursive
```

3. Copy the example environment file:

```sh
copy .env.example .env
```

On macOS or Linux:

```sh
cp .env.example .env
```

4. Start the app:

```sh
npm run dev
```

5. Open the local URL shown by Vite.

## Environment Variables

The site can run in a reduced mode without Supabase, but community features require it.

| Variable | Required | Purpose |
| --- | --- | --- |
| `PUBLIC_SUPABASE_URL` | For auth and community features | Supabase project URL used by both server and client |
| `PUBLIC_SUPABASE_ANON_KEY` | For auth and community features | Public anon key used for browser/server auth flows |
| `PUBLIC_SITE_URL` | Optional | Canonical public site origin used for auth redirects, email landing URLs, share links, and canonical metadata |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Enables API key management in `/settings` |

Behavior by configuration:

- No Supabase env vars: public pages still render, but auth and account-backed features are disabled.
- Public Supabase vars set: auth, profiles, saved builds, and map rooms can work.
- `PUBLIC_SITE_URL` set: generated absolute URLs prefer that host, which is useful for `www` canonicalization in production.
- Service role key also set: API credential generation and revocation work in settings.

## Database Setup

This repo includes SQL migrations under `supabase/migrations/`.

Current migration set:

- `001_builds.sql`
- `002_profiles.sql`
- `003_build_stars.sql`
- `004_harden_security_definer_search_path.sql`
- `005_public_api_credentials.sql`
- `006_map_rooms.sql`

This repository does not currently include a local Supabase CLI project config, so apply these migrations using your preferred Supabase workflow.

## Development Commands

```sh
npm run dev
npm run check
npm run test
npm run build
npm run preview
npm run sync:data
```

## Submodules

This repository expects site-ready data to be provided by the `GameData` git submodule. The app reads:

- `GameData/generated/runtime.json`
- `GameData/generated/asset-manifest.json`
- exported assets under `GameData/assets/**`

To refresh those files in-place, run:

```sh
npm run sync:data
```

## Content

- Articles live in `src/content/news/*.md`
- Shared navigation and site copy live in `src/lib/content/site.ts`
- Core shell styling lives in `src/app.css`

## Public API

Read-only game data is exposed through `/api/v1`.

Current resource groups:

- `vehicles`
- `ammo`
- `components`
- `talents`
- `talent-trees`
- `maps`

Swagger UI is available at `/api/docs`.

## Licensing

This repository uses split licensing / rights notices:

- Code and original repository documentation: [MIT](./LICENSE)
- Tyr-related data, branding, images, models, fonts, submodule content, and other game-derived assets: see [DATA_AND_ASSETS_NOTICE.md](./DATA_AND_ASSETS_NOTICE.md)

In short:

- The site code is MIT-licensed.
- The MIT license does not apply to Stoke-owned or other third-party game materials used by the project, including official submodule content and processed game data.
- Tyr and related marks remain the property of Stoke Games.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development expectations and pull request guidance.
