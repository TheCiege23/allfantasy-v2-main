import 'server-only'

import type { GrokChatRequest, GrokChatResponse } from '@/lib/ai-external/grok-types'
import { getGrokConfigFromEnv } from '@/lib/ai-external/grok'
import { listInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { prisma } from '@/lib/prisma'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

const DIGEST_TTL_SEC = 3600

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t))
}

function parseDigestJson(raw: string): { summary: string; bullets: string[] } | null {
  const trimmed = raw.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as { summary?: unknown; bullets?: unknown }
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
    const bullets = Array.isArray(parsed.bullets)
      ? parsed.bullets.map((b) => String(b).trim()).filter(Boolean).slice(0, 12)
      : []
    if (!summary && bullets.length === 0) return null
    return { summary: summary || 'Injury landscape update', bullets }
  } catch {
    return null
  }
}

async function buildDigestForSport(sport: string): Promise<{ summary: string; bullets: string[] } | null> {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000)
  const [newsRows, injuryRows] = await Promise.all([
    prisma.sportsNews.findMany({
      where: {
        sport,
        OR: [
          { category: { contains: 'injury', mode: 'insensitive' } },
          { title: { contains: 'injury', mode: 'insensitive' } },
          { title: { contains: 'questionable', mode: 'insensitive' } },
          { title: { contains: 'doubtful', mode: 'insensitive' } },
          { title: { contains: 'out', mode: 'insensitive' } },
        ],
        publishedAt: { gte: since },
      },
      orderBy: { publishedAt: 'desc' },
      take: 20,
      select: { title: true, source: true, playerName: true },
    }),
    // Canonical injury read port — TTL-respected, one row per player, freshest
    // source wins; same 48h window via maxAgeHours.
    listInjuryFacts({ sport, maxAgeHours: 48, limit: 25 })
      .then((l) => l.facts)
      .catch(() => []),
  ])

  if (newsRows.length === 0 && injuryRows.length === 0) return null

  const cfg = getGrokConfigFromEnv()
  if (!cfg) {
    return null
  }

  const headlines = newsRows.map((n) => `- ${n.title}${n.playerName ? ` (${n.playerName})` : ''}`).join('\n')
  const injuries = injuryRows
    .filter((r) => typeof r.status === 'string' && r.status.trim())
    .map((r) => `- ${r.playerName}${r.team ? ` ${r.team}` : ''}: ${r.status}${r.description ? ` — ${r.description.slice(0, 120)}` : ''}`)
    .join('\n')

  const body: GrokChatRequest = {
    model: cfg.model,
    temperature: 0.25,
    max_tokens: 700,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You summarize fantasy-relevant injury news only.',
          'Use ONLY the provided headlines and injury rows; do not invent players or teams.',
          'Output a single JSON object with keys "summary" (short paragraph) and "bullets" (array of short strings).',
          'Do not include waiver or trade advice. Status words like Out or Questionable are allowed.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            sport,
            headlines,
            injuryRows: injuries,
          },
          null,
          2
        ),
      },
    ],
  }

  const res = await fetchWithTimeout(
    cfg.baseUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    },
    cfg.timeoutMs ?? 12000
  )

  if (!res.ok) {
    console.warn('[grok-injury-digest] HTTP', res.status, await res.text().catch(() => ''))
    return null
  }

  const data = (await res.json()) as GrokChatResponse
  const content = data?.choices?.[0]?.message?.content ?? ''
  return parseDigestJson(content)
}

/**
 * Writes Grok injury digests to `SportsDataCache` under `grok_injury_digest:{SPORT}` for dashboard/API reads.
 */
export async function runGrokInjuryDigestWorker(): Promise<{ ok: boolean; sports: string[]; written: number }> {
  const cfg = getGrokConfigFromEnv()
  if (!cfg) {
    return { ok: false, sports: [], written: 0 }
  }

  let written = 0
  const sports: string[] = []

  for (const sport of SUPPORTED_SPORTS) {
    const digest = await buildDigestForSport(sport).catch(() => null)
    if (!digest) continue

    const cacheKey = `grok_injury_digest:${sport}`
    const expiresAt = new Date(Date.now() + DIGEST_TTL_SEC * 1000)
    await prisma.sportsDataCache.upsert({
      where: { cacheKey },
      update: {
        data: {
          summary: digest.summary,
          bullets: digest.bullets,
          generatedAt: new Date().toISOString(),
          sport,
        } as object,
        expiresAt,
      },
      create: {
        cacheKey,
        data: {
          summary: digest.summary,
          bullets: digest.bullets,
          generatedAt: new Date().toISOString(),
          sport,
        } as object,
        expiresAt,
      },
    })
    written += 1
    sports.push(sport)
  }

  return { ok: true, sports, written }
}
