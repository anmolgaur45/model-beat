'use client'

import type { Category } from '@/types/article'
import { CATEGORY_LABELS, CATEGORY_ORDER } from './categoryMeta'

export type CategoryOption = Category | 'all'

interface Props {
  selected: CategoryOption
  onChange: (cat: CategoryOption) => void
}

export function CategoryFilter({ selected, onChange }: Props) {
  return (
    <div className="anc-cats">
      {CATEGORY_ORDER.map((cat) => (
        <button
          key={cat}
          className={`anc-pill${selected === cat ? ' active' : ''}`}
          onClick={() => onChange(cat)}
          suppressHydrationWarning
        >
          {CATEGORY_LABELS[cat]}
        </button>
      ))}
    </div>
  )
}
