import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Model Release Tracker',
  description:
    'Every new AI model release, newest first — GPT, Claude, Gemini, Llama, Qwen, DeepSeek and more, deduplicated across sources and ranked by significance.',
  alternates: { canonical: '/models' },
}

export default function ModelsLayout({ children }: { children: React.ReactNode }) {
  return children
}
