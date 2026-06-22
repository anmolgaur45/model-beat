import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_URL } from '@/lib/site'
import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import type { Model } from '@/types/article'
import { CompareControls } from '@/components/CompareControls'
import { CompareTable } from '@/components/CompareTable'
import { NavBar } from '@/components/NavBar'
import { comparePairs, pairKey } from '@/lib/comparePairs'

export const revalidate = 3600

const SITE = SITE_URL
const SLUG_RE = /^[a-z0-9-]+$/

function parseSlugs(raw: string | string[] | undefined): string[] {
  const joined = Array.isArray(raw) ? raw.join(',') : (raw ?? '')
  return [...new Set(
    joined.split(',').map((s) => s.trim().toLowerCase()).filter((s) => SLUG_RE.test(s)),
  )].slice(0, 4)
}

async function loadModels(slugs: string[]): Promise<Model[]> {
  if (slugs.length === 0) return []
  const caller = appRouter.createCaller(createContext())
  return caller.articles.getModelsByIds({ slugs }).catch(() => [] as Model[])
}

// Lightweight roster for the inline picker (name/slug/vendor only).
async function loadRoster(): Promise<{ slug: string; name: string; vendor: string | null }[]> {
  const caller = appRouter.createCaller(createContext())
  const all = await caller.articles.getModels({ limit: 300 }).catch(() => [] as Model[])
  return all.map((m) => ({ slug: m.slug, name: m.name, vendor: m.vendor }))
}

// Canonical URL for a selection: the clean static pair page when exactly two
// models are chosen, else the picker hub. Keeps signals off querystring URLs.
function canonicalFor(slugs: string[]): string {
  if (slugs.length === 2) return `${SITE}/models/compare/${pairKey(slugs[0], slugs[1])}`
  return `${SITE}/models/compare`
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[] }>
}): Promise<Metadata> {
  const { ids } = await searchParams
  const slugs = parseSlugs(ids)
  const models = await loadModels(slugs)
  const names = models.map((m) => m.name)
  const title = names.length >= 2
    ? `${names.join(' vs ')} — comparison`
    : 'Compare AI models'
  const description = names.length >= 2
    ? `Side-by-side comparison of ${names.join(', ')}: benchmarks, pricing, context window, and capabilities.`
    : 'Compare AI models side by side — benchmarks, pricing, context window, and use-case rankings.'
  return {
    title,
    description,
    // The no-ids landing is an indexable hub (picker + popular comparisons); the
    // parametric tool states are not — the clean /models/compare/[pair] pages are
    // the indexable comparison assets.
    robots: slugs.length === 0 ? undefined : { index: false, follow: true },
    alternates: { canonical: canonicalFor(slugs) },
    openGraph: { type: 'website', title, description, url: canonicalFor(slugs) },
  }
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[] }>
}) {
  const { ids } = await searchParams
  const slugs = parseSlugs(ids)
  const [models, roster] = await Promise.all([loadModels(slugs), loadRoster()])
  // selection in roster order, only valid slugs
  const selected = models.map((m) => m.slug)

  const nav = <NavBar />

  const hasTable = models.length >= 2

  // Popular curated comparisons — the crawlable hub of clean-URL pages.
  const rosterBySlug = new Map(roster.map((r) => [r.slug, r]))
  const popularPairs = (await comparePairs())
    .map((p) => ({
      href: `/models/compare/${p.a}-vs-${p.b}`,
      a: rosterBySlug.get(p.a)?.name ?? null,
      b: rosterBySlug.get(p.b)?.name ?? null,
    }))
    .filter((p): p is { href: string; a: string; b: string } => !!p.a && !!p.b)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Comparison: ${models.map((m) => m.name).join(' vs ')}`,
    itemListElement: models.map((m, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE}/models/${m.slug}`,
      name: m.name,
    })),
  }

  return (
    <div className="aurora-stage">
      <div className="aurora-layer">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {nav}

      <main className="anc-cmpwrap">
        <Link className="anc-day-back" href="/models">← All models</Link>
        <div className="anc-kicker">Compare</div>
        <h1 className="anc-date-heading">
          {hasTable ? models.map((m) => m.name).join('  vs  ') : 'Compare models'}
        </h1>

        <p className="anc-cmp-pick-sub">
          {hasTable
            ? 'Add, remove, or swap models to compare them side by side.'
            : models.length === 1
              ? 'Add at least one more model to see the side-by-side comparison.'
              : 'Pick two to four models to compare benchmarks, pricing, and capabilities side by side.'}
        </p>

        <CompareControls all={roster} selected={selected} />

        {hasTable ? (
          <CompareTable models={models} />
        ) : (
          <div className="anc-cmp-emptytable">
            {models.length === 1
              ? `${models[0].name} is ready — add another model above to compare.`
              : 'Your comparison will appear here once you’ve picked at least two models.'}
          </div>
        )}

        {popularPairs.length > 0 && (
          <section className="anc-cmp-popular">
            <h2>Popular comparisons</h2>
            <ul>
              {popularPairs.map((p) => (
                <li key={p.href}>
                  <Link href={p.href}>{p.a} vs {p.b}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="anc-epoch-credit">
          Benchmarks &amp; model data from{' '}
          <a href="https://epoch.ai/data/ai-models" target="_blank" rel="noopener noreferrer">
            Epoch AI
          </a>{' '}
          (CC BY); pricing &amp; specs from{' '}
          <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer">
            OpenRouter
          </a>
          . ECI = Epoch Capabilities Index.
        </p>
      </main>
    </div>
  )
}
