# Contributing

## Before You Start

- Use Node.js 20+ and npm 10+
- Install dependencies with `npm install`
- Copy `.env.example` to `.env` if you need auth-backed features

For basic UI and content work, the site can run without Supabase. For auth, saved builds, settings, API key management, or live map rooms, you will need a Supabase project configured.

## Local Development

```sh
npm run dev
```

## Validation

Run these before opening a pull request:

```sh
npm run check
npm run test
```

If you touched exported site data or assets derived from the official game-data source, update the `GameData` submodule snapshot or its referenced revision in the same change unless the repo workflow says otherwise.

## Project Conventions

- Keep edits aligned with the existing visual system in `DESIGN.md`
- Prefer small, focused pull requests
- Do not commit secrets or private service keys
- Treat data, branding, and legal copy carefully
- Keep user-facing copy consistent with the site's third-party / independent status

## Data And Content Changes

- Articles are stored in `src/content/news/*.md`
- Site-wide nav and shared copy are in `src/lib/content/site.ts`
- Exported game data lives in the `GameData/` submodule
- Supabase schema changes belong in `supabase/migrations/`

If you change the Python export pipeline or how generated data lands in the site, document the workflow in `README.md` as part of the same pull request.

## Pull Requests

A solid PR should include:

- A short description of what changed
- Why the change was needed
- Screenshots or video for visible UI changes
- Notes about schema, env, or data updates when relevant

## Licensing And Assets

- Code contributions are expected to be compatible with the repository's MIT license in [LICENSE](./LICENSE).
- Tyr-related data, official submodule content, and bundled game-derived assets are not covered by the MIT license; see [DATA_AND_ASSETS_NOTICE.md](./DATA_AND_ASSETS_NOTICE.md).
- Do not assume that logos, models, images, fonts, or derived game data may be reused outside the terms stated in that notice.
