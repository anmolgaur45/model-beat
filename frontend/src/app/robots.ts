import type { MetadataRoute } from 'next'
import { SITE_URL as SITE } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
  return {
    // The compare tool's ?ids= states are noindex and render on every hit;
    // the curated /models/compare/<pair> pages are the indexable ones.
    rules: { userAgent: '*', allow: '/', disallow: '/models/compare?' },
    sitemap: `${SITE}/sitemap.xml`,
  }
}
