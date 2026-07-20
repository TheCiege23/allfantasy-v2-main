import fs from 'fs'
import path from 'path'

// Must live under `data/` so `outputFileTracingIncludes` ("/api/**": ["./data/**"])
// ships these files with the serverless bundle. Docs must also be committed and
// survive .vercelignore, or they load in dev and silently read empty in prod.
const VALUES_DIR = path.join(process.cwd(), 'data', 'player-values')

function inferSportFromFilename(lower: string): string {
  if (lower.includes('nba')) return 'NBA'
  if (lower.includes('mlb')) return 'MLB'
  if (lower.includes('nhl')) return 'NHL'
  if (lower.includes('ncaab') || lower.includes('cbb') || lower.includes('college-basketball')) return 'NCAAB'
  if (lower.includes('ncaaf') || lower.includes('cfb') || lower.includes('college-football')) return 'NCAAF'
  if (lower.includes('soccer') || lower.includes('epl') || lower.includes('mls')) return 'SOCCER'
  return 'NFL'
}

function inferFormatFromFilename(lower: string): string {
  if (lower.includes('dynasty')) return 'dynasty'
  if (lower.includes('bestball') || lower.includes('best-ball') || lower.includes('best_ball')) return 'bestball'
  if (lower.includes('redraft')) return 'redraft'
  return 'general'
}

export type PlayerValueDoc = {
  filename: string
  sport: string
  format: string
  content: string
}

export type PlayerValueDocMeta = {
  filename: string
  sport: string
  format: string
  lastModified: string
}

function isValueDocFile(f: string): boolean {
  // README.md documents the folder itself; it is not player-value data and must
  // never be injected into an LLM prompt as if it were.
  if (f.toLowerCase() === 'readme.md') return false

  return (
    (f.endsWith('.md') ||
      f.endsWith('.txt') ||
      f.endsWith('.csv') ||
      f.endsWith('.json')) &&
    !f.startsWith('.')
  )
}

export function loadPlayerValueDocs(): PlayerValueDoc[] {
  try {
    if (!fs.existsSync(VALUES_DIR)) return []

    return fs
      .readdirSync(VALUES_DIR)
      .filter(isValueDocFile)
      .sort()
      .reverse()
      .map((filename) => {
        const lower = filename.toLowerCase()
        return {
          filename,
          sport: inferSportFromFilename(lower),
          format: inferFormatFromFilename(lower),
          content: fs.readFileSync(path.join(VALUES_DIR, filename), 'utf-8').slice(0, 8000),
        }
      })
  } catch {
    return []
  }
}

export function listPlayerValueDocMeta(): PlayerValueDocMeta[] {
  try {
    if (!fs.existsSync(VALUES_DIR)) return []

    return fs
      .readdirSync(VALUES_DIR)
      .filter(isValueDocFile)
      .sort()
      .reverse()
      .map((filename) => {
        const lower = filename.toLowerCase()
        const stat = fs.statSync(path.join(VALUES_DIR, filename))
        return {
          filename,
          sport: inferSportFromFilename(lower),
          format: inferFormatFromFilename(lower),
          lastModified: stat.mtime.toISOString(),
        }
      })
  } catch {
    return []
  }
}

function matchesFilters(
  d: PlayerValueDoc,
  opts?: { sport?: string; format?: string }
): boolean {
  if (!opts) return true
  if (opts.sport && d.sport !== opts.sport) return false
  if (opts.format && d.format !== opts.format && d.format !== 'general') return false
  return true
}

/** Ready-to-inject block for LLM system prompts. */
export function getPlayerValuesContext(opts?: { sport?: string; format?: string }): string {
  const docs = loadPlayerValueDocs()
  if (!docs.length) return ''

  const filtered = opts ? docs.filter((d) => matchesFilters(d, opts)) : docs

  if (!filtered.length) return ''

  const header = '## Current Player Values & Rankings\n\n'
  const body = filtered.map((d) => `### ${d.filename}\n\n${d.content}`).join('\n\n---\n\n')

  return header + body
}
