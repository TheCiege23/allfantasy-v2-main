/**
 * Chimmy's season recap — the written-up story of a finished season, for AF Commissioner leagues.
 *
 * GATE. Writing one is the commissioner's (or co-commissioner's) and needs AF Commissioner — the same
 * `commissioner_automation` check Storyline Studio uses (`storylineEntitled`); the route enforces both.
 * Once written it is the LEAGUE's recap, read by every member from the same cache, the way a Storyline
 * Studio post is.
 *
 * FACTS ONLY. The model is handed `buildSeasonRecapFacts(recap)` and nothing else, told to use only
 * those, and its text must clear `validateSeasonRecapNarrative`. A refused or failed answer is replaced
 * by the deterministic recap written from the same facts — never shown as the model wrote it.
 *
 * PROVIDER. Through `routeTextCall` (lib/ai/providerRouter) — never a model SDK — so the spend kill
 * switch, provider fallback and metering all apply.
 *
 * CAP. The DB-backed daily cap (`lib/ai/dailyCaps`, `commissioner_brain`, AI_CAP_*_COMMISSIONER_BRAIN_DAILY)
 * is checked before the call and counted after a call that reached a model. A cache hit costs nothing.
 *
 * CACHE. One `LeagueStoryline` row per league, season and language, `storyType = 'season_recap_ai'`,
 * beside the stored recap itself (no new table, no migration). It carries the facts hash, so a recap
 * that changed (a re-finalize) is stale and is never served; `regenerate` writes a fresh one.
 */
import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { routeTextCall } from '@/lib/ai/providerRouter'
import { checkDailyCap, incrementDailyCap } from '@/lib/ai/dailyCaps'
import { hasProfanity } from '@/lib/chat-core/censorProfanity'
import { getSeasonRecap } from './seasonRecapService'
import type { SeasonRecap } from './computeSeasonRecap'
import {
  buildSeasonRecapFacts,
  deterministicSeasonRecapText,
  seasonRecapFactsHash,
  validateSeasonRecapNarrative,
  type RecapLanguage,
  type SeasonRecapFacts,
} from './seasonRecapFacts'

export const SEASON_RECAP_AI_STORY_TYPE = 'season_recap_ai'
export const SEASON_RECAP_AI_CAP_FEATURE = 'commissioner_brain' as const

export type SeasonRecapNarrative = {
  leagueId: string
  season: number
  lang: RecapLanguage
  factsHash: string
  /** With [[Name]] marks; the page renders them as names. */
  text: string
  /** 'ai' cleared the fact guard; 'template' is the deterministic recap (the guard refused, or no model answered). */
  source: 'ai' | 'template'
  generatedAt: string
  generatedByUserId: string | null
}

function isNarrative(v: unknown): v is SeasonRecapNarrative {
  const x = v as Partial<SeasonRecapNarrative> | null
  return !!x && typeof x === 'object' && typeof x.text === 'string' && typeof x.factsHash === 'string' && (x.lang === 'en' || x.lang === 'es')
}

async function findCachedRow(leagueId: string, season: number, lang: RecapLanguage) {
  const rows = await prisma.leagueStoryline.findMany({
    where: { leagueId, storyType: SEASON_RECAP_AI_STORY_TYPE, season },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, metadata: true },
  })
  return rows.find((r) => isNarrative(r.metadata) && r.metadata.lang === lang) ?? null
}

/** The cached narrative when it was written over THIS recap's facts; null when none or stale. */
export async function readCachedSeasonRecapNarrative(
  leagueId: string,
  season: number,
  lang: RecapLanguage,
  recap?: SeasonRecap,
): Promise<SeasonRecapNarrative | null> {
  const current = recap ?? (await getSeasonRecap(leagueId, season))?.recap
  if (!current) return null
  const row = await findCachedRow(leagueId, season, lang)
  if (!row || !isNarrative(row.metadata)) return null
  const hash = seasonRecapFactsHash(buildSeasonRecapFacts(current), lang)
  return row.metadata.factsHash === hash ? row.metadata : null
}

export function buildSeasonRecapPrompt(f: SeasonRecapFacts, lang: RecapLanguage) {
  const system = `You write the end-of-season recap for a fantasy sports league, as Chimmy, the league's announcer.
RULES:
- Use ONLY the facts given. Do not add any team, player, result, injury, quote, trade or prediction that is not in them.
- Mark every team name and player name as [[Name]], spelled exactly as in the facts. Never mention any other name.
- Every number you write must be a value from the facts, written exactly as given. Do not compute new numbers.
- No guarantees, no "certainly". Talk about teams and their play; never insult a manager as a person. No profanity.
- Three short paragraphs at most, under 900 characters in total.
- Write in ${lang === 'es' ? 'Spanish. A claim for a free-agent player is «reclamo»; use «reclamo» and «agentes libres» only' : 'English'}.
- Output JSON only: {"text": "..."}`
  const user = `Season: ${f.season}
Allowed names: ${JSON.stringify(f.names)}
Facts (JSON): ${JSON.stringify(f.facts)}`
  return { system, user }
}

function parseModelText(raw: string): string | null {
  const t = raw.trim()
  const body = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try {
    const parsed = JSON.parse(body) as { text?: unknown }
    return typeof parsed.text === 'string' ? parsed.text.trim() : null
  } catch {
    return null
  }
}

export type GenerateDeps = {
  route?: typeof routeTextCall
  checkCap?: typeof checkDailyCap
  incrementCap?: typeof incrementDailyCap
  loadRecap?: typeof getSeasonRecap
  now?: () => Date
}

export type GenerateResult =
  | { ok: true; narrative: SeasonRecapNarrative; cached: boolean; factGuardErrors: string[] }
  | { ok: false; reason: 'no_recap' }
  | { ok: false; reason: 'daily_cap'; message: string; resetsAt: string; limit: number }

/**
 * The narrative for a league's season: the cached one when it is current (no model call, no cap),
 * else a fresh one, cap-checked, fact-guarded and cached. The caller has already checked the
 * commissioner role and the AF Commissioner plan.
 */
export async function generateSeasonRecapNarrative(input: {
  leagueId: string
  season: number
  userId: string
  lang: RecapLanguage
  regenerate?: boolean
  deps?: GenerateDeps
}): Promise<GenerateResult> {
  const d = input.deps ?? {}
  const loaded = await (d.loadRecap ?? getSeasonRecap)(input.leagueId, input.season)
  if (!loaded) return { ok: false, reason: 'no_recap' }
  const recap = loaded.recap
  const facts = buildSeasonRecapFacts(recap)
  const factsHash = seasonRecapFactsHash(facts, input.lang)
  const row = await findCachedRow(input.leagueId, input.season, input.lang)
  const cached = row && isNarrative(row.metadata) && row.metadata.factsHash === factsHash ? row.metadata : null
  if (cached && !input.regenerate) return { ok: true, narrative: cached, cached: true, factGuardErrors: [] }

  const cap = await (d.checkCap ?? checkDailyCap)(SEASON_RECAP_AI_CAP_FEATURE, input.userId, 'pro')
  if (!cap.allowed) {
    return { ok: false, reason: 'daily_cap', message: cap.message, resetsAt: cap.resetsAt.toISOString(), limit: cap.limit }
  }

  const { system, user } = buildSeasonRecapPrompt(facts, input.lang)
  const res = await (d.route ?? routeTextCall)({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens: 700,
    temperature: 0.5,
    feature: 'season_recap_ai',
    userId: input.userId,
    leagueId: input.leagueId,
  }).catch(() => ({ ok: false as const }))

  // A call that reached a model spent, whatever its text turns out to be worth.
  if (res.ok) await (d.incrementCap ?? incrementDailyCap)(SEASON_RECAP_AI_CAP_FEATURE, input.userId, 'pro').catch(() => {})

  const aiText = res.ok ? parseModelText(res.text) : null
  const check = aiText ? validateSeasonRecapNarrative(aiText, facts, { lang: input.lang, hasProfanity }) : null
  const passed = !!aiText && !!check?.passed
  const narrative: SeasonRecapNarrative = {
    leagueId: input.leagueId,
    season: input.season,
    lang: input.lang,
    factsHash,
    text: passed ? aiText! : deterministicSeasonRecapText(recap, input.lang),
    source: passed ? 'ai' : 'template',
    generatedAt: (d.now ?? (() => new Date()))().toISOString(),
    generatedByUserId: input.userId,
  }

  const data = {
    title: `${input.season} season recap (${input.lang})`.slice(0, 160),
    summary: narrative.text.slice(0, 300),
    body: narrative.text,
    metadata: narrative as unknown as Prisma.InputJsonValue,
    source: narrative.source === 'ai' ? 'ai' : 'engine',
  }
  if (row) await prisma.leagueStoryline.update({ where: { id: row.id }, data })
  else await prisma.leagueStoryline.create({ data: { leagueId: input.leagueId, season: input.season, storyType: SEASON_RECAP_AI_STORY_TYPE, ...data } })

  const factGuardErrors = passed ? [] : (check?.errors ?? ['No model answer.'])
  if (!passed) console.warn('[season-recap-ai] narrative refused; template used', { leagueId: input.leagueId, season: input.season, errors: factGuardErrors.slice(0, 5) })
  return { ok: true, narrative, cached: false, factGuardErrors }
}
