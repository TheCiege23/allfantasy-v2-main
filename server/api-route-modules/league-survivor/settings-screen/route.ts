/**
 * GET/POST /api/leagues/[leagueId]/survivor/settings-screen — the commissioner Survivor settings
 * screen (survivor-core handoff §2). One read and one save over the settings the earlier packages
 * added (foundation settings, late-season settings, idol setup, tribe count, swap week), so a save
 * writes ONE audit-log entry.
 *
 * Rules, all enforced here rather than trusted from the client:
 *  - commissioner (or co-commissioner with settings rights) only;
 *  - after the draft starts only the vote deadline, the Exile boss and the two sharing switches
 *    change (lib/survivor/survivorSettingsScreen.ts SURVIVOR_SETTINGS_EDITABLE_ALL_SEASON);
 *  - the finalist count locks with a saved full-season plan, tribe count/formation with tribe
 *    assignment or a locked tribe plan;
 *  - the idol draw stays where IdolSetup put it: the idol count is saved through
 *    saveSurvivorIdolConfig, keeping its mode, picks and hide flag; the drawn types are never read.
 *  - the island banner scene (settings.survivorIslandScene) is optional in the form, editable all
 *    season, and must be one of SURVIVOR_ISLAND_SCENES or 'auto' (400 otherwise). Island control on
 *    the /core Commissioner screen saves it, and its inline rule edits, through this same POST.
 *  - house rules → League.settings.survivorHouseRules; weekly tribe prizes →
 *    League.settings.survivorWeeklyPrizes; harsh token loss → League.survivorExileHarshTokenLoss;
 *    merge naming → League.settings.mergeNamingMode (the late-season reader); co-commissioner mode,
 *    jury and tribe chats → the foundation settings.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'
import {
  buildSurvivorLeagueColumnPatch,
  buildSurvivorSettingsSnapshotPatch,
  normalizeSurvivorFoundationSettings,
} from '@/lib/survivor/survivorSettings'
import { effectiveExileBossMode, readSurvivorLateSeasonSettings } from '@/lib/survivor/lateSeasonSettings'
import { readSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'
import { readStoredTribePlan } from '@/lib/survivor/survivorTribePlan'
import { defaultTribeSlots } from '@/lib/survivor/survivorTribeIdentity'
import { upsertSurvivorConfig } from '@/lib/survivor/SurvivorLeagueConfig'
import {
  readSurvivorHouseRules,
  readSurvivorWeeklyPrizes,
  SURVIVOR_HOUSE_RULES_KEY,
  SURVIVOR_WEEKLY_PRIZES_KEY,
} from '@/lib/survivor/survivorWeeklyPrizes'
import { readRealGameSettings, REAL_GAME_SETTINGS_KEY } from '@/lib/survivor/survivorRealGameChallengeLogic'
import { readChallengeFaabWeeklyCap, SURVIVOR_CHALLENGE_FAAB_CAP_KEY } from '@/lib/survivor/survivorChallengeBuilderModel'
import { readPrizePhaseRules, SURVIVOR_PRIZE_PHASE_RULES_KEY, validatePrizePhaseRules } from '@/lib/survivor/survivorChallengeBuilderModel'
import { readThievesCannotStealFromEachOther, SURVIVOR_THIEVES_RULE_KEY } from '@/lib/survivor/survivorRewardModel'
import { settingsErrorMessages, settingsRefusalMessages, type SettingsRefusalCode } from '@/lib/survivor/survivorSettingsScreenCopy'
import { messagesFor } from '@/lib/i18n/messages'
import { getSurvivorIdolSetupView, isSurvivorDraftStarted, saveSurvivorIdolConfig } from '@/lib/survivor/survivorIdolConfigService'
import {
  changedSettingsKeys,
  isSurvivorIslandScenePreference,
  lockedChanges,
  parseSettingsForm,
  readSurvivorIslandScene,
  settingsFormErrors,
  type SurvivorSettingsContext,
  type SurvivorSettingsForm,
  type SurvivorSettingsLocks,
  weeklyPrizesFromForm,
  realGameSettingsFromForm,
  SURVIVOR_CHALLENGE_SETTING_DEFAULTS,
} from '@/lib/survivor/survivorSettingsScreen'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }
type Rec = Record<string, unknown>

function rec(value: unknown): Rec {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {}
}

type Lang = 'en' | 'es'
const langOf = (language: unknown): Lang => (String(language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en')

/** League.language, or English when there is no league to ask (or the read fails). */
async function leagueLang(leagueId: string | null | undefined): Promise<Lang> {
  if (!leagueId) return 'en'
  try {
    const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { language: true } })
    return langOf((row as { language?: unknown } | null)?.language)
  } catch {
    return 'en'
  }
}

/** A refusal in the league's language with its stable code: `{ error, code, ...extra }`. */
function refuse(lang: Lang, code: SettingsRefusalCode, status: number, extra: Rec = {}, detail = ''): NextResponse {
  const m = messagesFor(settingsRefusalMessages, lang)
  const entry = m[code] as string | ((d: string) => string)
  const error = typeof entry === 'function' ? entry(detail) : entry
  return NextResponse.json({ error, code, ...extra }, { status })
}

async function authorize(ctx: Ctx) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  const { leagueId } = await ctx.params
  if (!userId) return { error: refuse(await leagueLang(leagueId), 'unauthorized', 401) }
  if (!leagueId) return { error: refuse('en', 'missingLeague', 400) }
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access) return { error: refuse(await leagueLang(leagueId), 'leagueNotFound', 404) }
  if (!access.isLeagueMember || !access.decisions.canUpdateSettings) return { error: refuse(await leagueLang(leagueId), 'commissionerOnly', 403) }
  return { leagueId, userId, access }
}

export interface SurvivorSettingsScreenState {
  leagueName: string
  form: SurvivorSettingsForm
  context: SurvivorSettingsContext
  locks: SurvivorSettingsLocks
  /** Offer "Chimmy's roster" only to a league that already runs it (existing leagues keep it). */
  chimmyBossAvailable: boolean
  commissionerPlays: boolean
  /** League.language ('en' | 'es'): validation errors follow it, on the server and on the screen. */
  language?: 'en' | 'es'
}

async function loadState(leagueId: string, viewer: { canSeeDraw: boolean }): Promise<SurvivorSettingsScreenState | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { name: true, settings: true, survivorSwapWeek: true, survivorFinal3: true, sport: true, survivorExileHarshTokenLoss: true, language: true },
  })
  if (!league) return null
  const settings = rec(league.settings)
  const foundation = normalizeSurvivorFoundationSettings(settings)
  const stored = readSurvivorLateSeasonSettings(settings, { survivorFinal3: league.survivorFinal3 })
  // Show the boss the league really plays: outside the NBA a legacy Chimmy value is the median.
  const late = { ...stored, exileBossMode: effectiveExileBossMode(stored.exileBossMode, league.sport) }
  const plan = readSurvivorFullSeasonPlan(settings)
  const prizes = readSurvivorWeeklyPrizes(settings)
  const realGame = readRealGameSettings(settings)
  const [draftStarted, assigned, idolView] = await Promise.all([
    isSurvivorDraftStarted(leagueId),
    prisma.survivorTribeMember.count({ where: { tribe: { leagueId } } }),
    getSurvivorIdolSetupView(leagueId, { isCommissioner: true, canSeeDraw: viewer.canSeeDraw }),
  ])
  const firstWeek = plan?.startWeek ?? 1
  const lastWeek = plan?.endWeek ?? 13
  return {
    leagueName: league.name ?? 'Survivor league',
    form: {
      tribeCount: foundation.tribeCount,
      tribeFormation: foundation.tribeAssignmentMode,
      voteDay: foundation.tribalCouncilDay,
      voteTime: foundation.tribalCouncilTime,
      selfVotesAllowed: foundation.selfVotesAllowed,
      tieRule: foundation.tieRule,
      idolCount: idolView.config.count,
      hideIdolsFromCommissioner: foundation.hideIdolsFromCommissioner,
      exileEnabled: foundation.exileIslandEnabled,
      exileReturnTokens: foundation.exileReturnTokens,
      exileBossMode: late.exileBossMode,
      exileBossFixedScore: late.exileBossFixedScore,
      exileBossTopN: late.exileBossTopN,
      swapEnabled: league.survivorSwapWeek != null,
      swapWeek: league.survivorSwapWeek ?? Math.min(lastWeek - 2, firstWeek + 4),
      mergeTrigger: foundation.mergeTriggerType,
      mergeWeek: foundation.mergeWeek,
      mergeActivePlayerCount: foundation.mergeActivePlayerCount,
      finalistCount: late.finalistCount,
      shareCardsEnabled: foundation.shareCardsEnabled,
      publicMomentPages: foundation.publicMomentPages,
      spectatorPageEnabled: foundation.spectatorPageEnabled,
      islandScene: readSurvivorIslandScene(settings),
      coCommissionerMode: foundation.coCommissionerMode,
      mergeNamingMode: stored.mergeNamingMode,
      juryEnabled: foundation.juryEnabled,
      tribeChatsEnabled: foundation.tribeChatsEnabled,
      exileHarshTokenLoss: league.survivorExileHarshTokenLoss === true,
      houseRules: readSurvivorHouseRules(settings),
      winningTribeFaabPerPlayer: prizes.winningTribeFaabPerPlayer,
      topScorerReward: prizes.topScorerReward,
      topScorerAmount: prizes.topScorerAmount,
      topScorerPowerType: prizes.topScorerPowerType,
      tribeTieBreakPosition: prizes.tribeTieBreakPosition,
      realGameEnabled: realGame.enabled,
      realGamePerWeek: realGame.perWeek,
      realGamePrizeType: realGame.prize.type,
      realGamePrizeAmount: realGame.prize.type === 'none' ? SURVIVOR_CHALLENGE_SETTING_DEFAULTS.realGamePrizeAmount : realGame.prize.amount,
      challengeFaabWeeklyCap: readChallengeFaabWeeklyCap(settings),
      payInTribeWeeksAfterMerge: prizes.payInTribeWeeksAfterMerge,
      thievesCannotStealFromEachOther: readThievesCannotStealFromEachOther(settings),
      prizePhaseRules: readPrizePhaseRules(settings),
    },
    context: { managers: foundation.defaultTeamCount, firstWeek, lastWeek, sport: String(league.sport ?? 'NFL') },
    locks: { draftStarted, finalistLocked: Boolean(plan) || draftStarted, tribesLocked: assigned > 0 || Boolean(readStoredTribePlan(settings)?.lockedAt) },
    chimmyBossAvailable: late.exileBossMode === 'chimmy_roster',
    commissionerPlays: foundation.commissionerParticipationMode === 'participating_player',
    language: String((league as { language?: string | null }).language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en',
  }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const auth = await authorize(ctx)
  if ('error' in auth) return auth.error
  const state = await loadState(auth.leagueId, { canSeeDraw: auth.access.decisions.canSeeHiddenIdolAssignments })
  if (!state) return refuse('en', 'leagueNotFound', 404)
  return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await authorize(ctx)
  if ('error' in auth) return auth.error
  const { leagueId, userId, access } = auth
  const viewer = { canSeeDraw: access.decisions.canSeeHiddenIdolAssignments }
  const body = rec(await req.json().catch(() => null))
  const sceneRaw = rec(body.form).islandScene
  if (sceneRaw !== undefined && !isSurvivorIslandScenePreference(sceneRaw)) {
    return refuse(await leagueLang(leagueId), 'unknownScene', 400)
  }
  const next = parseSettingsForm(body.form)
  if (!next) return refuse(await leagueLang(leagueId), 'malformedForm', 400)

  const state = await loadState(leagueId, viewer)
  if (!state) return refuse('en', 'leagueNotFound', 404)
  const lang: Lang = state.language ?? 'en'
  const changed = changedSettingsKeys(state.form, next)
  if (!changed.length) return NextResponse.json({ ok: true, unchanged: true, state })

  const locked = lockedChanges(changed, state.locks)
  if (locked.length) return refuse(lang, 'settingsLocked', 409, { locked })
  if (next.exileBossMode === 'chimmy_roster' && !state.chimmyBossAvailable) return refuse(lang, 'chimmyBossUnavailable', 422)
  if (state.commissionerPlays && next.tribeFormation === 'commissioner_manual') return refuse(lang, 'playingCommissionerManualTribes', 409)
  // Validation errors in the league's language, each with a stable code (`settingsErrorMessages`).
  const detailed = settingsFormErrors(next, state.context, messagesFor(settingsErrorMessages, state.language ?? 'en'))
  if (detailed.length) {
    return NextResponse.json({ error: detailed[0]!.message, code: detailed[0]!.code, errors: detailed.map(e => e.message), codes: detailed.map(e => e.code) }, { status: 422 })
  }

  const has = (key: keyof SurvivorSettingsForm) => changed.includes(key)
  const outcome = await prisma.$transaction(async tx => {
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    const current = rec(league?.settings)
    const previous = normalizeSurvivorFoundationSettings(current)

    // Foundation keys are written top level too: the reader lets a top-level key win over the snapshot.
    const foundationPatch: Rec = {}
    if (has('tribeFormation')) foundationPatch.tribeAssignmentMode = next.tribeFormation
    if (has('voteDay')) foundationPatch.tribalCouncilDay = next.voteDay
    if (has('voteTime')) foundationPatch.tribalCouncilTime = next.voteTime
    if (has('selfVotesAllowed')) foundationPatch.selfVotesAllowed = next.selfVotesAllowed
    if (has('tieRule')) foundationPatch.tieRule = next.tieRule
    if (has('hideIdolsFromCommissioner')) foundationPatch.hideIdolsFromCommissioner = next.hideIdolsFromCommissioner
    if (has('exileEnabled')) {
      foundationPatch.exileIslandEnabled = next.exileEnabled
      foundationPatch.eliminationOutcome = next.exileEnabled ? 'exile_island' : 'removed_to_waivers'
    }
    if (has('exileReturnTokens')) foundationPatch.exileReturnTokens = next.exileReturnTokens
    if (has('mergeTrigger')) foundationPatch.mergeTriggerType = next.mergeTrigger
    if (has('mergeWeek')) foundationPatch.mergeWeek = next.mergeWeek
    if (has('mergeActivePlayerCount')) foundationPatch.mergeActivePlayerCount = next.mergeActivePlayerCount
    if (has('shareCardsEnabled')) foundationPatch.shareCardsEnabled = next.shareCardsEnabled
    if (has('publicMomentPages')) foundationPatch.publicMomentPages = next.publicMomentPages
    if (has('spectatorPageEnabled')) foundationPatch.spectatorPageEnabled = next.spectatorPageEnabled
    if (has('coCommissionerMode')) foundationPatch.coCommissionerMode = next.coCommissionerMode
    if (has('juryEnabled')) foundationPatch.juryEnabled = next.juryEnabled
    if (has('tribeChatsEnabled')) foundationPatch.tribeChatsEnabled = next.tribeChatsEnabled
    if (has('tribeCount')) {
      // Same reset the tribe panel does on a count change: default identities and capacities.
      foundationPatch.tribeCount = next.tribeCount
      foundationPatch.survivorTribeSlots = defaultTribeSlots(previous.defaultTeamCount, next.tribeCount)
    }
    const latePatch: Rec = {}
    if (has('finalistCount')) latePatch.finalistCount = next.finalistCount
    if (has('exileBossMode')) latePatch.exileBossMode = next.exileBossMode
    if (has('exileBossFixedScore') || (has('exileBossMode') && next.exileBossMode === 'fixed')) latePatch.exileBossFixedScore = next.exileBossFixedScore
    if (has('exileBossTopN')) latePatch.exileBossTopN = next.exileBossTopN
    // The island banner's scene (lib/core-app/survivorIsland.ts islandView reads it from the summary).
    if (has('islandScene') && next.islandScene) latePatch.survivorIslandScene = next.islandScene
    if (has('mergeNamingMode')) latePatch.mergeNamingMode = next.mergeNamingMode
    // League-rule extras that live beside the foundation settings, not in them.
    if (has('houseRules')) latePatch[SURVIVOR_HOUSE_RULES_KEY] = next.houseRules.trim()
    if ((['winningTribeFaabPerPlayer', 'topScorerReward', 'topScorerAmount', 'topScorerPowerType', 'tribeTieBreakPosition', 'payInTribeWeeksAfterMerge'] as const).some(has)) {
      latePatch[SURVIVOR_WEEKLY_PRIZES_KEY] = weeklyPrizesFromForm(next)
    }
    if ((['realGameEnabled', 'realGamePerWeek', 'realGamePrizeType', 'realGamePrizeAmount'] as const).some(has)) {
      latePatch[REAL_GAME_SETTINGS_KEY] = realGameSettingsFromForm(next, current[REAL_GAME_SETTINGS_KEY])
    }
    if (has('challengeFaabWeeklyCap')) latePatch[SURVIVOR_CHALLENGE_FAAB_CAP_KEY] = next.challengeFaabWeeklyCap
    // Reward rules (validated by validateSettingsForm above; stored in their canonical shape).
    if (has('thievesCannotStealFromEachOther')) latePatch[SURVIVOR_THIEVES_RULE_KEY] = next.thievesCannotStealFromEachOther
    if (has('prizePhaseRules')) {
      const rules = validatePrizePhaseRules(next.prizePhaseRules, 'en')
      if (rules.ok) latePatch[SURVIVOR_PRIZE_PHASE_RULES_KEY] = rules.rules
    }

    const nextFoundation = normalizeSurvivorFoundationSettings({ ...current, ...foundationPatch })
    const columns: Rec = Object.keys(foundationPatch).length ? buildSurvivorLeagueColumnPatch(nextFoundation) : {}
    if (has('swapEnabled') || has('swapWeek')) columns.survivorSwapWeek = next.swapEnabled ? next.swapWeek : null
    if (has('finalistCount')) columns.survivorFinal3 = next.finalistCount === 3
    if (has('exileHarshTokenLoss')) columns.survivorExileHarshTokenLoss = next.exileHarshTokenLoss

    if (has('idolCount')) {
      const idol = await getSurvivorIdolSetupView(leagueId, { isCommissioner: true }, tx)
      const saved = await saveSurvivorIdolConfig(leagueId, { ...idol.config, count: next.idolCount }, tx)
      if (!saved.ok) return { ok: false as const, status: saved.status, error: saved.error }
    }

    const snapshot = Object.keys(foundationPatch).length ? buildSurvivorSettingsSnapshotPatch(nextFoundation as unknown as Rec) : {}
    await tx.league.update({
      where: { id: leagueId },
      data: { settings: { ...current, ...snapshot, ...foundationPatch, ...latePatch } as Prisma.InputJsonValue, ...columns },
    })
    const previousState: Rec = {}
    const newState: Rec = {}
    for (const key of changed) { previousState[key] = state.form[key]; newState[key] = next[key] }
    await tx.survivorCommissionerAction.create({
      data: {
        leagueId,
        commissionerId: userId,
        actionType: 'survivor_settings_saved',
        description: `Updated ${changed.length} Survivor ${changed.length === 1 ? 'setting' : 'settings'}`,
        previousState: previousState as Prisma.InputJsonValue,
        newState: newState as Prisma.InputJsonValue,
      },
    })
    return { ok: true as const, nextFoundation }
  })
  if (!outcome.ok) return refuse(lang, 'idolSaveFailed', outcome.status, {}, typeof outcome.error === 'string' ? outcome.error : '')

  const f = outcome.nextFoundation
  if (changed.some(k => ['tribeCount', 'tribeFormation', 'mergeTrigger', 'mergeWeek', 'mergeActivePlayerCount', 'selfVotesAllowed', 'exileEnabled', 'exileReturnTokens', 'idolCount', 'voteTime'].includes(k))) {
    await upsertSurvivorConfig(leagueId, {
      tribeCount: f.tribeCount,
      tribeSize: Math.max(1, Math.ceil(f.defaultTeamCount / f.tribeCount)),
      tribeFormation: f.tribeAssignmentMode === 'commissioner_manual' ? 'commissioner' : 'random',
      mergeTrigger: f.mergeTriggerType === 'active_player_count' ? 'player_count' : 'week',
      mergeWeek: f.mergeWeek,
      mergePlayerCount: f.mergeActivePlayerCount,
      selfVoteDisallowed: !f.selfVotesAllowed,
      exileReturnEnabled: f.exileIslandEnabled,
      exileReturnTokens: f.exileReturnTokens,
      idolCount: next.idolCount,
      tribalCouncilTimeUtc: f.tribalCouncilTime,
    })
  }
  return NextResponse.json({ ok: true, changed, state: await loadState(leagueId, viewer) })
}
