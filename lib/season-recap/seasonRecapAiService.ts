/**
 * Chimmy's written season recap — the AF Commissioner add-on on top of the free recap and awards.
 *
 * WHO. Generating it is the commissioner's (or a co-commissioner's) and needs AF Commissioner: the SAME
 * gate as Storyline Studio — `getLeagueRole` for the role, `storylineEntitled` (`commissioner_automation`)
 * for the plan. Reading a recap that has been written is every member's: it is the league's history.
 *
 * WHAT. The model gets the recap's facts (./seasonRecapFacts.ts) and nothing else, through the provider
 * router (`writeSeasonRecapFromFacts`), and its text is kept only if `validateSeasonRecapText` passes —
 * every number one of the facts, the champion named, no invented claim, Spanish says «reclamo». A text
 * that fails is refused and NOT stored: the free recap stays the page, and nothing wrong is cached.
 *
 * CAPS. Each model call counts against the existing per-user daily cap `commissioner_brain` (DB-backed
 * on `apiRateLimitRecord`, lib/ai/dailyCaps.ts) at the `pro` tier — the plan is already required, so a
 * subscriber is never on the free tier's 0. A cache hit calls nothing and counts nothing. A refused text
 * still counts: the call was made.
 *
 * WHERE IT IS KEPT. In `league_storylines`, the table that already holds a league's generated season
 * documents (weekly storylines, the constitution, the recap itself): one row per league and season,
 * `storyType = 'season_recap_ai'`, each language's text in `metadata.texts[lang]` with the facts hash it
 * was written from. Reopening the page reads that row; a re-finalize that changes the facts changes the
 * hash, and the stale text is not served (the commissioner can write it again). No new table.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { checkDailyCap, incrementDailyCap } from '@/lib/ai/dailyCaps'
import { hasProfanity } from '@/lib/chat-core/censorProfanity'
import { writeSeasonRecapFromFacts, type SeasonRecapWriting } from '@/lib/league-story-creator/OneBrainNarrativeComposer'
import { validateSeasonRecapText } from '@/lib/league-story-creator/StoryFactGuard'
import { storylineEntitled, storylineUpgradePath } from '@/lib/storyline-studio/storylineService'
import type { SeasonRecap } from './computeSeasonRecap'
import { buildSeasonRecapFacts, requiredRecapNames, seasonRecapFactsHash, type RecapFact } from './seasonRecapFacts'
import { getSeasonRecap } from './seasonRecapService'

export const SEASON_RECAP_AI_STORY_TYPE = 'season_recap_ai'
const CAP_FEATURE = 'commissioner_brain' as const
const CAP_TIER = 'pro' as const

export type RecapLanguage = 'en' | 'es'

export type SeasonRecapWriteup = {
  language: RecapLanguage
  headline: string
  paragraphs: string[]
  factsHash: string
  generatedAt: string
  generatedByUserId: string
}

type StoredDoc = { version: 1; leagueId: string; season: number; texts: Partial<Record<RecapLanguage, SeasonRecapWriteup>> }

/** What the recap page needs to show the written recap, the generate button, or the upsell. */
export type SeasonRecapWriteupView = {
  writeup: SeasonRecapWriteup | null
  isCommissioner: boolean
  entitled: boolean
  upgradePath: string | null
}

export type GenerateWriteupResult =
  | { ok: true; writeup: SeasonRecapWriteup; cached: boolean }
  | { ok: false; error: 'not_found' | 'commissioner_only' | 'not_entitled'; upgradePath?: string | null }
  | { ok: false; error: 'daily_cap'; message: string; resetsAt: string; upgradePath: string }
  | { ok: false; error: 'no_text' }
  | { ok: false; error: 'fact_guard'; factGuardErrors: string[] }

/** Injected in tests; production uses the real gate, cap, model and store. */
export type WriteupDeps = {
  role?: typeof getLeagueRole
  entitled?: (userId: string) => Promise<boolean>
  upgradePath?: (userId: string) => Promise<string | null>
  loadRecap?: (leagueId: string, season: number) => Promise<SeasonRecap | null>
  leagueName?: (leagueId: string) => Promise<string | null>
  checkCap?: (userId: string) => Promise<{ allowed: boolean; message: string; resetsAt: Date; upgradePath: string }>
  countCall?: (userId: string) => Promise<void>
  write?: typeof writeSeasonRecapFromFacts
  readDoc?: (leagueId: string, season: number) => Promise<StoredDoc | null>
  saveDoc?: (doc: StoredDoc, headline: string, body: string) => Promise<void>
  now?: () => Date
}

function isWriteup(v: unknown): v is SeasonRecapWriteup {
  const w = v as Partial<SeasonRecapWriteup> | null
  return !!w && typeof w.headline === 'string' && Array.isArray(w.paragraphs) && typeof w.factsHash === 'string'
}

async function readDocFromDb(leagueId: string, season: number): Promise<StoredDoc | null> {
  const row = await prisma.leagueStoryline.findFirst({
    where: { leagueId, storyType: SEASON_RECAP_AI_STORY_TYPE, season },
    orderBy: { updatedAt: 'desc' },
    select: { metadata: true },
  })
  const m = row?.metadata as Partial<StoredDoc> | null | undefined
  if (!m || typeof m !== 'object' || m.leagueId !== leagueId || m.season !== season || !m.texts || typeof m.texts !== 'object') return null
  const texts: StoredDoc['texts'] = {}
  for (const lang of ['en', 'es'] as const) if (isWriteup(m.texts[lang])) texts[lang] = m.texts[lang]
  return { version: 1, leagueId, season, texts }
}

async function saveDocToDb(doc: StoredDoc, headline: string, body: string): Promise<void> {
  const data = {
    title: `${doc.season} season recap, written`.slice(0, 160),
    summary: headline,
    body,
    metadata: doc as unknown as Prisma.InputJsonValue,
    source: 'ai',
  }
  const existing = await prisma.leagueStoryline.findFirst({
    where: { leagueId: doc.leagueId, storyType: SEASON_RECAP_AI_STORY_TYPE, season: doc.season },
    select: { id: true },
  })
  if (existing) await prisma.leagueStoryline.update({ where: { id: existing.id }, data })
  else await prisma.leagueStoryline.create({ data: { leagueId: doc.leagueId, season: doc.season, storyType: SEASON_RECAP_AI_STORY_TYPE, ...data } })
}

async function leagueNameFromDb(leagueId: string): Promise<string | null> {
  const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true } })
  return row?.name ?? null
}

function resolve(deps: WriteupDeps) {
  return {
    role: deps.role ?? getLeagueRole,
    entitled: deps.entitled ?? ((u: string) => storylineEntitled(u)),
    upgradePath: deps.upgradePath ?? storylineUpgradePath,
    loadRecap: deps.loadRecap ?? (async (l: string, s: number) => (await getSeasonRecap(l, s))?.recap ?? null),
    leagueName: deps.leagueName ?? leagueNameFromDb,
    checkCap: deps.checkCap ?? ((u: string) => checkDailyCap(CAP_FEATURE, u, CAP_TIER)),
    countCall: deps.countCall ?? ((u: string) => incrementDailyCap(CAP_FEATURE, u, CAP_TIER)),
    write: deps.write ?? writeSeasonRecapFromFacts,
    readDoc: deps.readDoc ?? readDocFromDb,
    saveDoc: deps.saveDoc ?? saveDocToDb,
    now: deps.now ?? (() => new Date()),
  }
}

async function factsFor(d: ReturnType<typeof resolve>, recap: SeasonRecap, leagueId: string): Promise<{ facts: RecapFact[]; hash: string }> {
  const facts = buildSeasonRecapFacts(recap, await d.leagueName(leagueId).catch(() => null))
  return { facts, hash: seasonRecapFactsHash(facts) }
}

/** The stored text for this language, but only when it was written from the recap's current facts. */
export async function readSeasonRecapWriteup(
  leagueId: string,
  season: number,
  recap: SeasonRecap,
  language: RecapLanguage,
  deps: WriteupDeps = {},
): Promise<SeasonRecapWriteup | null> {
  const d = resolve(deps)
  const doc = await d.readDoc(leagueId, season).catch(() => null)
  const stored = doc?.texts[language]
  if (!stored) return null
  const { hash } = await factsFor(d, recap, leagueId)
  return stored.factsHash === hash ? stored : null
}

/** The page's view: the written recap if any, and whether this viewer may write it or sees the upsell. */
export async function seasonRecapWriteupView(
  leagueId: string,
  season: number,
  recap: SeasonRecap,
  userId: string,
  language: RecapLanguage,
  deps: WriteupDeps = {},
): Promise<SeasonRecapWriteupView> {
  const d = resolve(deps)
  const [writeup, role] = await Promise.all([readSeasonRecapWriteup(leagueId, season, recap, language, deps), d.role(leagueId, userId)])
  const isCommissioner = role === 'commissioner' || role === 'co_commissioner'
  const entitled = isCommissioner ? await d.entitled(userId) : false
  const upgradePath = isCommissioner && !entitled ? await d.upgradePath(userId).catch(() => null) : null
  return { writeup, isCommissioner, entitled, upgradePath }
}

/**
 * Write (or return the stored) recap. Order matters: role, then plan, then the cache — a cache hit
 * calls no model and counts nothing — then the daily cap, the model, the guard, and only then the store.
 * `regenerate` skips the cache read (and so is capped like any call).
 */
export async function generateSeasonRecapWriteup(
  args: { leagueId: string; season: number; userId: string; language: RecapLanguage; regenerate?: boolean },
  deps: WriteupDeps = {},
): Promise<GenerateWriteupResult> {
  const d = resolve(deps)
  const { leagueId, season, userId, language } = args
  const role = await d.role(leagueId, userId)
  if (role === null) return { ok: false, error: 'not_found' }
  if (role !== 'commissioner' && role !== 'co_commissioner') return { ok: false, error: 'commissioner_only' }
  if (!(await d.entitled(userId))) return { ok: false, error: 'not_entitled', upgradePath: await d.upgradePath(userId).catch(() => null) }

  const recap = await d.loadRecap(leagueId, season)
  if (!recap) return { ok: false, error: 'not_found' }
  const { facts, hash } = await factsFor(d, recap, leagueId)

  const doc = (await d.readDoc(leagueId, season).catch(() => null)) ?? { version: 1 as const, leagueId, season, texts: {} }
  const stored = doc.texts[language]
  if (!args.regenerate && stored && stored.factsHash === hash) return { ok: true, writeup: stored, cached: true }

  const cap = await d.checkCap(userId)
  if (!cap.allowed) return { ok: false, error: 'daily_cap', message: cap.message, resetsAt: cap.resetsAt.toISOString(), upgradePath: cap.upgradePath }

  let written: SeasonRecapWriting | null = null
  try {
    written = await d.write({ facts, language, userId, leagueId })
  } catch {
    written = null
  }
  await d.countCall(userId).catch(() => undefined)
  if (!written) return { ok: false, error: 'no_text' }

  const fullText = [written.headline, ...written.paragraphs].join('\n\n')
  const check = validateSeasonRecapText(fullText, facts, { requiredNames: requiredRecapNames(recap), language, hasProfanity })
  if (!check.passed) return { ok: false, error: 'fact_guard', factGuardErrors: check.errors }

  const writeup: SeasonRecapWriteup = {
    language,
    headline: written.headline,
    paragraphs: written.paragraphs,
    factsHash: hash,
    generatedAt: d.now().toISOString(),
    generatedByUserId: userId,
  }
  const next: StoredDoc = { ...doc, texts: { ...doc.texts, [language]: writeup } }
  await d.saveDoc(next, writeup.headline, writeup.paragraphs.join('\n\n'))
  return { ok: true, writeup, cached: false }
}
