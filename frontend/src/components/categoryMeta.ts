import type { Category } from '@/types/article'

export const CATEGORY_LABELS: Record<Category | 'all', string> = {
  all: 'All',
  'model-releases': 'Models',
  'research-papers': 'Research',
  'company-news': 'Industry',
  'product-launches': 'Products',
  'regulation-policy': 'Policy',
  'hardware-infrastructure': 'Hardware',
  'open-source': 'Open Source',
  'opinion-analysis': 'Opinion',
  uncategorized: 'Other',
}

export const CATEGORY_ORDER: (Category | 'all')[] = [
  'all',
  'model-releases',
  'research-papers',
  'company-news',
  'product-launches',
  'regulation-policy',
  'hardware-infrastructure',
  'open-source',
  'opinion-analysis',
]
