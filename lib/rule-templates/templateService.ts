import 'server-only'

import { prisma } from '@/lib/prisma'
import { buildTemplatePayloadFromLeague } from '@/lib/league-templates/buildTemplatePayloadFromLeague'
import {
  describeRecipe,
  readRecipe,
  readShare,
  recipeFromLeague,
  recipeFromLegacyPayload,
  recordUse,
  stateFromRecipe,
  type TemplateRecipe,
} from './recipe'
import type { CreateLeagueV2State } from '@/lib/create-league-v2/state'

/**
 * Rule templates library — reads and writes. Rules in ./recipe.
 *
 * Storage is the existing `LeagueTemplate` row; the recipe and the sharing state live in its `payload`
 * JSON (`payload.recipe`, `payload.share`), so there is no migration. The public library filters on
 * `payload.share.public` with a JSON path query.
 *
 * ⚠ A PUBLIC TEMPLATE NEVER SERVES ITS PAYLOAD. The legacy half of the payload still carries a copy of
 * the source league's settings (sanitized, but private by intent). Public reads return the name,
 * description, tags, use count and author — and starting from one rebuilds wizard state from the
 * recipe alone.
 */

export async function saveTemplateFromLeague(
  userId: string,
  input: { leagueId: string; name?: string; description?: string | null },
): Promise<{ ok: true; template: { id: string; name: string; description: string | null; payload: unknown } } | { ok: false; error: 'not_found' }> {
  const league = await prisma.league.findFirst({
    where: { id: input.leagueId, userId },
    select: {
      id: true, name: true, sport: true, leagueSize: true, leagueVariant: true, leagueType: true, scoring: true, scoringPresetId: true,
      isDynasty: true, rosterSize: true, settings: true, medianGame: true,
      keeperCount: true, keeperMaxYears: true, keeperRoundPenalty: true, keeperWaiverAllowed: true, keeperEligibilityRule: true,
      leagueSettings: { select: { draftType: true } },
    },
  })
  if (!league) return { ok: false, error: 'not_found' }
  const [dynastyConfig, waiver] = await Promise.all([
    prisma.dynastyLeagueConfig.findUnique({ where: { leagueId: league.id } }).catch(() => null),
    prisma.leagueWaiverSettings.findUnique({ where: { leagueId: league.id }, select: { waiverType: true, faabBudget: true } }).catch(() => null),
  ])
  const recipe = recipeFromLeague({
    sport: String(league.sport),
    leagueType: league.leagueType,
    leagueVariant: league.leagueVariant,
    leagueSize: league.leagueSize,
    scoringPresetId: league.scoringPresetId,
    medianGame: league.medianGame,
    draftType: league.leagueSettings?.draftType ?? null,
    dynastyConfig,
    waiver,
    keeper: league,
  })
  const legacy = buildTemplatePayloadFromLeague({ ...league, sport: String(league.sport) })
  const name = (input.name?.trim() || league.name?.trim() || 'League template').slice(0, 120)
  const description = input.description != null ? String(input.description).trim().slice(0, 500) || null : null
  const template = await prisma.leagueTemplate.create({
    data: { userId, name, description, payload: { ...legacy, recipe, share: { public: false, uses: 0, usedBy: [] } } as object },
    select: { id: true, name: true, description: true, payload: true },
  })
  return { ok: true, template }
}

const recipeOf = (payload: unknown): TemplateRecipe | null => readRecipe(payload) ?? recipeFromLegacyPayload(payload)

export type LibraryCard = {
  id: string
  name: string
  description: string | null
  tags: string[]
  uses: number
  author: string
  isMine: boolean
}

export async function listPublicTemplates(viewerId: string | null, opts: { sport?: string | null; sort?: 'popular' | 'new'; limit?: number } = {}): Promise<LibraryCard[]> {
  const limit = Math.min(60, Math.max(1, opts.limit ?? 30))
  const rows = await prisma.leagueTemplate.findMany({
    where: { payload: { path: ['share', 'public'], equals: true } },
    orderBy: { updatedAt: 'desc' },
    take: 300,
    select: { id: true, userId: true, name: true, description: true, payload: true, updatedAt: true },
  })
  const authors = await prisma.appUser.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, displayName: true, username: true } }).catch(() => [])
  const nameOf = new Map(authors.map((a) => [a.id, a.displayName?.trim() || a.username?.trim() || 'A commissioner']))
  const cards = rows.flatMap((r) => {
    const recipe = recipeOf(r.payload)
    if (!recipe) return []
    if (opts.sport && recipe.sport.toUpperCase() !== opts.sport.toUpperCase()) return []
    return [{ id: r.id, name: r.name, description: r.description, tags: describeRecipe(recipe), uses: readShare(r.payload).uses, author: nameOf.get(r.userId) ?? 'A commissioner', isMine: r.userId === viewerId, updatedAt: r.updatedAt.getTime() }]
  })
  cards.sort((a, b) => (opts.sort === 'new' ? b.updatedAt - a.updatedAt : b.uses - a.uses || b.updatedAt - a.updatedAt))
  return cards.slice(0, limit).map(({ updatedAt: _u, ...c }) => c)
}

export type UseTemplateResult =
  | { ok: true; name: string; state: CreateLeagueV2State; tags: string[] }
  | { ok: false; error: 'not_found' }

/**
 * Wizard state for starting a league from a template the viewer owns or that is public. A private
 * template someone else owns is `not_found` — its id is not proof of access.
 */
export async function startFromTemplate(templateId: string, userId: string): Promise<UseTemplateResult> {
  const row = await prisma.leagueTemplate.findUnique({ where: { id: templateId }, select: { id: true, userId: true, name: true, payload: true } })
  if (!row) return { ok: false, error: 'not_found' }
  const share = readShare(row.payload)
  if (row.userId !== userId && !share.public) return { ok: false, error: 'not_found' }
  const recipe = recipeOf(row.payload)
  if (!recipe) return { ok: false, error: 'not_found' }
  const next = recordUse(share, userId, row.userId)
  if (next) await bumpUse(row.id, userId, row.userId).catch(() => {})
  return { ok: true, name: row.name, state: stateFromRecipe(recipe), tags: describeRecipe(recipe) }
}

/** Read-modify-write under a row lock so two starts at once both count. */
async function bumpUse(templateId: string, userId: string, ownerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM league_templates WHERE id = ${templateId} FOR UPDATE`
    const row = await tx.leagueTemplate.findUnique({ where: { id: templateId }, select: { payload: true } })
    if (!row) return
    const next = recordUse(readShare(row.payload), userId, ownerId)
    if (!next) return
    await tx.leagueTemplate.update({ where: { id: templateId }, data: { payload: { ...(row.payload as object), share: next } as object } })
  })
}

export async function setTemplatePublic(templateId: string, ownerId: string, on: boolean): Promise<{ ok: true; public: boolean } | { ok: false; error: 'not_found' | 'forbidden' | 'no_recipe' }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM league_templates WHERE id = ${templateId} FOR UPDATE`
    const row = await tx.leagueTemplate.findUnique({ where: { id: templateId }, select: { userId: true, payload: true } })
    if (!row) return { ok: false as const, error: 'not_found' as const }
    if (row.userId !== ownerId) return { ok: false as const, error: 'forbidden' as const }
    if (on && !recipeOf(row.payload)) return { ok: false as const, error: 'no_recipe' as const }
    await tx.leagueTemplate.update({ where: { id: templateId }, data: { payload: { ...(row.payload as object), share: { ...readShare(row.payload), public: on } } as object } })
    return { ok: true as const, public: on }
  })
}
