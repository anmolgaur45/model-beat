# AI News Calendar

A date-organized timeline for AI news. Stories are pulled from 46 sources, deduplicated with sentence embeddings, and ranked by a significance score that weighs source authority and how many outlets covered the same story.

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Python](https://img.shields.io/badge/Python-3.12-3776AB) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-336791) ![GCP](https://img.shields.io/badge/GCP-Cloud_Run-4285F4)

## Architecture

```
Vercel (Frontend)                      Google Cloud (Backend)
┌──────────────────────┐     ┌────────────────────────────────┐
│ Next.js + tRPC       │ SSL │ Cloud SQL (Postgres + pgvector) │
│ Timeline UI          │────▶│                                 │
│ /api/revalidate      │◀────┼─ Cloud Run Job (Python)         │
└──────────────────────┘ ISR │   ingest → embed → score        │
                             │   → cluster → merge             │
                             │                                 │
                             │ Cloud Scheduler (every 6h)      │
                             └────────────────────────────────┘

GitHub Actions: on a push to pipeline/, run the tests, build the
image, and deploy the Cloud Run Job (keyless Workload Identity auth).
```

The frontend reads from Cloud SQL over SSL. When the pipeline finishes a run it calls `/api/revalidate` so the frontend flushes its cache and new stories show up without a redeploy.

## Monorepo structure

```
frontend/       # Next.js web application (TypeScript)
  src/
    app/        # Pages, the /models tracker, API routes
    components/ # UI components
    server/     # tRPC routers (read-only DB access)
    lib/        # Database client, utilities
    types/      # Shared TypeScript types

pipeline/       # Data ingestion pipeline (Python)
  src/ainews/
    ingestors/  # RSS, Hacker News, GitHub release parsers
    processing/ # Embeddings, clustering, merging, impact scoring
    sources.py  # Source registry (RSS feeds, HN, GitHub releases)
    main.py     # Pipeline orchestrator
  scripts/      # Cluster eval and maintenance utilities
```

## Features

- Timeline view, with stories grouped by date and ranked by significance within each day
- Catch me up, a recap of the highest-scoring stories from the last seven days grouped by day, with a minimum score floor so it only surfaces what actually mattered
- Model release tracker at `/models`, a reverse-chronological table of model launches deduplicated across outlets
- Deduplication with `all-MiniLM-L6-v2` embeddings, so the same story from several outlets becomes a single card with every source listed
- Significance scoring from source authority, the number of distinct outlets covering a story, and a per-article impact score
- Quiet-day signalling, where a day on which nothing cleared the notable threshold is labeled as such instead of being padded out
- Hacker News discussion links on any story that was also covered on HN
- Category filters: Models, Research, Companies, Products, Policy, Hardware, Open Source, Opinion
- Full-text search with PostgreSQL FTS and synonym expansion
- Every card cites its original source with a timestamp

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16, TypeScript, Tailwind CSS v4, tRPC v11 |
| Pipeline | Python 3.12, sentence-transformers, feedparser, httpx |
| Database | PostgreSQL 15 + pgvector (GCP Cloud SQL) |
| Scoring | LLM API for per-article impact scoring (1 to 10) |
| Hosting | Vercel (frontend), GCP Cloud Run (pipeline) |
| CI/CD | GitHub Actions, tests on every push and auto-deploy of the pipeline |
| Scheduling | GCP Cloud Scheduler, every 6 hours |

## Running locally

### Frontend

```bash
cd frontend
pnpm install
cp .env.local.example .env.local  # fill in DB credentials
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Pipeline

```bash
cd pipeline
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"
python -m ainews.main
```

## Testing

```bash
# Pipeline
cd pipeline
ruff check src/ tests/ scripts/
pytest tests/ -v            # 70 tests

# Frontend
cd frontend
pnpm lint
pnpm test                   # Vitest
pnpm build                  # type-check and production build
```

## Database

Migrations live in `pipeline/migrations/` and target PostgreSQL 15 with the `vector` extension. The schema includes:

- `articles`, ingested articles with 384-dimensional embeddings and impact scores
- `clusters`, deduplicated story groups with significance scores and an FTS index
- `pipeline_runs`, a log of run timestamps used to flag stale data in the UI
- `find_nearest_article()`, the pgvector ANN search function used during clustering

## Deduplication and scoring

Articles are embedded with `all-MiniLM-L6-v2`, which produces 384-dimensional vectors. For each new article, an approximate-nearest-neighbor search looks for similar articles within 48 hours of its publication date. An article joins an existing cluster only when it sits close to both a member article and the cluster centroid, which keeps unrelated stories from chaining together. Thresholds are set per source: news articles cluster at a cosine distance of 0.30, while arXiv papers use a tighter 0.10 so that distinct papers on the same topic stay apart.

Clusters are built one article at a time, so a story whose coverage is spread out can occasionally split across two clusters. A merge pass at the end of every run handles that case. It compares cluster centroids inside the time window and merges any pair closer than the threshold, so a single story never shows up as two cards.

The significance score combines three signals: the authority of the sources covering a story, the number of distinct organizations covering it, and the highest per-article impact score in the cluster. The raw value is compressed onto a 1 to 10 scale with a logarithmic curve, so the biggest stories keep some separation instead of all flattening out at the maximum.

## Deployment

The frontend deploys to Vercel automatically on every push to `main`.

The pipeline deploys through GitHub Actions. A push that touches `pipeline/` runs the test suite first, and on success builds the container image and deploys it to the Cloud Run Job, pinned to the commit SHA. Authentication uses Workload Identity Federation, so there are no service-account keys in the repository. First-time setup for the federation pool, the deployer service account, and the IAM roles is documented in `pipeline/DEPLOY.md`.

Cloud Scheduler triggers the pipeline every six hours. When a run completes it calls `/api/revalidate` on the frontend to refresh the cache.

## Observability and security

- Page and performance metrics through Vercel Analytics and Speed Insights
- Error tracking on the client, server, and edge runtimes
- A stale-data banner that appears when the latest pipeline run is more than eight hours old
- Security headers on every response, including Content-Security-Policy, HSTS, and X-Frame-Options
- In-memory rate limiting on the write endpoints
- All API inputs validated with Zod, including allowlists for category and date parameters

## License

MIT
