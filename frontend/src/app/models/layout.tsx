import type { Metadata } from 'next'
import { SITE_URL, socialMeta } from '@/lib/site'

const TITLE = 'AI Model Leaderboard: benchmarks & pricing'
const DESCRIPTION =
  'Every AI model released this past year — GPT, Claude, Gemini, Llama, Qwen, DeepSeek and more, with benchmark scores (GPQA, MATH, SWE-bench, Epoch Capabilities Index) and the news coverage of each release.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/models' },
  ...socialMeta(TITLE, DESCRIPTION, `${SITE_URL}/models`),
}

export default function ModelsLayout({ children }: { children: React.ReactNode }) {
  return children
}
