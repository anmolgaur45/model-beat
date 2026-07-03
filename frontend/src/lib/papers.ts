// A "paper cluster" is a story whose every source is arXiv — a raw paper
// listing, not news. Papers that DID get covered (paper + outlet in one
// cluster) fail this test and stay in the main story list on merit.
// getClusters computes paper_only over ALL members server-side; the article
// scan is the fallback for payloads without the flag, and is capped at the top
// 3 articles by significance_base, so it can misjudge large mixed clusters.
export function isPaperCluster(c: { paper_only?: boolean; articles?: { source_name: string }[] }): boolean {
  if (typeof c.paper_only === 'boolean') return c.paper_only
  const arts = c.articles ?? []
  if (arts.length === 0) return false
  return arts.every((a) => a.source_name.startsWith('arXiv'))
}
