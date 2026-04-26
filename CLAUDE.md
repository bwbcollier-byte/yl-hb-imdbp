# CLAUDE.md — `yl-hb-imdbp` (IMDbPro / IMDb / TMDb scrapers)

This file teaches Claude how this repo is laid out and what to be careful of
when editing it. Conventions shared across the `yl-hb-*` fleet live in
[`SCRAPER-CLAUDE-TEMPLATE.md`](../SCRAPER-CLAUDE-TEMPLATE.md) — read both.

## What this repo does

A bundle of scrapers that pull from **IMDbPro** (logged-in, behind a cookie),
the public **IMDb** site, **TMDb** (REST API), and **Airtable**, and upsert
into the HypeBase Supabase project. It runs ~9 separate scheduled jobs
covering CRM enrichment (companies / contacts / clients / staff / starmeter),
title discovery (movies / TV / games × box-office / moviemeter), TMDb media
enrichment, and IMDb top news ingest.

## Stack

**Browser-scraper** variant: Node 20, JavaScript (CommonJS — `require`,
not `import`). Heavy on `puppeteer` + `puppeteer-extra` + stealth plugin.
Also uses `axios`, `cheerio`, `csv-parse`. Service-role Supabase access.

> No `tsconfig.json` and no `src/` — this repo is plain JS at the root.

## Repo layout

```
.github/workflows/                          # 15 workflows
  imdb-top-news.yml                         # → node imdb-top-news-scraper.js
  imdbpro-discover.yml                      # → node index.js
  imdbpro-worker.yml                        # → node main.js
  imdbpro-company-{clients,enrichment,staff}.yml
  imdbpro-crm-enrichment.yml
  imdbpro-starmeter.yml
  tmdb-media-enrichment.yml
  discover-{games,movies,tv}-{boxoffice,moviemeter}.yml

# top-level scrapers (root)
imdb-top-news-scraper.js
imdbpro-clients-induction.js
imdbpro-company-induction.js
imdbpro-crm-induction.js
imdbpro-discover-titles.js
imdbpro-staff-induction.js
imdbpro-starmeter-induction.js
tmdb-media-induction.js

# orchestrators
index.js                                    # main entrypoint for imdbpro-discover
main.js                                     # IMDbPro worker loop
mapper.js                                   # IMDbPro __NEXT_DATA__ → DB shape

# overnight runners (shell)
overnight-imdb-{clients,companies,contacts,staff,starmeter,top-news}.sh
overnight-tmdb-media.sh
runner-{games,movies,tv}-{boxoffice,moviemeter}.sh

# shared
db.js                                       # Supabase client + upsert helpers
scripts/                                    # additional helpers
package.json
```

## Supabase auth

Standard fleet convention — `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`. Client
created in `db.js`:

```js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_KEY || '');
```

Note `db.js` exports several helper functions including `upsertTalent` which
references the legacy `talent_profiles` table (line ~24). The live DB uses
`hb_talent` — those helpers may be dead code paths. Verify a function is
actually called by an active workflow before relying on it.

## Workflow lifecycle convention

> ⚠️ **Most workflows in this repo do NOT call `log_workflow_run`.** Only
> `imdb-top-news.yml` matches the fleet pattern. The other ~14 workflows
> jump straight from `actions/checkout` to `node …` without notifying
> Supabase. As a result, `triage_workflow_runs` and the dashboard see
> nothing for those jobs. Adding the start/result lifecycle blocks is the
> single highest-leverage cleanup for this repo.

Cron staggers throughout the day to avoid IMDbPro rate-limit overlap:
- 00:00 UTC — `imdbpro-crm-enrichment`
- 01:00 UTC — `imdbpro-company-enrichment`
- 03:00 UTC — `imdbpro-company-staff`
- 05:00 UTC — `imdbpro-company-clients`
- 07:00 UTC — `imdbpro-starmeter`
- 08:00 UTC — `imdb-top-news` and `discover-movies-boxoffice`
- 09:00 UTC — `tmdb-media-enrichment`
- 10:00 UTC — `discover-movies-moviemeter`
- 12:00 UTC — `discover-tv-boxoffice`
- 14:00 UTC — `discover-tv-moviemeter`
- 16:00 UTC — `discover-games-boxoffice`
- 18:00 UTC — `discover-games-moviemeter`

Don't reschedule without checking the others — back-to-back IMDbPro hits
trigger blocking.

## Tables this repo touches

| Table | Operation | Source |
|---|---|---|
| `public.hb_talent` | UPSERT | IMDbPro person pages, IMDb top news bylines |
| `public.hb_companies` | UPSERT | IMDbPro company pages |
| `public.hb_contacts` | UPSERT | IMDbPro CRM contacts, Airtable sync |
| `public.hb_socials` | UPSERT | IMDbPro external links |
| `public.hb_media` | UPSERT | TMDb movie/TV/game posters & metadata |
| `public.news` | UPSERT | IMDb top news articles |

> Legacy table names referenced in `db.js` helpers (`talent_profiles`, etc.)
> do **not** exist on live and shouldn't be re-introduced.

## Running locally

```bash
cp .env.example .env             # required
npm install
npx puppeteer browsers install chrome
node imdb-top-news-scraper.js    # try a small one first
```

Required env vars (sample):

```
SUPABASE_URL                     # standard
SUPABASE_SERVICE_KEY             # standard
IMDBPRO_COOKIE                   # full cookie string from a logged-in IMDbPro session
IMDBPRO_SESSION_ID               # the at-main session token
IMDBPRO_USER_AGENT               # match the UA the cookie was issued under
TMDB_API_KEY                     # TMDb v3 API key
AIRTABLE_API_KEY                 # CRM sync
DISCOVER_URL                     # per-runner: IMDbPro discover query URL
DISCOVER_MAX_PAGES=100           # default upper bound
DISCOVER_START_PAGE=1
STAFF_MAX_PAGES, CLIENTS_MAX_PAGES, STARMETER_MAX_PAGES, MAX_PAGES   # per-runner caps
URLS_JSON                        # batched URL input for some workers
```

## Per-repo gotchas

- **IMDbPro requires a logged-in cookie.** The workflows do not perform login
  — they replay a session captured manually. When the cookie expires you'll
  see HTML pages titled "Access denied" or similar, often saved as
  `debug_blocked_*.html`. Refresh `IMDBPRO_COOKIE` + `IMDBPRO_SESSION_ID` +
  `IMDBPRO_USER_AGENT` in repo secrets together — they're a triple, mismatching
  any of them is also a block trigger.
- **Plain `puppeteer` is blocked.** Always use `puppeteer-extra` with the
  stealth plugin (already in deps). When IMDbPro tightens its detection,
  bumping `puppeteer-extra-plugin-stealth` is the first thing to try.
- **MOVIEMETER must sort DESC, not ASC.** Recent commits (`7343ec1`,
  `16a2a88`) reverted ASC ordering on multiple runners — least-popular-first
  wastes the page budget on the long tail. Default to DESC.
- **Early-stop threshold is `<10` titles per page, not `<50`.** Commit
  `5b0594f` lowered this; lifting it back will end discovery early on
  perfectly-valid sparse pages.
- **Debug artifacts already in git history.** Five files are tracked
  (`debug_blocked_*.html`, `debug_no_contacts.html`, `debug_not_found_*.png`,
  `no_contacts_*.png`) from before `.gitignore` was extended. The current
  `.gitignore` correctly blocks new ones (`debug*.html`, `*.png`, `test_*.js`)
  but doesn't remove the existing files. They contain real IMDbPro page
  content captured under your session cookie — clean them up with a
  `git rm` once you confirm none are still referenced from current code.
- **Many workflows skip `log_workflow_run`.** See the convention block above.
- **Multiple entry points hit overlapping data.** `index.js` (discover),
  `main.js` (worker), and `imdbpro-*-induction.js` are not strictly layered
  — adding a new field requires checking all of them and `mapper.js`.
- **TMDb enrichment is skipped for game-type runs.** Commit `40b40d8` added
  this carve-out; don't re-introduce TMDb calls on game discovery.

## Conventions Claude should follow when editing this repo

All the fleet-wide rules from [`SCRAPER-CLAUDE-TEMPLATE.md`](../SCRAPER-CLAUDE-TEMPLATE.md)
apply. Specific to this repo:

- **Don't add `log_workflow_run` calls inline in scraper JS files** (the way
  yl-hb-sp does at the script level). For this repo, retrofit the YAML
  `Notify Supabase — start/result` blocks instead, matching the standard
  template. The script is the wrong layer here because many workflows
  re-invoke node multiple times via shell runners.
- **When adding a new IMDbPro scraper, copy `imdbpro-staff-induction.js`**
  as a structural reference — it has the most up-to-date error handling
  and cookie usage pattern.
- **When changing `mapper.js`, run a sample IMDbPro page through it**
  before committing — schema regressions there silently corrupt thousands
  of rows on the next run.
- **Don't re-introduce `talent_profiles`** or any other legacy table name
  found in `db.js` helpers.

## Related repos

- `yl-hb-am`, `yl-hb-bit`, `yl-hb-dz`, `yl-hb-sp`, `yl-hb-tmdb` — sibling
  enrichers writing to the same `hb_*` tables.
- `yl-hb-dtp` — nightly cleanup that dedupes and ranks what this repo writes.
- `hb_app_build` — Next.js app reading the data.
