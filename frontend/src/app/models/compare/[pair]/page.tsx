import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SITE_URL } from '@/lib/site'
import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import type { Model } from '@/types/article'
import { CompareTable } from '@/components/CompareTable'
import { NavBar } from '@/components/NavBar'
import { comparePairs, comparePairKeys, pairKey, pairModelNames } from '@/lib/comparePairs'

export const revalidate = 3600

const SITE = SITE_URL
const SLUG_RE = /^[a-z0-9-]+$/

function parsePair(pair: string): [string, string] | null {
  const parts = pair.split('-vs-')
  if (parts.length !== 2) return null
  const [a, b] = parts.map((s) => s.trim().toLowerCase())
  if (!SLUG_RE.test(a) || !SLUG_RE.test(b) || a === b) return null
  return [a, b]
}

const loadPair = cache(async (a: string, b: string): Promise<Model[]> => {
  const caller = appRouter.createCaller(createContext())
  return caller.articles.getModelsByIds({ slugs: [a, b] }).catch(() => [] as Model[])
})

// ── formatting ──────────────────────────────────────────────────────────────
function fmtContext(n: number | null): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return `${n}`
}
const eci = (m: Model) => m.headline_score ?? null

// Data-driven verdict bullets — only the differences we can actually measure.
function verdict(a: Model, b: Model): string[] {
  const out: string[] = []
  const ea = eci(a), eb = eci(b)
  if (ea != null && eb != null && ea !== eb) {
    const w = ea > eb ? a : b
    out.push(`${w.name} leads on overall intelligence (ECI ${Math.round(Math.max(ea, eb))} vs ${Math.round(Math.min(ea, eb))}).`)
  }
  if (a.price_in != null && b.price_in != null && a.price_in !== b.price_in) {
    const c = a.price_in < b.price_in ? a : b
    out.push(`${c.name} is cheaper on input tokens — $${Math.min(a.price_in, b.price_in).toFixed(2)} vs $${Math.max(a.price_in, b.price_in).toFixed(2)} per 1M.`)
  }
  if (a.context_window && b.context_window && a.context_window !== b.context_window) {
    const c = a.context_window > b.context_window ? a : b
    out.push(`${c.name} has a larger context window (${fmtContext(Math.max(a.context_window, b.context_window))} vs ${fmtContext(Math.min(a.context_window, b.context_window))} tokens).`)
  }
  const ca = a.buckets?.coding, cb = b.buckets?.coding
  if (ca != null && cb != null && ca !== cb) {
    const c = ca > cb ? a : b
    out.push(`${c.name} ranks higher for coding (${Math.max(ca, cb)}th vs ${Math.min(ca, cb)}th percentile).`)
  }
  return out
}

// Comparison-specific Q&A → on-page FAQ + FAQPage schema.
function compareFaq(a: Model, b: Model): { q: string; a: string }[] {
  const faq: { q: string; a: string }[] = []
  const ea = eci(a), eb = eci(b)
  if (ea != null && eb != null) {
    const hi = ea >= eb ? a : b, lo = ea >= eb ? b : a
    faq.push({
      q: `Is ${a.name} better than ${b.name}?`,
      a: `On Epoch AI's Capabilities Index, ${hi.name} scores higher (${Math.round(Math.max(ea, eb))}) than ${lo.name} (${Math.round(Math.min(ea, eb))}). The right pick depends on your task — compare their coding, math, and reasoning scores in the table above.`,
    })
  }
  if (a.price_in != null && b.price_in != null) {
    const lo = a.price_in <= b.price_in ? a : b
    faq.push({
      q: `Which is cheaper, ${a.name} or ${b.name}?`,
      a: `${lo.name} is cheaper on input tokens at $${Math.min(a.price_in, b.price_in).toFixed(2)} per million, versus $${Math.max(a.price_in, b.price_in).toFixed(2)} (representative OpenRouter pricing).`,
    })
  }
  if (a.context_window && b.context_window) {
    const big = a.context_window >= b.context_window ? a : b
    faq.push({
      q: `Which has a larger context window, ${a.name} or ${b.name}?`,
      a: `${big.name} supports up to ${fmtContext(Math.max(a.context_window, b.context_window))} tokens, compared with ${fmtContext(Math.min(a.context_window, b.context_window))} for the other.`,
    })
  }
  const ca = a.buckets?.coding, cb = b.buckets?.coding
  if (ca != null && cb != null) {
    const c = ca >= cb ? a : b
    faq.push({
      q: `Which is better for coding, ${a.name} or ${b.name}?`,
      a: `Across coding benchmarks like SWE-bench Verified and Terminal-Bench, ${c.name} ranks higher — ${Math.max(ca, cb)}th vs ${Math.min(ca, cb)}th percentile among the models tracked on Model Beat.`,
    })
  }
  return faq
}

export async function generateStaticParams() {
  const pairs = await comparePairs()
  return pairs.map((p) => ({ pair: `${p.a}-vs-${p.b}` }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ pair: string }>
}): Promise<Metadata> {
  const { pair } = await params
  const parsed = parsePair(pair)
  if (!parsed) return {}
  const models = await loadPair(parsed[0], parsed[1])
  if (models.length < 2) return {}
  const [a, b] = models
  const canonicalKey = pairKey(a.slug, b.slug)
  const isCanonical = `${parsed[0]}-vs-${parsed[1]}` === canonicalKey
  const indexable = isCanonical && (await comparePairKeys()).has(canonicalKey)

  // Short suffix: SERPs truncate ~60 chars and the second model's name is
  // the differentiator that must survive.
  const title = `${a.name} vs ${b.name}: benchmarks & pricing`
  const facts: string[] = []
  if (eci(a) != null && eci(b) != null) facts.push(`ECI ${Math.round(eci(a)!)} vs ${Math.round(eci(b)!)}`)
  const desc = `Compare ${a.name} and ${b.name} side by side — ${facts.length ? `${facts.join(', ')}, ` : ''}pricing, context window, and benchmark scores for coding, math, and reasoning. See which model wins.`
  const url = `${SITE}/models/compare/${canonicalKey}`
  return {
    title,
    description: desc.length > 160 ? `${desc.slice(0, 157)}…` : desc,
    alternates: { canonical: url },
    robots: indexable ? undefined : { index: false, follow: true },
    openGraph: { type: 'website', title, description: desc, url },
  }
}

export default async function ComparePairPage({
  params,
}: {
  params: Promise<{ pair: string }>
}) {
  const { pair } = await params
  const parsed = parsePair(pair)
  if (!parsed) notFound()

  const models = await loadPair(parsed[0], parsed[1])
  if (models.length < 2) notFound()

  const [a, b] = models
  const canonicalKey = pairKey(a.slug, b.slug)
  const bullets = verdict(a, b)
  const faq = compareFaq(a, b)

  // A few more curated comparisons to interlink (excludes this one).
  const names = await pairModelNames()
  const related = (await comparePairs())
    .filter((p) => `${p.a}-vs-${p.b}` !== canonicalKey)
    .slice(0, 6)
    .map((p) => ({
      href: `/models/compare/${p.a}-vs-${p.b}`,
      label: `${names.get(p.a) ?? p.a} vs ${names.get(p.b) ?? p.b}`,
    }))

  const jsonLd: object[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Model tracker', item: `${SITE}/models` },
        { '@type': 'ListItem', position: 3, name: 'Compare', item: `${SITE}/models/compare` },
        { '@type': 'ListItem', position: 4, name: `${a.name} vs ${b.name}`, item: `${SITE}/models/compare/${canonicalKey}` },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `${a.name} vs ${b.name}`,
      itemListElement: models.map((m, i) => ({
        '@type': 'ListItem', position: i + 1, url: `${SITE}/models/${m.slug}`, name: m.name,
      })),
    },
    ...(faq.length > 0
      ? [{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faq.map((f) => ({
            '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        }]
      : []),
  ]

  return (
    <div className="aurora-stage">
      <div className="aurora-layer">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <NavBar />

      <main className="anc-cmpwrap">
        <Link className="anc-day-back" href="/models">← All models</Link>
        <div className="anc-kicker">Compare</div>
        <h1 className="anc-date-heading">{a.name} vs {b.name}</h1>

        <p className="anc-cmp-pick-sub">
          {a.name} ({a.vendor ?? '—'}) and {b.name} ({b.vendor ?? '—'}) compared on benchmarks,
          pricing, context window, and use-case rankings.
        </p>

        {bullets.length > 0 && (
          <ul className="anc-cmp-verdict">
            {bullets.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        )}

        <CompareTable models={models} />

        {faq.length > 0 && (
          <section className="m2-section m2-faq">
            <div className="m2-group-head">
              <h2>Frequently asked questions</h2>
              <span className="rule" />
            </div>
            <div className="m2-faqlist">
              {faq.map((f, i) => (
                <details className="m2-faqitem" key={i}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        <p className="anc-cmp-toolnote">
          Want a different match-up? <Link href={`/models/compare?ids=${a.slug},${b.slug}`}>Open the compare tool</Link> to add or swap models.
        </p>

        {related.length > 0 && (
          <section className="anc-cmp-popular">
            <h2>More comparisons</h2>
            <ul>
              {related.map((p) => (
                <li key={p.href}>
                  <Link href={p.href}>{p.label}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="anc-epoch-credit">
          Benchmarks &amp; model data from{' '}
          <a href="https://epoch.ai/data/ai-models" target="_blank" rel="noopener noreferrer">Epoch AI</a>{' '}
          (CC BY); pricing &amp; specs from{' '}
          <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer">OpenRouter</a>.
          ECI = Epoch Capabilities Index.
        </p>
      </main>
    </div>
  )
}
