import NextLink from 'next/link'
import type { ComponentProps } from 'react'

// next/link prefetches every link that scrolls into view. On the pages that use
// this wrapper that came to ~110 KB of background fetches per homepage visit,
// ~340 KB on /models, and an uncached server render for each story link on
// screen, mostly for bots (2026-10-16 health check). Here the destination loads
// on click instead; pass `prefetch` to opt a link back in.
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />
}
