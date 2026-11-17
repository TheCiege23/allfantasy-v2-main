import 'server-only'

import { prisma } from '@/lib/prisma'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { getLeagueLifecycleState } from '@/server/services/leagueLifecycleService'
import { SETTINGS_EDIT_POLICY } from '@/lib/league/settingsLifecycleGate'
import { MID_SEASON_CONFIRM_FLAG, MID_SEASON_CONFIRMATION_CODE } from '@/lib/league/midSeasonConfirmation'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { signChimmyActionToken } from './actionToken'
import {
  SETTINGS_CATALOG,
  SETTING_KEYS,
  isSettingKey,
  normalizeStored,
  sameSetting,
  type SettingValue,
  type SettingsSection,
} from './settingsCatalog'
import type { ChimmyActionCard, ChimmyActionTokenPayload, ChimmySettingKey, SettingChangeSpec } from './types'

/**
 * "Make the FAAB budget $200" / "move the trade deadline to week 11" — a commissioner changing league
 * settings through Chimmy. Stage 5 of Chimmy (2026-11-16). Owner's rules for this stage:
 *   - AllFantasy-hosted leagues only; an imported league's rules belong to its platform;
 *   - any commissioner, and a co-commissioner only within the areas they were given;
 *   - once the season has started, the card says so and needs a second tap.
 *
 * PROPOSE builds a card listing each setting before → after; EXECUTE (only from the confirm route,
 * after the tap) saves through `executeLeagueSettingsPatch` — the settings page's own pipeline, with its
 * co-commissioner scopes, AF Pro key gates, settings lock, structural locks and `settings_patch` audit row.
 *
 * ⚠ THE CARD IS CHECKED AGAINST THE LEAGUE AT CONFIRM TIME. If any setting it changes is no longer what
 * the card showed as "now", or the season started after the card was made, nothing is saved.
 */

type Outcome = { ok: true; text: string; card: ChimmyActionCard } | { ok: false; text: string }

const SELECT = {
  name: true,
  sport: true,
  season: true,
  platform: true,
  lifecycleState: true,
  leagueSize: true,
  waiverType: true,
  waiverBudget: true,
  waiverMinBid: true,
  tradeReviewHours: true,
  tradeDeadlineWeek: true,
  playoffTeams: true,
  playoffStartWeek: true,
  irSlots: true,
  _count: { select: { teams: true } },
} as const

type LeagueRow = NonNullable<Awaited<ReturnType<typeof readLeague>>>

function readLeague(leagueId: string) {
  return prisma.league.findUnique({ where: { id: leagueId }, select: SELECT })
}

const current = (row: LeagueRow, key: ChimmySettingKey): SettingValue => normalizeStored(key, (row as Record<string, unknown>)[key])

/** The season is under way: the settings page asks to confirm scoring/roster changes now. */
function isMidSeason(row: LeagueRow): boolean {
  return SETTINGS_EDIT_POLICY[getLeagueLifecycleState(row)] === 'confirm'
}

const MID_SEASON_WARNING = 'The season has started. This applies from now on, to every team, and is announced in the league. Tap Confirm, then confirm again.'

export async function proposeSettingsChange(args: { leagueId: string; userId: string; changes: unknown; now?: Date }): Promise<Outcome> {
  const now = args.now ?? new Date()
  const asked = args.changes && typeof args.changes === 'object' && !Array.isArray(args.changes) ? (args.changes as Record<string, unknown>) : {}
  const entries = Object.entries(asked).filter(([, v]) => v !== undefined)
  if (entries.length === 0) {
    return { ok: false, text: `Name at least one setting to change. Chimmy can change: ${SETTING_KEYS.map((k) => SETTINGS_CATALOG[k].label).join(', ')}. Nothing was prepared.` }
  }
  const unknown = entries.map(([k]) => k).filter((k) => !isSettingKey(k))
  if (unknown.length > 0) {
    return {
      ok: false,
      text: `Chimmy can't change ${unknown.join(', ')} — only: ${SETTING_KEYS.map((k) => SETTINGS_CATALOG[k].label).join(', ')}. Scoring, roster slots, draft setup and league size are changed on the league's Settings page. Nothing was prepared.`,
    }
  }

  if (!(await isElevatedCommissioner(args.leagueId, args.userId))) {
    return { ok: false, text: "Only this league's commissioner or a co-commissioner can change its settings, so nothing was prepared. Say so plainly; the user can ask their commissioner." }
  }
  const row = await readLeague(args.leagueId)
  if (!row) return { ok: false, text: 'That league could not be found, so nothing was prepared.' }
  if (resolveWriteAuthority(row.platform) !== 'NATIVE') {
    return { ok: false, text: `This league is imported from ${row.platform}, so its settings are changed there, not on AllFantasy. Nothing was prepared. Tell the commissioner to change it on ${row.platform}.` }
  }

  const teamCount = row.leagueSize ?? row._count.teams
  const problems: string[] = []
  const unchanged: string[] = []
  const changes: SettingChangeSpec[] = []
  const sections = new Set<SettingsSection>()
  for (const [rawKey, raw] of entries) {
    const key = rawKey as ChimmySettingKey
    const def = SETTINGS_CATALOG[key]
    const parsed = def.parse(raw, { teamCount })
    if (!parsed.ok) {
      problems.push(parsed.reason)
      continue
    }
    const from = current(row, key)
    if (sameSetting(from, parsed.value)) {
      unchanged.push(`${def.label} is already ${def.show(from)}`)
      continue
    }
    sections.add(def.section)
    changes.push({ key, from, to: parsed.value })
  }
  if (problems.length > 0) return { ok: false, text: `Nothing was prepared: ${problems.join('; ')}.` }
  if (changes.length === 0) return { ok: false, text: `Nothing to change — ${unchanged.join('; ')}. Tell the commissioner so.` }
  if (sections.size > 1) {
    return {
      ok: false,
      text: `Those settings are in different parts of the settings page (${[...sections].join(', ')}); one card covers one part. Nothing was prepared — call this again once per part.`,
    }
  }
  const section = [...sections][0]!

  const state = getLeagueLifecycleState(row)
  if (section === 'roster' && SETTINGS_EDIT_POLICY[state] === 'refused') {
    return { ok: false, text: `Roster settings can't be changed while the league is ${state.replace(/_/g, ' ')}. Nothing was prepared.` }
  }
  const midSeason = isMidSeason(row)

  const signed = signChimmyActionToken({
    userId: args.userId,
    leagueId: args.leagueId,
    spec: { kind: 'settings', section, changes, midSeason },
    now,
  })
  if (!signed) return { ok: false, text: "Confirm cards are unavailable right now, so nothing was prepared. The commissioner can change this on the league's Settings page." }

  const shown = changes.map((c) => {
    const def = SETTINGS_CATALOG[c.key]
    return { label: def.label, from: def.show(c.from), to: def.show(c.to) }
  })
  const warnings = [...(midSeason ? [MID_SEASON_WARNING] : []), ...unchanged.map((u) => `Already set: ${u}.`)]
  const card: ChimmyActionCard = {
    actionId: signed.payload.actionId,
    kind: 'settings',
    token: signed.token,
    // "Change the trade deadline"; an acronym-led label keeps its case ("Change the FAAB budget").
    title: changes.length === 1 ? `Change the ${shown[0]!.label.replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase())}` : 'Change league settings',
    league: { id: args.leagueId, name: row.name ?? null, sport: String(row.sport ?? '') },
    week: 0,
    season: row.season ?? now.getUTCFullYear(),
    expiresAt: new Date(signed.payload.exp * 1000).toISOString(),
    settings: { changes: shown, midSeason },
    warnings,
  }
  const list = shown.map((s) => `${s.label}: ${s.from} → ${s.to}`).join('; ')
  return {
    ok: true,
    /*
     * ⚠ SAY WHICH IT IS, BOTH WAYS. Found live 2026-11-16: with no mid-season sentence the model inferred
     * one from the date ("the card will warn you… a second tap") for a pre-draft league, and invented a
     * side effect ("everyone's remaining budget gets re-based"). So the one-tap case is stated too, and
     * the answer is bounded to what the card shows.
     */
    text: `A confirm card is ready: ${list}. ${
      midSeason
        ? 'The season has started, so the card warns about that and needs a SECOND tap.'
        : "This league's season has NOT started, so ONE tap saves it — do not mention a second tap or a mid-season warning."
    } NOTHING has changed yet — it is saved only if the commissioner taps Confirm. Say that, and never say it was changed. Describe only what is listed here: do NOT claim effects on remaining budgets, rosters, standings, claims or schedules — none were checked.`,
    card,
  }
}

export type SettingsExecuteResult =
  | { ok: true; message: string; before: Record<string, SettingValue>; after: Record<string, SettingValue> }
  | { ok: false; message: string }

const CHANGED = 'Your league changed since this card was made, so nothing was saved. Ask Chimmy again for a fresh card.'

export async function executeSettingsAction(payload: ChimmyActionTokenPayload, userId: string): Promise<SettingsExecuteResult> {
  const spec = payload.spec
  if (spec.kind !== 'settings') return { ok: false, message: 'This card could not be applied.' }
  const { leagueId } = payload

  if (!(await isElevatedCommissioner(leagueId, userId))) return { ok: false, message: 'Only the commissioner can change league settings, so nothing was saved.' }
  const row = await readLeague(leagueId)
  if (!row) return { ok: false, message: 'That league could not be found, so nothing was saved.' }
  if (resolveWriteAuthority(row.platform) !== 'NATIVE') return { ok: false, message: 'Nothing was saved: this league is not run by AllFantasy.' }
  if (spec.changes.length === 0 || spec.changes.some((c) => !isSettingKey(c.key) || SETTINGS_CATALOG[c.key].section !== spec.section)) {
    return { ok: false, message: 'This card could not be applied.' }
  }
  if (spec.changes.some((c) => !sameSetting(current(row, c.key), c.from))) return { ok: false, message: CHANGED }
  // The card promised a second tap whenever the season is under way; a card made before then never asked.
  if (isMidSeason(row) && !spec.midSeason) {
    return { ok: false, message: 'The season has started since this card was made, so nothing was saved. Ask Chimmy again — the new card will ask you to confirm the mid-season change.' }
  }

  const body: Record<string, unknown> & { leagueId: string } = { leagueId }
  for (const c of spec.changes) body[c.key] = c.to
  if (spec.midSeason) body[MID_SEASON_CONFIRM_FLAG] = true

  const res = await executeLeagueSettingsPatch(userId, body, { section: spec.section })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string; code?: string }
    if (j.code === MID_SEASON_CONFIRMATION_CODE) {
      return { ok: false, message: 'The season has started since this card was made, so nothing was saved. Ask Chimmy again for a fresh card.' }
    }
    return { ok: false, message: `Nothing was saved: ${j.error ?? j.message ?? 'the settings could not be updated'}.` }
  }
  const before = Object.fromEntries(spec.changes.map((c) => [c.key, c.from]))
  const after = Object.fromEntries(spec.changes.map((c) => [c.key, c.to]))
  const words = spec.changes.map((c) => `${SETTINGS_CATALOG[c.key].label} is now ${SETTINGS_CATALOG[c.key].show(c.to)}`)
  return { ok: true, message: `Saved — ${words.join('; ')}.`, before, after }
}
