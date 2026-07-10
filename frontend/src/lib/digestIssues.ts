import fs from 'fs'
import path from 'path'
import { marked } from 'marked'

// Phase W4: sent digest issues as pages. Issues live as committed markdown in
// content/digest/YYYY-MM-DD.md (frontmatter: title, date, preview) — the SEO
// archive and sponsor proof. Published by the /digest skill's post-send step;
// no CMS, no DB. All fs reads happen at build (static pages) or are covered
// by outputFileTracingIncludes in next.config.ts.

const CONTENT_DIR = path.join(process.cwd(), 'content', 'digest')
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface DigestIssueMeta {
  date: string // YYYY-MM-DD, also the slug
  title: string
  preview: string
}

// Minimal frontmatter parser (title/date/preview, one line each) — not worth
// a gray-matter dependency. Pure, so Vitest covers it without fs.
export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: raw }
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i === -1) continue
    const key = line.slice(0, i).trim()
    let val = line.slice(i + 1).trim()
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
    if (key) meta[key] = val
  }
  return { meta, body: m[2] }
}

export function listIssues(): DigestIssueMeta[] {
  let files: string[]
  try {
    files = fs.readdirSync(CONTENT_DIR)
  } catch {
    return []
  }
  return files
    .filter((f) => f.endsWith('.md') && DATE_RE.test(f.slice(0, -3)))
    .map((f) => {
      const date = f.slice(0, -3)
      const { meta } = parseFrontmatter(fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8'))
      return { date, title: meta.title ?? `The Model Beat Digest, ${date}`, preview: meta.preview ?? '' }
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}

export function getIssue(date: string): { meta: DigestIssueMeta; html: string } | null {
  if (!DATE_RE.test(date)) return null
  let raw: string
  try {
    raw = fs.readFileSync(path.join(CONTENT_DIR, `${date}.md`), 'utf8')
  } catch {
    return null
  }
  const { meta, body } = parseFrontmatter(raw)
  const html = marked.parse(body, { async: false })
  return {
    meta: { date, title: meta.title ?? `The Model Beat Digest, ${date}`, preview: meta.preview ?? '' },
    html,
  }
}
