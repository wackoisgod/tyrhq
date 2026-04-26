# Tyr HQ

Tyr HQ is an independent third-party companion site for Tyr. It combines site code in this repository with official game data and assets sourced through Stoke-controlled channels, along with build planning, armor viewing, map tools, community build sharing, an in-site contribution system for guides and articles, and a small public API.

This repository is the website codebase. It is not affiliated with, endorsed by, or operated by Stoke Games. Tyr and all related names, logos, game assets, and references remain the property of Stoke Games.

## Stack

- SvelteKit 2 + Svelte 5 + TypeScript
- Tailwind CSS 4
- Supabase for auth, profiles, build persistence, API credentials, live map rooms, and the article content store
- Threlte / Three.js for 3D viewers
- `unified` / `remark` / `rehype` for the article sanitizer pipeline
- Vitest for tests

## Features

- Vehicle, ammo, component, talent, and map browsing
- Tank build planner and build sharing
- Armor viewer and model previews
- **Articles and guides** authored through an in-site WYSIWYG-ish markdown editor with live preview, server-side sanitization, and a reviewer queue (no GitHub required for content)
- **Suggested edits** on existing published articles, reviewer-side rendered diff, full revision history per article
- **Role gradient**: User / Reviewer (`contributor`) / Admin — admins manage roles, reviewers moderate content
- Public read-only API at `/api/v1/*` with Swagger docs at `/api/docs`
- Optional account system for saved builds and API key management
- Optional live map room features powered by Supabase

## Repository Layout

```text
src/
  lib/
    components/         Shared UI components
    content/            Site navigation and copy config
    contribute/         Editor, ArticleBody renderer, custom-element registrar
    data/               Game-data loaders and data-access helpers
    game-engine/        Planner and stat logic
    mdsvex/             Layout + Svelte components for legacy markdown sections
    server/             Auth, API, content sanitizer, articles, submissions, users
  routes/
    admin/              Reviewer + admin pages (submissions, articles, users)
    api/                Server endpoints (builds, contribute, admin, public v1)
    contribute/         Author-facing pages (mine, new, [id]/edit)
    ...                 Plus the public site routes (guides, articles, tools, …)
GameData/               Git submodule containing exported game data and assets
static/                 Logos, fonts, images, models, exported assets
src/content/            Markdown content for home-page sections (articles/guides
                          live in Supabase, not here)
scripts/                Python data export utility + TS content-migration tool
supabase/migrations/    SQL migrations for community features
```

## Requirements

- Node.js 20.6+ (the content-migration script uses the built-in `process.loadEnvFile`)
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
cp .env.example .env
```

4. Apply the Supabase migrations to your project (see [Database Setup](#database-setup)).

5. Start the app:

```sh
npm run dev
```

6. Open the local URL shown by Vite.

## Environment Variables

The site can run in a reduced read-only mode without Supabase, but auth, builds, and the contribution system all require it.

| Variable | Required | Purpose |
| --- | --- | --- |
| `PUBLIC_SUPABASE_URL` | For auth and community features | Supabase project URL used by both server and client |
| `PUBLIC_SUPABASE_ANON_KEY` | For auth and community features | Public anon key used for browser/server auth flows |
| `SUPABASE_SERVICE_ROLE_KEY` | For the contribution system, API key management, and the migration script | Service-role key used by server-only code paths that bypass RLS |
| `PUBLIC_SITE_URL` | Optional | Canonical public site origin used for auth redirects, share links, and canonical metadata |
| `PUBLIC_REPO_URL` | Optional | Public source repository URL surfaced in the footer |

Behavior by configuration:

- No Supabase env vars: public game-data pages still render, but auth, articles, guides, builds, and all account-backed features are disabled.
- Public Supabase vars set: auth, profiles, saved builds, and map rooms can work.
- Service-role key also set: API credential generation, the article store (article reads + writes), the in-site contribution system, role management, and the content-migration script all work.

## Database Setup

This repo includes SQL migrations under `supabase/migrations/`.

Current migration set:

- `001_builds.sql`
- `002_profiles.sql`
- `003_build_stars.sql`
- `004_harden_security_definer_search_path.sql`
- `005_public_api_credentials.sql`
- `006_map_rooms.sql`
- `007_contributions.sql` — `profiles.role` column plus `articles`, `article_revisions`, `article_submissions`, `submission_events` tables and their RLS policies
- `008_rename_news_to_article.sql` — renames the legacy `'news'` content type to `'article'` to match the public `/articles` URL
- `009_drop_self_approval_check.sql` — removes a CHECK constraint that blocked legitimate admin self-approval (the rule is enforced in the application layer instead)

This repository does not include a local Supabase CLI project config, so apply these migrations using your preferred Supabase workflow.

After applying `007–009`, promote yourself to admin so you can manage roles in the UI:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

If you have legacy content in `src/content/guides/*.md` or `src/content/news/*.md`, import it into Supabase with:

```sh
npm run migrate:content -- --dry-run   # preview
npm run migrate:content                # write
```

## Development Commands

```sh
npm run dev               # Vite dev server
npm run check             # svelte-check (typecheck + a11y)
npm run test              # Vitest
npm run build             # production build
npm run preview           # serve the production build
npm run sync:data         # refresh GameData submodule outputs
npm run migrate:content   # one-shot import of legacy markdown into Supabase
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

- Articles and guides live in the Supabase `articles` table; author them via the in-site editor at `/contribute/new`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full flow.
- Editor body content uses [`remark-directive`](https://github.com/remarkjs/remark-directive) shortcodes for embeds: `::youtube{id="…"}` for YouTube videos and `:::callout{type="info|warning|tip"} … :::` for styled callout boxes. Anything else outside the safe-HTML allowlist is rejected at submission time by `src/lib/server/content-sanitize.ts`.
- Home-page sections still use markdown-in-repo (`src/content/home/*.md`) and the mdsvex pipeline.
- Shared navigation and site copy live in `src/lib/content/site.ts`.
- Core shell styling lives in `src/app.css`; the design system is documented in [DESIGN.md](./DESIGN.md).

## Roles

Three roles are defined on `profiles.role`:

- **`user`** — default. Can read everything, submit drafts, and suggest edits to existing articles.
- **`contributor`** (shown as "Reviewer" in the UI) — can also approve / request changes / reject submissions, withdraw articles, and restore withdrawn articles.
- **`admin`** — can also manage roles via `/admin/users`, and is exempt from the no-self-approval rule on submissions.

The first admin is set via SQL (see [Database Setup](#database-setup)). Subsequent admins and reviewers are promoted from `/admin/users`.

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

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the in-site authoring loop, code-PR expectations, and reviewer workflow.
