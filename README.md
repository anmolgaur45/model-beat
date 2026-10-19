# Model Beat

Covering the AI beat, every day. Model Beat is a date-organized timeline of AI news. It gathers stories from news feeds, research papers, Hacker News and GitHub releases, groups coverage of the same event into a single story using sentence embeddings, and ranks each story by a significance score built from source authority, how many independent outlets covered it, and an AI-rated impact score. It also tracks the models themselves: a registry of recent releases with benchmark scores, list and third-party pricing, a change log, and the news coverage of each model.

Live at [themodelbeat.com](https://themodelbeat.com).

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Python](https://img.shields.io/badge/Python-3.12-3776AB) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-336791) ![GCP](https://img.shields.io/badge/GCP-Cloud_Run-4285F4) ![Vercel](https://img.shields.io/badge/Vercel-deployed-000000)

## Architecture

```
Vercel (frontend)            Google Cloud (us-central1)
┌──────────────────────┐     ┌─────────────────────────────────────┐
│ Next.js + tRPC       │ SSL │ Cloud SQL: Postgres 18 + pgvector   │
│ timeline, stories,   │────▶│                                     │
│ /models tracker      │     │ Cloud Run Job (Python), every 3h:   │
│ /api/revalidate      │◀────┼─ ingest → embed → impact score →    │
└──────────────────────┘     │    cluster + merge → summarize →    │
                             │    sync models → refresh the site   │
                             │                                     │
                             │ Cloud Scheduler starts each run     │
                             │ Vertex AI: Gemini 3.1 Flash-Lite    │
                             └─────────────────────────────────────┘

Model data: Epoch AI and Artificial Analysis (benchmarks),
OpenRouter (pricing, providers and specs).

GitHub Actions: on a push to pipeline/, run the tests, build the
image, and deploy the Cloud Run Job (keyless Workload Identity auth).
A second workflow checks every 3 hours that the live site is fresh.
```

The frontend reads from Cloud SQL over SSL. At the end of each run the pipeline calls `/api/revalidate`, which refreshes only the pages that can change (the homepage, today's and yesterday's day pages, the digest page, the model leaderboard, change feed, ranking and comparison pages, and models with a recent launch or a new change) and submits the changed news and model pages to IndexNow. Story pages render on request behind a five-minute CDN cache. The sitemap, the RSS feeds and `llms.txt` render on request behind a one-hour CDN cache.

## Monorepo structure

```
frontend/                # Next.js web application (TypeScript)
  src/
    app/                 # Pages, API routes, sitemap, feeds, llms.txt
    components/          # UI components
    server/              # tRPC routers (read-only DB access)
    lib/                 # Database client, ranking and formatting helpers
    hooks/, types/       # React hooks, shared TypeScript types
  content/digest/        # Sent digest issues in Markdown, published at /digest/<date>
  supabase/              # The schema as ordered migrations, for a local database

pipeline/                # Data pipeline (Python)
  src/ainews/
    ingestors/           # RSS, Hacker News and GitHub release parsers
    processing/          # Normalizing, embeddings, impact scoring, clustering,
                         #   summaries, the model registry, the Gemini client
    sources.py           # Source registry (feeds, authority, categories)
    main.py              # Pipeline orchestrator
  migrations/schema.sql  # The production schema
  scripts/               # Cluster evaluation, re-clustering, weekly metrics,
                         #   digest drafts
  cloudrun-job.yaml      # Cloud Run Job definition, applied on every deploy
  DEPLOY.md              # One-time GCP setup, manual deploy and rollback

.github/workflows/       # deploy-pipeline (test, build, deploy), deploy-health
```

## Features

### News timeline
- Stories grouped by day and ranked by significance within each day. The homepage places a story on the day it drew the most coverage; the `/day/YYYY-MM-DD` archive pages place it on the day it broke.
- A "why this score" breakdown behind every score badge
- Deduplication with `all-MiniLM-L6-v2` embeddings, plus a Gemini check on borderline pairs, so the same event reported by several outlets becomes one card that lists every source
- A page for each story with every source it drew on and, for news stories scoring 4 or higher, an AI summary written by Gemini on Vertex AI
- arXiv papers on their own shelf below each day's news
- Catch me up, a recap of the highest-scoring stories from the last seven days
- Quiet-day signalling: when a day's top story scores below 7, the day is labeled quiet instead of being padded out
- Hacker News discussion links on stories that were also posted to HN
- Category filters: Models, Research, Industry, Products, Policy, Hardware, Open Source, Opinion
- Search over story headlines (PostgreSQL full-text search with synonym expansion) and source names
- Every card cites its sources with a direct link and a timestamp

### Model tracker
- A leaderboard at `/models` of models released in the past year, with tabs for Newest, Overall, Coding, Math, Reasoning & Knowledge, Agentic & Tools, and Value. Overall ranks by Epoch AI's Capabilities Index, each use-case tab by a percentile composite of the benchmarks for that area, and Value by capability per dollar.
- Benchmark scores from Epoch AI, with Artificial Analysis filling gaps and adding benchmarks Epoch doesn't run
- Pricing from OpenRouter: the lab's list price and the cheapest credible third-party provider (healthy, undiscounted, at least 8-bit, and serving most of the native context window). A price change has to appear in two runs in a row before it is published.
- A change feed at `/models/changes`, also as RSS, of price, context window, benchmark and catalog changes
- A page for each model with its benchmarks and percentiles, pricing, specs, news coverage, change log and FAQ
- Ranking pages at `/models/best/<use case>`, a compare tool at `/models/compare` for two to four models, and pages for curated head-to-head pairs
- Charts of price against intelligence, coverage against capability, the frontier over time, context windows over time, and open-weight against proprietary models

### Distribution and SEO
- Day archive pages, story pages, an XML sitemap and a `robots.txt`
- Structured data (JSON-LD) for the site, days, stories, models, rankings, comparisons and digest issues
- A share image for every page, generated at `/api/og`
- RSS feeds at `/feed.xml` and `/models/changes/rss`, and an `llms.txt` for AI crawlers
- A free weekly email digest, with signup and a live preview of the week at [/digest](https://themodelbeat.com/digest) and past issues at `/digest/archive`
- An early-access waitlist at `/stack-watch` for Stack Watch, alerts when a model you use changes

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4, tRPC v11 with TanStack Query, Framer Motion |
| Pipeline | Python 3.12, sentence-transformers, feedparser, httpx, psycopg 3, structlog |
| Database | PostgreSQL 18 on Cloud SQL, with pgvector (HNSW index) and pg_trgm |
| AI | Gemini 3.1 Flash-Lite on Vertex AI: per-article impact scores from 1 to 10, same-event checks for borderline merges, story summaries |
| Model data | Epoch AI (benchmarks, CC BY), Artificial Analysis (benchmarks), OpenRouter (pricing, providers, specs) |
| Hosting | Vercel (frontend), Cloud Run Job in us-central1 (pipeline) |
| CI/CD | GitHub Actions tests, builds and deploys the pipeline on every pipeline change and checks the live site every 3 hours; Vercel builds the frontend on every push to `main` |
| Scheduling | Cloud Scheduler, every 3 hours |
| Monitoring | Sentry (server side), Vercel Analytics and Speed Insights, Cloud Monitoring alerts |

## Running locally

### Frontend

```bash
cd frontend
pnpm install                        # pnpm 10, pinned in package.json
cp .env.local.example .env.local    # fill in DB credentials
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). To open the app from a phone on the same network, add your machine's LAN IP to `allowedDevOrigins` in `next.config.ts` and use the `Network` URL that `pnpm dev` prints.

### Pipeline

```bash
cd pipeline
python -m venv .venv
source .venv/bin/activate           # or .venv\Scripts\activate on Windows
pip install -r requirements.lock --extra-index-url https://download.pytorch.org/whl/cpu
pip install -e ".[dev]"
cp .env.example .env                # fill in DB credentials
python -m ainews.main
```

`requirements.lock` pins the exact versions the production image runs. The pipeline writes to whatever database `.env` points at, so use a local or test database unless you mean to update production. The Gemini steps (impact scores, merge checks and summaries) need `VERTEX_PROJECT` and Google application default credentials (`gcloud auth application-default login`), and the Artificial Analysis sync needs `AA_API_KEY`. Without them the run skips those steps. Leave `REVALIDATE_URL` blank so a local run doesn't refresh the live site.

## Testing

```bash
# Pipeline
cd pipeline
ruff check src/ tests/ scripts/
pytest tests/ -q

# Frontend
cd frontend
pnpm lint      # 9 known react-hooks/set-state-in-effect errors are still open
pnpm test      # Vitest
pnpm build     # type-check and production build
```

CI runs ruff and pytest before every pipeline deploy. The frontend checks run locally.

## Database

The production schema is `pipeline/migrations/schema.sql`, on PostgreSQL 18 with the `vector`, `pg_trgm` and `pg_stat_statements` extensions. `frontend/supabase/migrations/` holds the same schema as ordered migrations. The tables:

- `articles`, ingested articles with impact scores and 384-dimensional embeddings. Embeddings are kept for 30 days, as far back as clustering ever looks.
- `clusters`, the stories, with significance scores, AI summaries and a full-text index on the headline
- `models`, `model_benchmarks` and `model_clusters`, the model registry, its benchmark scores, and the links between a model and the stories that cover it
- `model_events`, detected changes to a model's prices, context window, benchmark scores or catalog listing
- `model_speed_history`, daily throughput and time-to-first-token readings from Artificial Analysis (recorded, not shown on the site yet)
- `pipeline_runs`, a log of runs used to flag stale data in the UI
- `waitlist`, digest and Stack Watch signups
- `find_nearest_article()`, the pgvector nearest-neighbour search used during clustering

## Deduplication and scoring

Articles are embedded with `all-MiniLM-L6-v2`, which produces 384-dimensional vectors. For each new article, a nearest-neighbour search looks for similar articles within 48 hours of its publication date. An article joins an existing story only when it sits close to both a member article and the story's centroid, which keeps unrelated stories from chaining together. Thresholds are set per source: news articles cluster at a cosine distance of 0.30, while arXiv papers use a tighter 0.10 so that distinct papers on the same topic stay apart.

Stories are built one article at a time, so coverage of one event can split across two stories. A merge pass at the end of every run handles that case. Two stories whose centroids sit closer than 0.30 merge automatically. Pairs between 0.30 and 0.45 go to Gemini, which merges them only when both describe the same event, up to 60 pairs a run. Each merged group is then re-checked one story at a time against the centroid of everything admitted so far, so a chain of near neighbours can't grow into a blob of unrelated coverage.

The significance score weighs the authority of the sources covering a story. A base score adds up the covering organizations with diminishing returns, so a few authoritative outlets count for more than a long tail of low-authority ones. A coverage multiplier scales the same way, weighing each distinct organization by its authority rather than counting heads, so a wire story syndicated across many small sites cannot outrank first-hand reporting from a major outlet. That base is multiplied by the highest per-article impact score in the story (Gemini rates news articles from 1 to 10; arXiv papers aren't rated and count as a neutral 5), and the raw value is compressed onto a 1 to 10 scale with a logarithmic curve so the biggest stories keep some separation instead of flattening out at the maximum.

## Deployment

The frontend deploys to Vercel automatically on every push to `main`, and serves from [themodelbeat.com](https://themodelbeat.com).

The pipeline deploys through GitHub Actions. A push that touches `pipeline/` runs the test suite first, and on success builds the container image and deploys the Cloud Run Job from `pipeline/cloudrun-job.yaml`, pinned to the commit SHA. Authentication uses Workload Identity Federation, so there are no service-account keys in the repository. First-time setup for the federation pool, the deployer service account, and the IAM roles is documented in `pipeline/DEPLOY.md`.

Cloud Scheduler starts the pipeline every three hours, and each run ends by refreshing the site as described under Architecture. About 40 minutes after each run, the deploy-health workflow checks that the leaderboard, the sitemap and today's day page are still refreshing, and fails (which emails the repository owner) if any of them has gone stale.

## Observability and security

- Page and performance metrics through Vercel Analytics and Speed Insights
- Server-side error reporting with Sentry; browser reporting is left off to keep pages light
- Structured JSON logs from the pipeline in Cloud Logging, a `pipeline_runs` log of every run, and email alerts on failed Cloud Run executions
- The deploy-health freshness check described under Deployment
- Security headers on every response, including Content-Security-Policy, X-Frame-Options and, in production, HSTS
- Separate database roles for the site and the pipeline, each with its own connection limit, so a burst of crawler traffic can't starve a pipeline run
- A bearer secret, compared in constant time, on the revalidate endpoint, and in-memory rate limiting on the email signup endpoint
- All API inputs validated with Zod, including allowlists for category and date parameters

## Credits

Benchmark data from [Epoch AI](https://epoch.ai), licensed CC BY, and [Artificial Analysis](https://artificialanalysis.ai). Model pricing and specifications from [OpenRouter](https://openrouter.ai).

## License

MIT. See [LICENSE](LICENSE).
