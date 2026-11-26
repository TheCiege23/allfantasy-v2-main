'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Lock } from 'lucide-react'
import {
  ENDGAME_OPTIONS,
  GUILLOTINE_PAID_RULE_FIELDS,
  RELEASE_OPTIONS,
  RULE_LIMITS,
  tiebreakLabel,
  type GuillotineRuleField,
  type GuillotineRules,
} from '@/lib/guillotine/guillotineRules'
import { DEFAULT_ADVANCED, MAX_CHOPS_PER_WEEK, MAX_FAAB_AMOUNT, isDefault, type FaabAfterChop, type GuillotineAdvanced } from '@/lib/guillotine/chopSchedule'
import { DEFAULT_FAAB_ON_CHOP_PERCENT, FAAB_ON_CHOP_OPTIONS, FAAB_ON_CHOP_PERCENT_CHOICES, movesChoppedFaab, type FaabOnChop } from '@/lib/guillotine/faabOnChop'
import { CHOP_LIST_ORDER_OPTIONS, DEFAULT_CHOP_LIST_ORDER, type ChopListOrder } from '@/lib/guillotine/chopListOrder'
import { CHOP_PATTERN_OPTIONS, applyChopPattern, chopPatternWeeks, describeWeeks, type ChopPatternKind } from '@/lib/guillotine/chopPatterns'
import { calendarFitMessage, guillotineSeasonPreview, type CalendarFitInput } from '@/lib/guillotine/calendarFit'
import { resolveGuillotineEndgame } from '@/lib/guillotine/endgameRules'
import {
  MAX_ROSTER_CHANGES,
  MAX_SPOTS_PER_CHANGE,
  ROSTER_CHANGE_OPTIONS,
  describeLayout,
  describeRosterChange,
  rosterChangeNeedsSlot,
  walkRosterSchedule,
  type RosterChange,
  type RosterChangeKind,
  type RosterScheduleView,
} from '@/lib/guillotine/rosterSchedule'
import { SettingsSubPageFooter } from './LeagueSettingsHome'

/**
 * Guilly rules: the ONE settings page of a guillotine league (owner's decision, 2026-11-25 — "settings looks
 * weird", "dropdowns and toggles", set it once and the app runs it).
 *
 * It was three pages reached from five rows: "First chop week", "Chop rules" (schedule, special weeks, immunity,
 * FAAB after a chop) and "League rules" (everything else), with the base teams-per-chop on one page and the
 * weeks that change it on another. They are one page now, grouped by the question a commissioner asks:
 *
 *   1. When teams get chopped    first and last week, teams a week, later changes, special weeks, the season preview
 *   2. After a chop              when players are released, the chopped team's FAAB, the survivors' FAAB
 *   +  Roster changes            starting or bench spots added on a set week (lib/guillotine/rosterSchedule.ts)
 *   3. Ties and fairness         tiebreak order, the stat-correction wait, top-scorer immunity
 *   4. How the season ends       last team standing or a Final N
 *   5. Lineups and the page      best ball, Chimmy's recap, the danger margin, the Chop page's list order
 *
 * ONE Save. The server keeps its writers — each with its own lock and plan check (app/api/leagues/[leagueId]/
 * guillotine/summary PATCH: `{ eliminationStartWeek }`, `{ rules }`, `{ advanced }`, `{ rosterSchedule }`)
 * — and this page sends only the ones that changed, in that order, stopping at the first refusal and saying what
 * was and was not saved. Nothing about who may change what is decided here: every refusal is the server's.
 *
 * The season preview is the save's own calendar check (lib/guillotine/calendarFit.ts) run on what is on screen,
 * so a schedule that cannot reach a champion is seen before Save refuses it.
 */

type RulesView = {
  rules: GuillotineRules
  startWeek: number
  seasonWeeks: number
  /** The first chop has happened: the first chop week, the endgame and the period length are fixed. */
  endgameLocked: boolean
  bestBallLocked?: boolean
  periodWeeksAvailable?: boolean
  canEditPaid: boolean
  aiRecapAvailable: boolean
  /** Absent from an older server: the schedule then reads as the standard one and is not sent back. */
  advanced?: GuillotineAdvanced
  teamCount?: number
  /** Scheduled roster changes. Absent or null (an older server, a failed read): the section is hidden. */
  roster?: RosterScheduleView | null
}

type SavedParts = { rules: GuillotineRules; advanced: GuillotineAdvanced; firstChopWeek: number; scheduleLines?: string[] }

const inputClass = 'w-full min-w-0 rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2 text-sm text-white disabled:opacity-50'
const ghostBtn = 'rounded-lg border border-white/15 px-3 py-2 text-[12px] font-semibold text-white/85 disabled:opacity-40'
const CHOPS = Array.from({ length: MAX_CHOPS_PER_WEEK }, (_, i) => i + 1)
const teams = (n: number) => (n === 1 ? '1 team' : `${n} teams`)

export function GuillotineRulesPage({
  leagueId,
  chopLabel,
  waiverLabel,
  onSaved,
}: {
  leagueId: string
  /** "By Wednesday 7:00 AM ET": when this sport's chop runs (lib/guillotine/sportConfig.ts). */
  chopLabel?: string | null
  waiverLabel?: string | null
  onSaved?: (saved: SavedParts) => void
}) {
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary`
  const [view, setView] = useState<RulesView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rules, setRules] = useState<GuillotineRules | null>(null)
  const [advanced, setAdvanced] = useState<GuillotineAdvanced>(DEFAULT_ADVANCED)
  const [savedAdvanced, setSavedAdvanced] = useState<string>(JSON.stringify(DEFAULT_ADVANCED))
  const [firstWeek, setFirstWeek] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [pattern, setPattern] = useState<{ kind: ChopPatternKind; from: number | null; to: number | null; chops: number }>({ kind: 'every_other_week', from: null, to: null, chops: 2 })
  const scheduleLines = useRef<string[] | undefined>(undefined)
  // Scheduled roster changes that have not run yet. The ones that have are history and are only shown.
  const [rosterChanges, setRosterChanges] = useState<RosterChange[]>([])
  const [savedRoster, setSavedRoster] = useState('[]')

  useEffect(() => {
    let cancelled = false
    fetch(`${url}?view=rules`, { credentials: 'include', cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) {
          setLoadError(typeof d?.error === 'string' ? d.error : 'Could not load the league rules.')
          return
        }
        const v = d as RulesView
        const adv = { ...DEFAULT_ADVANCED, ...(v.advanced ?? {}) }
        setView(v)
        setRules(v.rules)
        setAdvanced(adv)
        setSavedAdvanced(JSON.stringify(adv))
        setFirstWeek(v.startWeek)
        const waiting = waitingRosterChanges(v.roster)
        setRosterChanges(waiting)
        setSavedRoster(JSON.stringify(waiting))
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not reach the server. Try again.')
      })
    return () => {
      cancelled = true
    }
  }, [url])

  // The season as it would run with what is on screen: the save's own check (lib/guillotine/calendarFit.ts).
  const calendar: CalendarFitInput | null = useMemo(() => {
    if (!view || !rules || !(view.teamCount && view.teamCount > 0)) return null
    const endgame = resolveGuillotineEndgame({ settings: { guillotineEndgame: rules.endgame } })
    return {
      teamCount: view.teamCount,
      startWeek: firstWeek,
      endWeek: rules.eliminationEndWeek,
      baseChops: rules.teamsPerChop,
      advanced,
      threshold: endgame.threshold,
      finalPeriods: endgame.cumulativePeriods,
      periodWeeks: rules.periodWeeks,
    }
  }, [view, rules, advanced, firstWeek])
  const preview = useMemo(() => (calendar ? guillotineSeasonPreview(calendar) : null), [calendar])

  if (loadError) return <p role="alert" className="text-[13px] text-red-300">{loadError}</p>
  if (!view || !rules) return <p className="text-[13px] text-white/50">Loading Guilly rules…</p>

  const paid = view.canEditPaid
  const paidLocked = (field: GuillotineRuleField) => GUILLOTINE_PAID_RULE_FIELDS.has(field) && !paid
  const touch = () => {
    setOk(false)
    setError(null)
  }
  const update = (next: Partial<GuillotineRules>) => {
    touch()
    setRules({ ...rules, ...next })
  }
  const updateAdvanced = (next: GuillotineAdvanced) => {
    touch()
    setAdvanced(next)
  }
  const moveTiebreak = (index: number, delta: -1 | 1) => {
    const order = [...rules.tiebreakerOrder]
    const target = index + delta
    if (target < 0 || target >= order.length) return
    ;[order[index], order[target]] = [order[target]!, order[index]!]
    update({ tiebreakerOrder: order })
  }

  const changedRules = (Object.keys(rules) as GuillotineRuleField[]).filter((k) => JSON.stringify(rules[k]) !== JSON.stringify(view.rules[k]))
  const firstDirty = firstWeek !== view.startWeek
  const advancedDirty = JSON.stringify(advanced) !== savedAdvanced
  const roster = view.roster && view.roster.supported ? view.roster : null
  const rosterDirty = roster != null && JSON.stringify(rosterChanges) !== savedRoster
  const dirty = firstDirty || changedRules.length > 0 || advancedDirty || rosterDirty
  // The schedule, special weeks, immunity and FAAB after a chop are AF Commissioner as a block. Without it the
  // controls are locked, except the one that puts the league back on the standard schedule.
  const scheduleLocked = !paid
  const weeks = Array.from({ length: Math.max(1, rules.eliminationEndWeek - firstWeek + 1) }, (_, i) => firstWeek + i)
  const overrides = Object.entries(advanced.overrides).map(([w, n]) => ({ week: Number(w), chops: n })).sort((a, b) => a.week - b.week)
  const listOrder: ChopListOrder = rules.chopListOrder ?? DEFAULT_CHOP_LIST_ORDER
  // Absent from an older server = all of it. A stored share that is not one of the offered ones is still shown.
  const faabPercent = rules.faabOnChopPercent ?? DEFAULT_FAAB_ON_CHOP_PERCENT
  const faabPercentChoices = [...new Set([...FAAB_ON_CHOP_PERCENT_CHOICES, faabPercent])].sort((a, b) => b - a)
  const patternFrom = pattern.from != null && weeks.includes(pattern.from) ? pattern.from : weeks[0]!
  const patternTo = pattern.to != null && weeks.includes(pattern.to) && pattern.to >= patternFrom ? pattern.to : weeks[weeks.length - 1]!
  const patternWeeks = chopPatternWeeks({ kind: pattern.kind, fromWeek: patternFrom, toWeek: patternTo }, { startWeek: firstWeek, periodWeeks: rules.periodWeeks })
  const firstWeekValid = Number.isInteger(firstWeek) && firstWeek >= 1 && firstWeek <= rules.eliminationEndWeek
  // Roster changes: the list as it would run from today's roster, by the save's own walk.
  const rosterWeeks = roster ? Array.from({ length: Math.max(0, roster.toWeek - roster.fromWeek + 1) }, (_, i) => roster.fromWeek + i) : []
  const rosterWalk = roster ? walkRosterSchedule(roster.layout, rosterChanges, roster.spots) : null
  const rosterBlocked = rosterWalk?.steps.find((s) => !s.ok)
  const rosterByWeek: Array<{ week: number; text: string }> = []
  if (roster && rosterWalk && !rosterBlocked) {
    for (const s of rosterWalk.steps) {
      if (!s.ok) continue
      const text = describeLayout(s.slots, roster.spots)
      const last = rosterByWeek[rosterByWeek.length - 1]
      if (last && last.week === s.change.week) last.text = text
      else rosterByWeek.push({ week: s.change.week, text })
    }
  }
  const rosterDone = roster ? roster.changes.filter((c) => roster.done.includes(c.id)) : []
  const rosterSkipped = new Map((roster?.skipped ?? []).map((s) => [s.id, s.reason]))
  const updateRoster = (next: RosterChange[]) => {
    touch()
    setRosterChanges(next)
  }
  const editRoster = (id: string, next: Partial<RosterChange>) =>
    updateRoster(
      rosterChanges.map((c) => {
        if (c.id !== id) return c
        const merged = { ...c, ...next }
        const needsSlot = rosterChangeNeedsSlot(merged.kind)
        return { ...merged, slot: needsSlot ? (merged.slot ?? defaultStarterSpot(roster)) : null }
      }),
    )
  const addRoster = () => {
    if (!roster || rosterWeeks.length === 0) return
    const id = `rc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    updateRoster([...rosterChanges, { id, week: rosterWeeks[0]!, kind: 'add_starter', slot: defaultStarterSpot(roster), count: 1 }])
  }

  const patch = async (body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> => {
    try {
      const res = await fetch(url, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) return { ok: false, error: typeof data.error === 'string' ? data.error : 'Could not save.' }
      return { ok: true, data }
    } catch {
      return { ok: false, error: 'Could not reach the server. Try again.' }
    }
  }

  const submit = async () => {
    setSaving(true)
    setError(null)
    setOk(false)
    const done: string[] = []
    const fail = (what: string, message: string) => {
      setError(done.length ? `Saved: ${done.join(', ')}. Not saved (${what}): ${message}` : message)
      setSaving(false)
    }
    let current = view
    let savedFirst = view.startWeek
    // 1. The first chop week, so the rules below are checked against the week the season now starts.
    if (firstDirty) {
      const r = await patch({ eliminationStartWeek: firstWeek })
      if (!r.ok) return fail('first chop week', r.error)
      savedFirst = Number((r.data.config as { eliminationStartWeek?: number } | undefined)?.eliminationStartWeek ?? firstWeek)
      current = { ...current, startWeek: savedFirst }
      setView(current)
      setFirstWeek(savedFirst)
      done.push('first chop week')
    }
    // 2. The rules: only what changed, so a field this viewer cannot edit is never part of the request.
    if (changedRules.length > 0) {
      const r = await patch({ rules: Object.fromEntries(changedRules.map((k) => [k, rules[k]])) })
      if (!r.ok) return fail('league rules', r.error)
      const next = r.data as unknown as RulesView
      // The rules answer carries no roster schedule; keep the one this page loaded.
      current = { ...current, ...next, startWeek: next.startWeek ?? savedFirst, roster: current.roster }
      setView(current)
      setRules(next.rules)
      done.push('league rules')
    }
    // 3. The chop schedule, special weeks, immunity and FAAB after a chop.
    let nextAdvanced = advanced
    if (advancedDirty) {
      const r = await patch({ advanced })
      if (!r.ok) return fail('chop schedule', r.error)
      nextAdvanced = { ...DEFAULT_ADVANCED, ...((r.data.advanced as GuillotineAdvanced | undefined) ?? advanced) }
      scheduleLines.current = Array.isArray(r.data.scheduleLines) ? (r.data.scheduleLines as string[]) : undefined
      setAdvanced(nextAdvanced)
      setSavedAdvanced(JSON.stringify(nextAdvanced))
      done.push('chop schedule')
    }
    // 4. Scheduled roster changes.
    if (rosterDirty) {
      const r = await patch({ rosterSchedule: rosterChanges })
      if (!r.ok) return fail('roster changes', r.error)
      const nextRoster = (r.data.roster as RosterScheduleView | undefined) ?? null
      current = { ...current, roster: nextRoster }
      setView(current)
      const waiting = waitingRosterChanges(nextRoster)
      setRosterChanges(waiting)
      setSavedRoster(JSON.stringify(waiting))
      done.push('roster changes')
    }
    setSaving(false)
    setOk(true)
    onSaved?.({ rules: current.rules, advanced: nextAdvanced, firstChopWeek: savedFirst, scheduleLines: scheduleLines.current })
  }

  const endgameHelp = ENDGAME_OPTIONS.find((o) => o.value === rules.endgame)?.help
  const releaseHelp = RELEASE_OPTIONS.find((o) => o.value === rules.rosterReleaseTiming)?.help
  const faabHelp = `${FAAB_ON_CHOP_OPTIONS.find((o) => o.value === rules.faabOnChop)?.help ?? ''}${movesChoppedFaab(rules.faabOnChop) && faabPercent < 100 ? ` ${100 - faabPercent}% of it leaves with the chopped team.` : ''} Only matters if your league uses FAAB bidding.`
  const week = rules.periodWeeks === 2 ? 'period' : 'week'

  return (
    <div className="space-y-6" data-testid="guillotine-rules">
      <p className="text-[12px] text-white/55">
        Set these once. AllFantasy applies them every week: chops, releases and the finale run without you.
        {chopLabel ? ` The chop runs ${chopLabel.replace(/^By /, 'by ')}${waiverLabel ? `; waivers run ${waiverLabel}` : ''}.` : ''}
      </p>
      {!paid && (
        <p className="rounded-lg border border-violet-400/30 bg-violet-950/30 px-3 py-2 text-[12px] text-violet-200" data-testid="guillotine-rules-upgrade">
          Rules marked <Lock className="inline h-3 w-3" aria-hidden /> are part of AF Commissioner.{' '}
          <a href="/upgrade?plan=commissioner" className="font-semibold underline">Upgrade</a>
        </p>
      )}

      {/* ---------- 1. When teams get chopped ---------- */}
      <Group id="chops" title="When teams get chopped" sub="The weeks the chop runs, and how many teams go each time.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First chop week" help={view.endgameLocked ? 'Fixed for this season: the first chop has happened.' : 'No team is chopped before this week.'}>
            <select
              className={inputClass}
              value={firstWeek}
              disabled={view.endgameLocked}
              onChange={(e) => {
                touch()
                setFirstWeek(Number(e.target.value))
              }}
              data-testid="lsh-first-chop-input"
            >
              {Array.from({ length: Math.max(1, rules.eliminationEndWeek) }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
          </Field>
          <Field label="Last chop week" paid={paidLocked('eliminationEndWeek')} help="The season has to finish by this week.">
            <select
              className={inputClass}
              value={rules.eliminationEndWeek}
              disabled={paidLocked('eliminationEndWeek')}
              onChange={(e) => update({ eliminationEndWeek: Number(e.target.value) })}
              data-testid="guillotine-rules-end-week"
            >
              {Array.from({ length: Math.max(1, view.seasonWeeks - firstWeek + 1) }, (_, i) => firstWeek + i).map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label={`Teams chopped each ${week}`} paid={paidLocked('teamsPerChop')}>
          <select
            className={inputClass}
            value={rules.teamsPerChop}
            disabled={paidLocked('teamsPerChop')}
            onChange={(e) => update({ teamsPerChop: Number(e.target.value) })}
            data-testid="guillotine-rules-teams-per-chop"
          >
            {CHOPS.map((n) => <option key={n} value={n}>{teams(n)}</option>)}
          </select>
        </Field>

        {/* MLB only (lib/guillotine/eliminationPeriods.ts): two weeks' scores added, one chop per pair. */}
        {view.periodWeeksAvailable === true && (
          <Field
            label="Elimination period"
            help={
              view.endgameLocked
                ? 'Fixed for this season: the first chop has happened.'
                : rules.periodWeeks === 2
                  ? `Each period is two weeks: both weeks' scores are added and the lowest total is chopped at the end of the second week (weeks ${firstWeek + 1}, ${firstWeek + 3}, ${firstWeek + 5}…).`
                  : 'One chop at the end of every week.'
            }
          >
            <select
              className={inputClass}
              value={rules.periodWeeks ?? 1}
              disabled={view.endgameLocked}
              onChange={(e) => update({ periodWeeks: Number(e.target.value) === 2 ? 2 : 1 })}
              data-testid="guillotine-rules-period-weeks"
            >
              <option value={1}>One week</option>
              <option value={2}>Two weeks</option>
            </select>
          </Field>
        )}

        <Field label="Change it later in the season" paid={scheduleLocked} help="For example: one team a week, then two a week from week 10.">
          {advanced.steps.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2" data-testid="guillotine-step">
              <label className="text-[11px] text-white/50">From week
                <select className={inputClass} value={s.fromWeek} disabled={scheduleLocked} onChange={(e) => updateAdvanced({ ...advanced, steps: advanced.steps.map((x, j) => (j === i ? { ...x, fromWeek: Number(e.target.value) } : x)) })}>
                  {weeks.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-white/50">Teams a {week}
                <select className={inputClass} value={s.chops} disabled={scheduleLocked} onChange={(e) => updateAdvanced({ ...advanced, steps: advanced.steps.map((x, j) => (j === i ? { ...x, chops: Number(e.target.value) } : x)) })}>
                  {CHOPS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <button type="button" className={ghostBtn} disabled={scheduleLocked} onClick={() => updateAdvanced({ ...advanced, steps: advanced.steps.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <button
            type="button"
            className={ghostBtn}
            disabled={scheduleLocked}
            data-testid="guillotine-add-step"
            onClick={() => {
              const used = new Set(advanced.steps.map((s) => s.fromWeek))
              const w = weeks.find((x) => x > firstWeek && !used.has(x)) ?? weeks[weeks.length - 1]!
              updateAdvanced({ ...advanced, steps: [...advanced.steps, { fromWeek: w, chops: Math.min(MAX_CHOPS_PER_WEEK, rules.teamsPerChop + 1) }] })
            }}
          >
            Add a change
          </button>
        </Field>

        <Field label="Special weeks" paid={scheduleLocked} help="A week with no chop, or a double chop. A special week wins over everything above.">
          {/* Repeating weeks, set in one go (lib/guillotine/chopPatterns.ts): they are written as special weeks. */}
          <div className="grid grid-cols-2 items-end gap-2 rounded-lg border border-white/10 p-3 sm:grid-cols-[1.4fr_1fr_1fr_1.2fr_auto]" data-testid="guillotine-pattern">
            <label className="text-[11px] text-white/50">Repeat
              <select className={inputClass} value={pattern.kind} disabled={scheduleLocked} onChange={(e) => setPattern({ ...pattern, kind: e.target.value as ChopPatternKind })} data-testid="guillotine-pattern-kind">
                {CHOP_PATTERN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-white/50">From week
              <select className={inputClass} value={patternFrom} disabled={scheduleLocked} onChange={(e) => setPattern({ ...pattern, from: Number(e.target.value) })} data-testid="guillotine-pattern-from">
                {weeks.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-white/50">To week
              <select className={inputClass} value={patternTo} disabled={scheduleLocked} onChange={(e) => setPattern({ ...pattern, to: Number(e.target.value) })} data-testid="guillotine-pattern-to">
                {weeks.filter((w) => w >= patternFrom).map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-white/50">Chop
              <select className={inputClass} value={pattern.chops} disabled={scheduleLocked} onChange={(e) => setPattern({ ...pattern, chops: Number(e.target.value) })} data-testid="guillotine-pattern-chops">
                <option value={0}>No chop</option>
                {CHOPS.map((n) => <option key={n} value={n}>{teams(n)}</option>)}
              </select>
            </label>
            <button type="button" className={ghostBtn} disabled={scheduleLocked || patternWeeks.length === 0} onClick={() => updateAdvanced(applyChopPattern(advanced, patternWeeks, pattern.chops))} data-testid="guillotine-pattern-apply">
              Set these weeks
            </button>
            <p className="col-span-full text-[12px] text-white/50" data-testid="guillotine-pattern-weeks">
              {patternWeeks.length === 0 ? 'No week in that range matches.' : `${describeWeeks(patternWeeks)}: ${pattern.chops === 0 ? 'no chop' : `${teams(pattern.chops)} chopped`}.`}
            </p>
          </div>
          {overrides.map((o) => (
            <div key={o.week} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2" data-testid={`guillotine-special-${o.week}`}>
              <label className="text-[11px] text-white/50">Week
                <select className={inputClass} value={o.week} disabled={scheduleLocked} onChange={(e) => {
                  const next = { ...advanced.overrides }
                  delete next[o.week]
                  next[Number(e.target.value)] = o.chops
                  updateAdvanced({ ...advanced, overrides: next })
                }}>
                  {[...new Set([o.week, ...weeks.filter((w) => !(w in advanced.overrides))])].sort((a, b) => a - b).map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-white/50">Chop
                <select className={inputClass} value={o.chops} disabled={scheduleLocked} onChange={(e) => updateAdvanced({ ...advanced, overrides: { ...advanced.overrides, [o.week]: Number(e.target.value) } })}>
                  <option value={0}>No chop</option>
                  {CHOPS.map((n) => <option key={n} value={n}>{teams(n)}</option>)}
                </select>
              </label>
              <button type="button" className={ghostBtn} disabled={scheduleLocked} onClick={() => {
                const next = { ...advanced.overrides }
                delete next[o.week]
                updateAdvanced({ ...advanced, overrides: next })
              }}>Remove</button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={ghostBtn} disabled={scheduleLocked || !weeks.some((w) => !(w in advanced.overrides))} data-testid="guillotine-add-special"
              onClick={() => {
                const w = weeks.find((x) => !(x in advanced.overrides))
                if (w != null) updateAdvanced({ ...advanced, overrides: { ...advanced.overrides, [w]: 0 } })
              }}>
              Add one week
            </button>
            {overrides.length > 1 ? (
              <button type="button" className={ghostBtn} disabled={scheduleLocked} onClick={() => updateAdvanced({ ...advanced, overrides: {} })} data-testid="guillotine-clear-special">
                Clear special weeks
              </button>
            ) : null}
          </div>
        </Field>

        {/* A league left on a schedule by a lapsed plan can always go back to the standard one. */}
        {scheduleLocked && !isDefault(advanced) ? (
          <button type="button" className={ghostBtn} onClick={() => updateAdvanced(DEFAULT_ADVANCED)} data-testid="guillotine-schedule-reset">
            Back to the standard schedule
          </button>
        ) : null}

        {preview ? (
          <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid="guillotine-season-preview" data-fits={preview.fit.fits ? 'true' : 'false'}>
            <h4 className="text-[12px] font-semibold uppercase tracking-wide text-white/50">Your season, week by week</h4>
            {/* Wrapped, not scrolled: the whole season is read at a glance, and a phone gets more rows rather than a hidden end. */}
            <ol className="flex flex-wrap gap-1.5">
              {preview.weeks.map((w) => (
                <li
                  key={w.week}
                  data-testid={`guillotine-preview-week-${w.week}`}
                  data-kind={w.kind}
                  className={`flex w-[62px] flex-none flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-center ${
                    w.kind === 'chop' ? (w.chops > 1 ? 'border-rose-400/60 bg-rose-500/15' : 'border-white/15 bg-white/[0.04]') : w.kind === 'final' ? 'border-amber-400/50 bg-amber-500/10' : 'border-dashed border-white/15'
                  }`}
                >
                  <span className="text-[11px] uppercase tracking-wide text-white/45">Wk {w.week}</span>
                  <span className={`text-[13px] font-semibold ${w.kind === 'chop' ? (w.chops > 1 ? 'text-rose-200' : 'text-white') : 'text-white/55'}`}>
                    {w.kind === 'chop' ? `−${w.chops}` : w.kind === 'final' ? 'Final' : w.kind === 'waiting' ? '·' : 'None'}
                  </span>
                  <span className="text-[11px] text-white/50">{w.aliveAfter} left</span>
                </li>
              ))}
            </ol>
            {preview.fit.fits ? (
              <p className="text-[12px] text-white/60" data-testid="guillotine-preview-result">
                {calendar!.threshold === 1 ? 'The last team standing' : `The final ${calendar!.threshold}`} is decided in week {preview.fit.finishWeek}.
              </p>
            ) : (
              <p role="alert" className="text-[12px] text-red-300" data-testid="guillotine-preview-result">
                {calendarFitMessage(calendar!, preview.fit)}
              </p>
            )}
          </div>
        ) : null}
      </Group>

      {/* ---------- 2. After a chop ---------- */}
      <Group id="after" title="After a chop" sub="What happens to the chopped team's players and money.">
        <Field label="When chopped players are released" help={releaseHelp}>
          <select className={inputClass} value={rules.rosterReleaseTiming} onChange={(e) => update({ rosterReleaseTiming: e.target.value as GuillotineRules['rosterReleaseTiming'] })} data-testid="guillotine-rules-release">
            {RELEASE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>

        <Field label="A chopped team's unspent FAAB" help={faabHelp} paid={paidLocked('faabOnChop')}>
          <div className="grid items-end gap-2 sm:grid-cols-[2fr_1fr]">
            <select className={inputClass} value={rules.faabOnChop} onChange={(e) => update({ faabOnChop: e.target.value as FaabOnChop })} data-testid="guillotine-rules-faab-on-chop">
              {FAAB_ON_CHOP_OPTIONS.map((o) => {
                // Without AF Commissioner only "keep" is selectable — and the current value, so the page still shows it.
                const locked = paidLocked('faabOnChop') && o.value !== 'keep' && o.value !== rules.faabOnChop
                return (
                  <option key={o.value} value={o.value} disabled={locked}>
                    {o.label}{paidLocked('faabOnChop') && o.value !== 'keep' ? ' · AF Commissioner' : ''}
                  </option>
                )
              })}
            </select>
            {/* How much of it moves; the rest leaves with the team. Only asked when a rule moves it at all. */}
            {movesChoppedFaab(rules.faabOnChop) ? (
              <label className="text-[11px] text-white/50">How much of it
                <select className={inputClass} value={faabPercent} disabled={paidLocked('faabOnChopPercent')} onChange={(e) => update({ faabOnChopPercent: Number(e.target.value) })} data-testid="guillotine-rules-faab-percent">
                  {faabPercentChoices.map((p) => <option key={p} value={p}>{p === 100 ? 'All of it' : `${p}%`}</option>)}
                </select>
              </label>
            ) : null}
          </div>
        </Field>

        <Field label="Survivors' FAAB after a chop" paid={scheduleLocked} help="What every surviving team's FAAB becomes once a team is chopped, so the released players are worth bidding on. Cannot be on together with passing the chopped team's FAAB to survivors.">
          <div className="grid grid-cols-[1fr_1fr] items-end gap-2">
            <select className={inputClass} value={advanced.faab.mode} disabled={scheduleLocked} data-testid="guillotine-faab-mode"
              onChange={(e) => {
                const mode = e.target.value as FaabAfterChop['mode']
                updateAdvanced({ ...advanced, faab: { mode, amount: mode === 'unchanged' ? 0 : Math.max(mode === 'add' ? 1 : 0, advanced.faab.amount || 100) } })
              }}>
              <option value="unchanged">Stays the same</option>
              <option value="add">Topped up by</option>
              <option value="set">Resets to</option>
            </select>
            {advanced.faab.mode !== 'unchanged' && (
              <input type="number" inputMode="numeric" aria-label="Amount in dollars" min={advanced.faab.mode === 'add' ? 1 : 0} max={MAX_FAAB_AMOUNT} className={inputClass} value={advanced.faab.amount} disabled={scheduleLocked} data-testid="guillotine-faab-amount"
                onChange={(e) => updateAdvanced({ ...advanced, faab: { ...advanced.faab, amount: Math.round(Number(e.target.value)) } })} />
            )}
          </div>
        </Field>
      </Group>

      {/* ---------- Roster changes during the season ---------- */}
      {roster && (
        <Group id="roster" title="Roster changes during the season" sub="Add or take away spots on a set week. AllFantasy changes every team's roster for you.">
          <Field label="Scheduled changes" paid={scheduleLocked} help="A new starting spot stays empty until its manager fills it. A spot that is taken away becomes a bench spot, and the player in it moves to the bench between weeks.">
            <p className="text-[12px] text-white/60" data-testid="guillotine-roster-now">Right now every team has {describeLayout(roster.layout, roster.spots)}.</p>
            {rosterDone.map((c) => (
              <p key={c.id} className="rounded-lg border border-white/10 px-3 py-2 text-[12px] text-white/50" data-testid={`guillotine-roster-done-${c.id}`}>
                Week {c.week}: {describeRosterChange(c, roster.spots)}. {rosterSkipped.has(c.id) ? `Not made: ${rosterSkipped.get(c.id)}` : 'Done.'}
              </p>
            ))}
            {rosterChanges.map((c) => (
              <div key={c.id} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-white/10 p-3 sm:grid-cols-[0.55fr_1.9fr_1.7fr_0.6fr_auto]" data-testid="guillotine-roster-change">
                <label className="order-1 text-[11px] text-white/50 sm:order-none">Week
                  <select className={inputClass} value={c.week} disabled={scheduleLocked} onChange={(e) => editRoster(c.id, { week: Number(e.target.value) })} data-testid="guillotine-roster-week">
                    {[...new Set([...rosterWeeks, c.week])].sort((a, b) => a - b).map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </label>
                <label className="order-3 col-span-2 text-[11px] text-white/50 sm:order-none sm:col-span-1">What happens
                  <select className={inputClass} value={c.kind} disabled={scheduleLocked} onChange={(e) => editRoster(c.id, { kind: e.target.value as RosterChangeKind })} data-testid="guillotine-roster-kind">
                    {ROSTER_CHANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                {rosterChangeNeedsSlot(c.kind) ? (
                  <label className="order-4 col-span-2 text-[11px] text-white/50 sm:order-none sm:col-span-1">Starting spot
                    <select className={inputClass} value={c.slot ?? ''} disabled={scheduleLocked} onChange={(e) => editRoster(c.id, { slot: e.target.value })} data-testid="guillotine-roster-slot">
                      {roster.spots.starters.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </label>
                ) : (
                  <span className="hidden sm:block" aria-hidden />
                )}
                <label className="order-2 text-[11px] text-white/50 sm:order-none">How many
                  <select className={inputClass} value={c.count} disabled={scheduleLocked} onChange={(e) => editRoster(c.id, { count: Number(e.target.value) })} data-testid="guillotine-roster-count">
                    {Array.from({ length: MAX_SPOTS_PER_CHANGE }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                {/* Removing is never locked: a lapsed plan must still be able to cancel a change. */}
                <button type="button" className={`${ghostBtn} order-5 col-span-2 sm:order-none sm:col-span-1`} onClick={() => updateRoster(rosterChanges.filter((x) => x.id !== c.id))} data-testid="guillotine-roster-remove">
                  Remove
                </button>
              </div>
            ))}
            {rosterWeeks.length === 0 ? (
              <p className="text-[12px] text-white/50" data-testid="guillotine-roster-closed">The season is in its last week, so there is no later week to schedule a change for.</p>
            ) : (
              <button type="button" className={ghostBtn} disabled={scheduleLocked || rosterChanges.length >= MAX_ROSTER_CHANGES} onClick={addRoster} data-testid="guillotine-roster-add">
                Add a roster change
              </button>
            )}
            {rosterBlocked && !rosterBlocked.ok ? (
              <p role="alert" className="text-[12px] text-red-300" data-testid="guillotine-roster-result">
                Week {rosterBlocked.change.week}: {rosterBlocked.reason}
              </p>
            ) : rosterByWeek.length > 0 ? (
              <ul className="space-y-0.5 text-[12px] text-white/60" data-testid="guillotine-roster-result">
                {rosterByWeek.map((w) => <li key={w.week}>From week {w.week}: {w.text}.</li>)}
              </ul>
            ) : null}
          </Field>
        </Group>
      )}

      {/* ---------- 3. Ties and fairness ---------- */}
      <Group id="fairness" title="Ties and fairness" sub="How a tie at the bottom is settled, and what protects a team.">
        <Field label="Tiebreakers, in order" paid={paidLocked('tiebreakerOrder')} help="When the lowest scores tie, the first rule that separates them decides.">
          <ol className="space-y-1.5">
            {rules.tiebreakerOrder.map((step, i) => (
              <li key={step} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[13px] text-white/85">
                <span className="w-5 shrink-0 text-white/40">{i + 1}.</span>
                <span className="min-w-0 flex-1">{tiebreakLabel(step, rules.periodWeeks)}</span>
                <button type="button" aria-label="Move up" className="rounded p-1 text-white/60 hover:bg-white/10 disabled:opacity-30" disabled={paidLocked('tiebreakerOrder') || i === 0} onClick={() => moveTiebreak(i, -1)}>
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </button>
                <button type="button" aria-label="Move down" className="rounded p-1 text-white/60 hover:bg-white/10 disabled:opacity-30" disabled={paidLocked('tiebreakerOrder') || i === rules.tiebreakerOrder.length - 1} onClick={() => moveTiebreak(i, 1)}>
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
        </Field>

        <Field label="Wait for stat corrections" paid={paidLocked('statCorrectionHours')} help="Hours after a week's last game before the chop is final. Longer is fairer; shorter is faster.">
          <input type="number" inputMode="numeric" min={RULE_LIMITS.statCorrectionHours.min} max={RULE_LIMITS.statCorrectionHours.max} className={inputClass} value={rules.statCorrectionHours} disabled={paidLocked('statCorrectionHours')}
            onChange={(e) => update({ statCorrectionHours: Math.round(Number(e.target.value) || 0) })} data-testid="guillotine-rules-stat-hours" />
        </Field>

        <Toggle
          label="Top-scorer immunity"
          help="Each week's top scorer cannot be chopped the next week. Skipped in a week it would leave too few teams to chop."
          paid={scheduleLocked}
          checked={advanced.immunity === 'top_scorer'}
          disabled={scheduleLocked}
          onChange={(on) => updateAdvanced({ ...advanced, immunity: on ? 'top_scorer' : 'off' })}
          testId="guillotine-immunity"
        />
      </Group>

      {/* ---------- 4. How the season ends ---------- */}
      <Group id="ending" title="How the season ends">
        <Field label="Endgame" help={view.endgameLocked ? 'Fixed for this season: the first chop has happened.' : endgameHelp}>
          <select className={inputClass} value={rules.endgame} disabled={view.endgameLocked} onChange={(e) => update({ endgame: e.target.value as GuillotineRules['endgame'] })} data-testid="guillotine-rules-endgame">
            {ENDGAME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
      </Group>

      {/* ---------- 5. Lineups and the page ---------- */}
      <Group id="page" title="Lineups and the Chop page">
        <Toggle
          label="Best ball lineups"
          help={
            view.bestBallLocked
              ? `Fixed for this season: the draft has started. ${rules.bestBall ? 'Every team plays its best possible lineup each week.' : 'Managers set their own lineups.'}`
              : "Nobody sets a lineup: each week every team is scored on its best possible lineup from its players' points. Can only be changed before the draft."
          }
          helpTestId="guillotine-rules-best-ball-help"
          checked={rules.bestBall === true}
          disabled={view.bestBallLocked === true}
          onChange={(on) => update({ bestBall: on })}
          testId="guillotine-rules-best-ball"
        />
        <Toggle
          label="Chimmy writes the weekly recap"
          help={
            view.aiRecapAvailable
              ? 'After every chop, Chimmy posts a story-style recap to league chat. Off = the standard recap.'
              : 'Included with AF Pro or AF Commissioner. Without one, the standard recap posts after every chop.'
          }
          checked={rules.aiRecapAuto && view.aiRecapAvailable}
          disabled={!view.aiRecapAvailable}
          onChange={(on) => update({ aiRecapAuto: on })}
          testId="guillotine-rules-ai-recap"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Danger zone margin (points)" paid={paidLocked('dangerMarginPoints')} help="Teams within this many points of the chop line are shown in danger.">
            <input type="number" inputMode="numeric" min={RULE_LIMITS.dangerMarginPoints.min} max={RULE_LIMITS.dangerMarginPoints.max} className={inputClass} value={rules.dangerMarginPoints} disabled={paidLocked('dangerMarginPoints')}
              onChange={(e) => update({ dangerMarginPoints: Math.round(Number(e.target.value) || 0) })} data-testid="guillotine-rules-danger-margin" />
          </Field>
          {/* A display choice, free for every commissioner (lib/guillotine/chopListOrder.ts): it changes no score or chop. */}
          <Field label="Chop page list" help={CHOP_LIST_ORDER_OPTIONS.find((o) => o.value === listOrder)?.help}>
            <select className={inputClass} value={listOrder} onChange={(e) => update({ chopListOrder: e.target.value as ChopListOrder })} data-testid="guillotine-rules-list-order">
              {CHOP_LIST_ORDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>
      </Group>

      {error && <p role="alert" className="text-[12px] text-red-300" data-testid="guillotine-rules-error">{error}</p>}
      {ok && <p role="status" className="text-[12px] text-emerald-300" data-testid="guillotine-rules-saved">✓ Saved. These rules apply from the next chop.</p>}
      <SettingsSubPageFooter>
        <button type="button" className="lsh-primary" disabled={!dirty || saving || !firstWeekValid || Boolean(rosterBlocked)} onClick={() => void submit()} data-testid="lsh-save">
          {saving ? 'Saving…' : 'Save Guilly rules'}
        </button>
      </SettingsSubPageFooter>
    </div>
  )
}

/** The changes a commissioner can still edit: stored, and not yet run. */
function waitingRosterChanges(roster: RosterScheduleView | null | undefined): RosterChange[] {
  if (!roster || !roster.supported) return []
  const ran = new Set(roster.done)
  return roster.changes.filter((c) => !ran.has(c.id))
}

/** Flex when the sport has one, else its first starting spot. */
function defaultStarterSpot(roster: RosterScheduleView | null): string | null {
  const starters = roster?.spots.starters ?? []
  return (starters.find((s) => s.key === 'FLEX') ?? starters[0])?.key ?? null
}

function Group({ id, title, sub, children }: { id: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-white/10 p-4" data-testid={`guillotine-group-${id}`} aria-labelledby={`guillotine-group-${id}-title`}>
      <header>
        <h2 id={`guillotine-group-${id}-title`} className="text-[15px] font-semibold text-white">{title}</h2>
        {sub ? <p className="text-[12px] text-white/50">{sub}</p> : null}
      </header>
      {children}
    </section>
  )
}

function Field({ label, help, paid, children }: { label: string; help?: string; paid?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
        {label}
        {paid ? <Lock className="h-3.5 w-3.5 text-violet-300" aria-label="AF Commissioner" /> : null}
      </h3>
      {children}
      {help ? <p className="text-[12px] text-white/50">{help}</p> : null}
    </div>
  )
}

function Toggle({ label, help, helpTestId, paid, checked, disabled, onChange, testId }: {
  label: string
  help: string
  helpTestId?: string
  paid?: boolean
  checked: boolean
  disabled?: boolean
  onChange: (on: boolean) => void
  testId: string
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3">
      <span>
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
          {label}
          {paid ? <Lock className="h-3.5 w-3.5 text-violet-300" aria-label="AF Commissioner" /> : null}
        </span>
        <span className="block text-[12px] text-white/50" data-testid={helpTestId}>{help}</span>
      </span>
      <input type="checkbox" className="h-5 w-5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
    </label>
  )
}
