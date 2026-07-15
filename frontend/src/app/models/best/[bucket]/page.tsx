import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SITE_URL } from '@/lib/site'
import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import type { Model } from '@/types/article'
import { NavBar } from '@/components/NavBar'
import { ModelsExplorer } from '@/components/ModelsExplorer'
import { BEST_VIEWS, bestView, rankModels, buildFaq } from '@/lib/bestModels'
import type { TabKey } from '@/lib/modelBuckets'

const SITE = SITE_URL

// No catch: a DB blip during ISR regeneration must throw so Next keeps serving
// the last good page, instead of caching an empty leaderboard as a healthy 200.
const loadModels = cache(async (): Promise<Model[]> => {
  const caller = appRouter.createCaller(createContext())
  return caller.articles.getModels({ limit: 200 })
})

export async function generateStaticParams() {
  return BEST_VIEWS.map((v) => ({ bucket: v.key }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ bucket: string }>
}): Promise<Metadata> {
  const { bucket } = await params
  const view = bestView(bucket)
  if (!view) return {}
  const year = new Date().getFullYear()
  const ranked = rankModels(await loadModels(), view.key)
  const top3 = ranked.slice(0, 3).map((r) => r.model.name)
  const title = `${view.titleBase} (${year})`
  const description = top3.length
    ? `${view.heading} for ${year}, ranked by live benchmark data. Top picks: ${top3.join(', ')}. Compare scores, pricing, and context windows.`
    : `${view.heading}, ranked by live benchmark and pricing data.`
  const url = `${SITE}/models/best/${view.key}`
  return {
    title,
    description: description.length > 160 ? `${description.slice(0, 157)}…` : description,
    alternates: { canonical: url },
    openGraph: { type: 'website', title, description, url },
  }
}

export default async function BestModelsPage({
  params,
}: {
  params: Promise<{ bucket: string }>
}) {
  const { bucket } = await params
  const view = bestView(bucket)
  if (!view) notFound()

  const year = new Date().getFullYear()
  const models = await loadModels()
  const ranked = rankModels(models, view.key).slice(0, 20)
  const faq = buildFaq(view, ranked)

  const jsonLd: object[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Model tracker', item: `${SITE}/models` },
        { '@type': 'ListItem', position: 3, name: view.titleBase, item: `${SITE}/models/best/${view.key}` },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `${view.titleBase} (${year})`,
      itemListElement: ranked.map((r, i) => ({
        '@type': 'ListItem', position: i + 1, url: `${SITE}/models/${r.model.slug}`, name: r.model.name,
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

      <main className="anc-models">
        {/* Keyed by bucket: App Router reconciles (not remounts) client components
            when only the dynamic param changes, so without the key a best→best
            navigation keeps the previous bucket's tab state and content. */}
        <ModelsExplorer key={view.key} models={models} initialTab={view.key as TabKey} />

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
