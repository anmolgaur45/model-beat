// Use-case buckets for the model leaderboard (Phase O2).
// Maps Epoch benchmark display names → a use case. A model's bucket score is the
// average of its percentile rank across the bucket's benchmarks it actually has
// (percentile, not raw %, so a 90% GPQA and a 32% FrontierMath are comparable).
// All benchmarks here are "higher is better".

export type BucketKey = 'coding' | 'math' | 'reasoning' | 'agentic'

export interface Bucket {
  key: BucketKey
  label: string
  benchmarks: string[]
}

export const BUCKETS: Bucket[] = [
  {
    key: 'coding',
    label: 'Coding',
    benchmarks: ['SWE-bench Verified', 'Terminal-Bench', 'GSO (code optimization)', 'WebDev Arena'],
  },
  {
    key: 'math',
    label: 'Math',
    benchmarks: ['AIME 2024/2025', 'MATH Level 5', 'FrontierMath', 'FrontierMath Tier 4'],
  },
  {
    key: 'reasoning',
    label: 'Reasoning & Knowledge',
    benchmarks: [
      'GPQA Diamond',
      "Humanity's Last Exam",
      'SimpleQA Verified',
      'SimpleBench',
      'ARC-AGI',
      'ARC-AGI-2',
      'WeirdML',
    ],
  },
  {
    key: 'agentic',
    label: 'Agentic & Tools',
    benchmarks: ['Terminal-Bench', 'APEX', 'METR task horizon', 'GDPval (win/tie rate)'],
  },
]

// Tabs shown on the leaderboard. "Newest" (default) leads with recency — our
// calendar identity, and it surfaces this week's releases that aren't benchmarked
// yet instead of burying them. "Overall" ranks by ECI; the rest rank by use case.
export const TABS = [
  { key: 'newest' as const, label: 'Newest' },
  { key: 'overall' as const, label: 'Overall' },
  ...BUCKETS.map((b) => ({ key: b.key, label: b.label })),
]

export type TabKey = 'newest' | 'overall' | BucketKey

// Max models in one comparison / chart spotlight. Shared so the leaderboard
// checkboxes and the chart picker enforce the same "my models" set.
export const MAX_COMPARE = 4
