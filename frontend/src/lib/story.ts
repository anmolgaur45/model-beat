// Story permalink helpers. The uuid is the authoritative segment of a story
// URL; the headline slug is decorative and ignored on resolve (the canonical
// tag normalizes it), so it can change freely when a cluster's headline is
// re-picked by the pipeline without breaking links already shared.

export function slugifyHeadline(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}

// Canonical path for a story: /story/<id>/<slug> (slug dropped if empty).
export function storyPath(cluster: { id: string; headline: string }): string {
  const slug = slugifyHeadline(cluster.headline)
  return slug ? `/story/${cluster.id}/${slug}` : `/story/${cluster.id}`
}

// Ready-to-paste share text: headline + our own summary + link. Falls back to
// headline + link when there's no summary (never pastes a source excerpt as the
// user's words — copyright). Used for the clipboard hand-off to LinkedIn and the
// card share button, since LinkedIn no longer allows prefilling the post body.
export function buildShareBlurb(headline: string, summary: string | null, url: string): string {
  const body = (summary ?? '').trim().slice(0, 400)
  return body ? `${headline}\n\n${body}\n\n${url}` : `${headline}\n\n${url}`
}
