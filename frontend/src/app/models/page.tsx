import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import type { Model } from '@/types/article'
import { ModelsExplorer } from '@/components/ModelsExplorer'
import { NavBar } from '@/components/NavBar'

export const revalidate = 3600

const SITE = process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3000'

async function loadModels(): Promise<Model[]> {
  const caller = appRouter.createCaller(createContext())
  return caller.articles.getModels({ limit: 200 })
}

export default async function ModelsPage() {
  const models = await loadModels().catch(() => [] as Model[])

  // ItemList of the top models for SEO (server-rendered alongside the table HTML).
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'AI model leaderboard',
    itemListElement: models.slice(0, 50).map((m, i) => ({
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

      <NavBar />

      <main className="anc-models">
        <ModelsExplorer models={models} />

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
