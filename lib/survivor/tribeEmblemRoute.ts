import 'server-only'
import { createHash } from 'node:crypto'
import {
  TRIBE_KITS, TRIBE_SPORT_KIT, buildTribeCrest, buildTribeMark, findTribeCatalogEntry, normalizeTribeHex, sanitizeTribeName,
  type TribeKit, type TribeSport,
} from './tribeEmblemComposer'

const MAX_CACHE = 600
const cache = new Map<string, { svg: string; etag: string }>()
const ALLOWED_PARAMS = new Set(['tribe', 'sport', 'kit', 'p', 's', 'name', 'v'])
const MAX_RAW_NAME = 128

export type TribeEmblemResult =
  | { ok: true; status: 200 | 304; svg: string; headers: Record<string, string> }
  | { ok: false; status: 400 | 404; error: string }

function remember(key: string, value: { svg: string; etag: string }) {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string)
  cache.set(key, value)
}

/**
 * Validates and canonicalises the request, composes (or reuses) the SVG, and returns strongly-cacheable
 * headers. Unknown/ill-formed inputs are rejected, never coerced into markup.
 */
export function renderTribeEmblemRequest(kind: string, params: URLSearchParams, ifNoneMatch?: string | null): TribeEmblemResult {
  if (kind !== 'crest' && kind !== 'mark') return { ok: false, status: 404, error: 'Unknown emblem type.' }
  for (const key of params.keys()) if (!ALLOWED_PARAMS.has(key)) return { ok: false, status: 400, error: 'Unknown parameter.' }
  for (const key of ALLOWED_PARAMS) if (params.getAll(key).length > 1) return { ok: false, status: 400, error: 'Repeated parameter.' }
  const tribe = findTribeCatalogEntry(params.get('tribe'))
  if (!tribe) return { ok: false, status: 404, error: 'Unknown tribe.' }

  const colors: { primary?: string; secondary?: string } = {}
  for (const [param, field] of [['p', 'primary'], ['s', 'secondary']] as const) {
    const raw = params.get(param)
    if (raw == null) continue
    const hex = /^[0-9a-fA-F]{6}$/.test(raw) ? normalizeTribeHex(raw) : null
    if (!hex) return { ok: false, status: 400, error: 'Colours must be six-digit hex.' }
    colors[field] = hex
  }

  let target: string
  if (kind === 'crest') {
    const sport = (params.get('sport') ?? '').toLowerCase()
    if (!(sport in TRIBE_SPORT_KIT)) return { ok: false, status: 400, error: 'Unknown sport.' }
    target = sport
  } else {
    const kit = (params.get('kit') ?? '').toLowerCase()
    if (!TRIBE_KITS.includes(kit as TribeKit)) return { ok: false, status: 400, error: 'Unknown kit.' }
    target = kit
  }

  const rawName = params.get('name')
  if (rawName != null && rawName.length > MAX_RAW_NAME) return { ok: false, status: 400, error: 'Name is too long.' }
  const name = kind === 'crest' ? sanitizeTribeName(rawName) ?? tribe.name : tribe.name

  const key = JSON.stringify([kind, tribe.id, target, colors.primary ?? tribe.primary, colors.secondary ?? tribe.secondary, name])
  let entry = cache.get(key)
  if (!entry) {
    const svg = kind === 'crest'
      ? buildTribeCrest({ tribe, sport: target as TribeSport, colors, name })
      : buildTribeMark({ tribe, kit: target as TribeKit, colors })
    entry = { svg, etag: `"${createHash('sha256').update(svg).digest('base64url').slice(0, 27)}"` }
    remember(key, entry)
  }
  const headers = {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: entry.etag,
    'X-Content-Type-Options': 'nosniff',
    // Defence in depth if the SVG is ever opened directly: no script, no external loads.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  }
  if (ifNoneMatch && ifNoneMatch.split(',').map(s => s.trim()).includes(entry.etag)) return { ok: true, status: 304, svg: '', headers }
  return { ok: true, status: 200, svg: entry.svg, headers }
}
