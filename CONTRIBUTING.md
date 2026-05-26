# Contributing

There are two ways to contribute to Tyr HQ:

1. **Writing articles or guides** — use the in-site editor. No git, no PR. Recommended for community writers.
2. **Code, data, or schema changes** — pull request to this repo, with `npm run check` and `npm run test` passing.

## Writing An Article Or Guide (No Git Needed)

The fastest way to publish an article or guide is the in-site editor:

1. Sign in (the account chip in the top right takes you to `/auth`).
2. Visit `/contribute/new`. Pick **Guide** or **Article**.
   - **Guide** = strategy / fundamentals / chassis-specific tips. You can attach vehicle slugs so the guide shows up on the matching tank pages.
   - **Article** = news, dispatches, anything published under `/articles`.
3. Fill in the title, summary, and tags. Use the editor toolbar to write your body — bold, italic, headings, lists, links, plus inserters for **YouTube embeds** (`▶ YouTube`) and **callout boxes** (`ⓘ Info` / `⚠ Warning` / `★ Tip`).
4. Toggle **Show preview** in the toolbar to see exactly how the article will render. The preview uses the same server-side sanitizer the publish path does, so what you see is what readers will see.
5. **Save Draft** at any time to come back later (find your drafts at `/contribute/mine`).
6. **Submit For Review** when ready. A reviewer will approve, request changes, or reject the submission from `/admin/submissions`. You'll see status updates and any reviewer notes back at `/contribute/mine`. When a reviewer requests changes they can also propose **inline edits** to your body — those come back to the editor as accept/reject suggestions you resolve hunk-by-hunk before resubmitting.

### Editing An Existing Article Or Guide

On any published article or guide page (`/guides/<slug>` or `/articles/<slug>`), signed-in users see a **Suggest An Edit** button at the bottom. Clicking it pre-fills a draft submission with the live content; edit it like any other contribution and submit for review. When approved, the existing article is updated in place (slug stays stable) and a new revision is appended to `article_revisions`.

### Allowed Body Content

The editor's body field accepts standard Markdown plus two custom shortcodes:

- `::youtube{id="dQw4w9WgXcQ"}` — embed a YouTube video. The toolbar inserts this for you. The `id` must be the 11-character video ID.
- `:::callout{type="info"} … :::` — styled callout box. `type` must be `info`, `warning`, or `tip`. The toolbar inserts this with placeholder body text you replace.

Any other raw HTML or unknown directive is rejected at submission time. The submission also has to be 200–30,000 characters and limited to 10 tags.

### Becoming A Reviewer

Reviewers (the `contributor` role) can approve other people's submissions, withdraw published articles, and restore withdrawn ones. On the review screen they can also edit the body directly to suggest inline changes; those ride along with "Request Changes" so the author can accept or reject each one. To become one: ask an existing admin to promote you. Admins do this from `/admin/users` — search by email or callsign, change the role dropdown to "Reviewer".

The first admin on a fresh deployment has to be set with SQL (see the README's "Database Setup" section). After that, all role changes happen in the UI.

## Code, Data, Or Schema Changes (Pull Request)

For everything that isn't an article or guide — UI changes, new features, bug fixes, schema migrations, game-data updates — open a pull request.

### Before You Start

- Use Node.js 20.6+ and npm 10+
- Install dependencies with `npm install`
- Copy `.env.example` to `.env` if you need auth-backed features locally

For pure UI work the site can run without Supabase. For auth, builds, the contribution system, settings, API key management, or live map rooms you'll need a Supabase project configured (see the README for env vars).

### Local Development

```sh
npm run dev
```

### Validation

Run these before opening a pull request:

```sh
npm run check   # svelte-check (type errors + a11y warnings)
npm run test    # Vitest
```

If you touched `src/lib/server/content-sanitize.ts` or any of the article rendering pipeline, also do a manual smoke test in the dev server: load `/guides/<slug>`, render an article with a callout and a YouTube embed, and visit `/admin/submissions` to confirm the reviewer preview matches.

If you touched exported game data or assets derived from the official source, update the `GameData` submodule snapshot or its referenced revision in the same change unless the repo workflow says otherwise.

### Project Conventions

- Keep edits aligned with the existing visual system in [DESIGN.md](./DESIGN.md). Use the canonical `hud-cta` / `hud-cta-outline` / `hud-cta-ghost` classes from `src/app.css` rather than rolling your own button styles.
- Prefer small, focused pull requests
- Do not commit secrets or private service keys
- Treat data, branding, and legal copy carefully
- Keep user-facing copy consistent with the site's third-party / independent status

### Where Things Live

- **Site-wide nav and shared copy** — `src/lib/content/site.ts`
- **Home-page sections** — `src/content/home/*.md` (still markdown-in-repo because they aren't articles)
- **Articles and guides** — Supabase `articles` table; not in this repo. Edit through `/contribute` instead of editing files.
- **Exported game data** — `GameData/` submodule
- **Supabase schema changes** — `supabase/migrations/` (one new numbered file per change; never edit a previously-committed migration)
- **Server-only code** — `src/lib/server/` (anything that touches the service-role key, sanitizer, or admin endpoints)

If you change the Python export pipeline or how generated data lands in the site, document the workflow in `README.md` as part of the same pull request.

### Pull Requests

A solid PR should include:

- A short description of what changed
- Why the change was needed
- Screenshots or video for visible UI changes
- Notes about schema, env, or data updates when relevant

## Licensing And Assets

- Code contributions are expected to be compatible with the repository's MIT license in [LICENSE](./LICENSE).
- Tyr-related data, official submodule content, and bundled game-derived assets are not covered by the MIT license; see [DATA_AND_ASSETS_NOTICE.md](./DATA_AND_ASSETS_NOTICE.md).
- Do not assume that logos, models, images, fonts, or derived game data may be reused outside the terms stated in that notice.
- Articles and guides authored through the in-site editor are likewise expected to follow the data/assets notice — don't paste in copyrighted screenshots, third-party logos, or game-extracted media that isn't covered by the existing terms.
