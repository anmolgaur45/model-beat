import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'AI Model Leaderboard: benchmarks & pricing',
  description:
    'Every AI model released this past year — GPT, Claude, Gemini, Llama, Qwen, DeepSeek and more, with benchmark scores (GPQA, MATH, SWE-bench, Epoch Capabilities Index) and the news coverage of each release.',
  alternates: { canonical: '/models' },
}

export default function ModelsLayout({ children }: { children: React.ReactNode }) {
  return children
}
