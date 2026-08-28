import 'server-only'

import type { NormalizedStatusHit } from './types'
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'

function sportQuery(sport: string): string {
  const s = sport.toUpperCase()
  switch (s) {
    case 'NFL':
      return '(ruled out OR scratched OR inactive OR placed on IR) (NFL OR fantasy football) -questionable -probable'
    case 'NBA':
      return '(out tonight OR DNP OR inactive OR suspended) NBA'
    case 'MLB':
      return '(placed on IL OR 10-day IL OR 60-day IL OR suspended) MLB'
    case 'NHL':
      return '(placed on IR OR LTIR OR suspended) NHL'
    case 'NCAAF':
      return '(out OR suspended OR dismissed) (college football OR CFB)'
    case 'NCAAB':
      return '(out OR suspended OR dismissed) (college basketball OR CBB)'
    case 'SOCCER':
      return '(suspended OR injured OR out) (MLS OR Premier League OR La Liga)'
    default:
      return `injury ruled out inactive ${sport}`
  }
}

function parseGrokJson(content: string, defaultSport: string): NormalizedStatusHit[] {
  try {
    const parsed = JSON.parse(content) as { items?: unknown[] } | unknown[]
    const arr = Array.isArray(parsed) ? parsed : (parsed as { items?: unknown }).items
    if (!Array.isArray(arr)) return []
    const out: NormalizedStatusHit[] = []
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const playerName = String(r.playerName ?? r.name ?? '').trim()
      if (!playerName) continue
      const statusKeyword = String(r.statusKeyword ?? r.status ?? 'OUT').trim()
      const rawText = String(r.rawText ?? r.text ?? '').trim()
      const sourceUrl = typeof r.sourceUrl === 'string' ? r.sourceUrl : undefined
      const confidence = typeof r.confidence === 'number' ? Math.min(1, Math.max(0, r.confidence)) : 0.7
      const sp = String(r.sport ?? defaultSport).toUpperCase()
      out.push({
        playerName,
        sport: sp,
        status: statusKeyword,
        source: 'x_grok',
        confidence,
        sourceUrl: sourceUrl || undefined,
        rawText: rawText || undefined,
        gameDate: null,
      })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Uses xAI Grok chat completions to extract structured injury signals (optional; no key = skip).
 */
export async function searchXForInjuryNews(sport: string, gameDate: string): Promise<NormalizedStatusHit[]> {
  const apiKey = process.env.XAI_API_KEY?.trim() || process.env.GROK_API_KEY?.trim()
  // PROVIDER BOUNDARY. Guard form matches this function's own contract: it
  // already returns [] when the key is absent, so a spend refusal behaves
  // identically to an unconfigured provider. Above the key check because when
  // both are missing the switch is the actionable one.
  if (!isAiSpendEnabled()) return []

  if (!apiKey) {
    return []
  }

  const model = process.env.XAI_MODEL?.trim() || process.env.GROK_MODEL?.trim() || 'grok-2-latest'
  const queryHint = sportQuery(sport)

  try {
    const res = await fetch(`${process.env.XAI_BASE_URL?.trim() || 'https://api.x.ai/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content:
              'You are a sports injury signal extractor. Reply with JSON only: {"items":[{"playerName":"","sport":"NFL","rawText":"","statusKeyword":"OUT","sourceUrl":"","confidence":0.7}]}. Use realistic confidence 0.5-1.0. Omit uncertain/questionable/probable players.',
          },
          {
            role: 'user',
            content: `Sport context: ${sport}. Game date: ${gameDate}. Search intent: ${queryHint}. List players who are definitively OUT, IR, suspended, DNP, or otherwise inactive — not questionable.`,
          },
        ],
      }),
      cache: 'no-store',
    })

    if (!res.ok) {
      console.warn('[XGrokAdapter] chat completions failed:', res.status)
      return []
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content?.trim() ?? ''
    if (!content) return []

    const jsonMatch = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    const raw = jsonMatch ? jsonMatch[0] : content
    const hits = parseGrokJson(raw, sport)
    const seen = new Set<string>()
    const deduped: NormalizedStatusHit[] = []
    for (const h of hits.sort((a, b) => b.confidence - a.confidence)) {
      const k = `${h.playerName.toLowerCase()}|${h.status.toUpperCase()}`
      if (seen.has(k)) continue
      seen.add(k)
      deduped.push({ ...h, sport: sport.toUpperCase() })
    }
    return deduped
  } catch (e) {
    console.warn('[XGrokAdapter] error:', e)
    return []
  }
}
