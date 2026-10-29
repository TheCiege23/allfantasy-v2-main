'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppModal } from '@/components/ui/AppModal'
import { buildLeagueRulebook, welcomeRules, type RulebookEntry } from '@/lib/league-rules/buildLeagueRulebook'
import { diffRulebook, isRulebookComplete, rulebookSnapshot, type RuleChange, type RulesSnapshot } from '@/lib/league-rules/rulesSnapshot'
import { isGuillotineSettingsLeague } from '@/lib/league-settings-home/buildLeagueSettingsHome'
import { readSavedLeagueOverrides } from '@/lib/league-settings/savedLeagueOverrides'
import { useLeagueSettingsSources } from '@/components/league-settings/home/useLeagueSettingsSources'
import { leagueSettingsLabels } from '@/components/league-settings/home/leagueSettingsLabels'
import type { LeagueSettingsModalLeague } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'

/** The welcome sheet's per-browser flag (part 1). Still read, so nobody who saw it sees it again. */
export function rulesWelcomeStorageKey(leagueId: string, userId: string): string {
  return `af:league-rules-welcome:v1:${leagueId}:${userId}`
}

/**
 * The snapshot is compared and saved in ONE time zone. The draft time is the one value that reads
 * differently per viewer, and comparing in the viewer's own zone would report a change every time the
 * same manager opened the league from a phone in another zone.
 */
export const RULES_NOTICE_TIME_ZONE = 'America/New_York'

const PREFS_URL = '/api/core/league-preferences'

/**
 * The card lives on the league home, which remounts on every tab switch. After a check this tab
 * skips the next ones for a few minutes, so moving around a league does not refetch its rules.
 */
export const RULES_RECHECK_MS = 5 * 60 * 1000

function checkedKey(leagueId: string, userId: string): string {
  return `af:league-rules-checked:${leagueId}:${userId}`
}

function checkedRecently(key: string): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(key))
    return Number.isFinite(at) && at > 0 && Date.now() - at < RULES_RECHECK_MS
  } catch {
    return false
  }
}

function markChecked(key: string) {
  try {
    window.sessionStorage.setItem(key, String(Date.now()))
  } catch {
    // Storage blocked: the next visit simply checks again.
  }
}

function readLocalFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeLocalFlag(key: string) {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // Storage blocked: the server snapshot is what counts.
  }
}

async function loadSeen(leagueId: string): Promise<{ ok: true; seen: RulesSnapshot | null } | { ok: false }> {
  try {
    const res = await fetch(`${PREFS_URL}?rulesSeen=${encodeURIComponent(leagueId)}`, { credentials: 'include', cache: 'no-store' })
    if (!res.ok) return { ok: false }
    const body = (await res.json()) as { rulesSeen?: RulesSnapshot | null }
    return { ok: true, seen: body.rulesSeen ?? null }
  } catch {
    return { ok: false }
  }
}

async function saveSeen(leagueId: string, snapshot: RulesSnapshot): Promise<void> {
  await fetch(PREFS_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field: 'rulesSeen', leagueId, snapshot }),
  }).catch(() => undefined)
}

type Notice = { kind: 'welcome'; rules: RulebookEntry[] } | { kind: 'changed'; changes: RuleChange[] }

/**
 * What a manager is told about the league's rules on its home page, at most once per visit:
 *
 *  - **First visit**: the welcome sheet — the handful of rules that matter most, in plain words.
 *  - **After the commissioner changes a rule**: a "Rules changed" card with only what changed —
 *    before, after, and what the new rule means. Several edits since the last look are one card.
 *
 * Both compare against the rules the manager last saw, saved to their account (rulesSeenStore.ts),
 * so a phone and a laptop agree. Closing either saves what is on screen as seen. A commissioner is
 * never shown their own league's changes: their snapshot is brought up to date silently.
 * Nothing opens until every value has loaded, so a card never shows "…".
 */
export function LeagueRulesWelcome({
  league,
  userId,
  isCommissioner = false,
  blocked = false,
  onSeeAllRules,
}: {
  league: LeagueSettingsModalLeague
  userId: string
  isCommissioner?: boolean
  /** Another sheet or intro is showing; wait for it. */
  blocked?: boolean
  /** Opens League Settings → Rules explained. */
  onSeeAllRules: () => void
}) {
  const localKey = rulesWelcomeStorageKey(league.id, userId)
  // undefined = still asking the server; null = never saved on this account.
  const [seen, setSeen] = useState<RulesSnapshot | null | undefined>(undefined)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSeen(undefined)
    setDone(false)
    if (checkedRecently(checkedKey(league.id, userId))) {
      setDone(true)
      return
    }
    void loadSeen(league.id).then((r) => {
      if (cancelled) return
      // The server could not say: show nothing rather than a welcome everyone has already seen.
      if (!r.ok) setDone(true)
      else setSeen(r.seen)
    })
    return () => {
      cancelled = true
    }
  }, [league.id, userId])

  const guillotine = isGuillotineSettingsLeague(league)
  const sources = useLeagueSettingsSources(league.id, guillotine, 0, seen !== undefined && !done)
  const effectiveLeague = useMemo(() => ({ ...league, ...readSavedLeagueOverrides(league.id) }) as typeof league, [league])
  const loaded = sources.rosterSlots != null && sources.draft != null && (!guillotine || sources.guillotine != null)

  const rulebook = useMemo(() => {
    if (!loaded) return null
    const sections = buildLeagueRulebook({
      league: effectiveLeague,
      ...leagueSettingsLabels(effectiveLeague),
      rosterSlots: sources.rosterSlots,
      draft: sources.draft,
      guillotine: sources.guillotine,
      viewerTimeZone: RULES_NOTICE_TIME_ZONE,
    })
    return isRulebookComplete(sections) ? sections : null
  }, [loaded, effectiveLeague, sources.rosterSlots, sources.draft, sources.guillotine])

  const notice = useMemo<Notice | null>(() => {
    if (done || seen === undefined || !rulebook) return null
    if (seen === null) {
      // Part 1 kept "seen" in this browser only; whoever saw it there is not welcomed again.
      if (readLocalFlag(localKey)) return null
      const rules = welcomeRules(rulebook)
      return rules.length ? { kind: 'welcome', rules } : null
    }
    if (isCommissioner) return null
    const changes = diffRulebook(seen, rulebook)
    return changes.length ? { kind: 'changed', changes } : null
  }, [done, seen, rulebook, isCommissioner, localKey])

  // Nothing to show, but the snapshot is missing or out of date: bring it up to date silently.
  useEffect(() => {
    if (done || seen === undefined || !rulebook || notice) return
    const snapshot = rulebookSnapshot(rulebook)
    if (seen === null || diffRulebook(seen, rulebook).length > 0) void saveSeen(league.id, snapshot)
    markChecked(checkedKey(league.id, userId))
    setDone(true)
  }, [done, seen, rulebook, notice, league.id, userId])

  const close = () => {
    if (rulebook) void saveSeen(league.id, rulebookSnapshot(rulebook))
    writeLocalFlag(localKey)
    markChecked(checkedKey(league.id, userId))
    setDone(true)
  }

  if (!notice || blocked) return null

  const welcome = notice.kind === 'welcome'
  const leagueName = league.name?.trim() || 'this league'
  const changeCount = notice.kind === 'changed' ? notice.changes.length : 0

  return (
    <AppModal
      open
      onClose={close}
      size="sm"
      title={welcome ? `How ${leagueName} works` : `Rules changed in ${leagueName}`}
      description={
        welcome
          ? 'The rules your commissioner chose, in plain words.'
          : `Your commissioner changed ${changeCount === 1 ? 'a rule' : `${changeCount} rules`} since you last looked.`
      }
      data-testid={welcome ? 'league-rules-welcome' : 'league-rules-changed'}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={close}
            className="min-h-[44px] rounded-lg border border-white/15 px-4 text-sm font-semibold text-white/80 hover:bg-white/5"
            data-testid="league-rules-welcome-close"
          >
            Got it
          </button>
          <button
            type="button"
            onClick={() => {
              close()
              onSeeAllRules()
            }}
            className="min-h-[44px] rounded-lg bg-cyan-500 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
            data-testid="league-rules-welcome-see-all"
          >
            See all rules
          </button>
        </div>
      }
    >
      <ul className="space-y-3">
        {notice.kind === 'welcome'
          ? notice.rules.map((rule) => (
              <li key={rule.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid={`league-rules-welcome-${rule.id}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold text-white">{rule.label}</span>
                  <span className="text-[13px] text-cyan-300">{rule.value}</span>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-white/65">{rule.meaning}</p>
              </li>
            ))
          : notice.changes.map((change) => (
              <li key={change.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid={`league-rules-changed-${change.id}`}>
                <span className="text-sm font-semibold text-white">{change.label}</span>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[13px]">
                  {change.before != null ? <span className="text-white/45 line-through">{change.before}</span> : <span className="text-white/45">New</span>}
                  <span aria-hidden className="text-white/35">→</span>
                  <span className="sr-only">now</span>
                  <span className="text-cyan-300">{change.after ?? 'No longer applies'}</span>
                </p>
                {change.meaning ? <p className="mt-1.5 text-[13px] leading-relaxed text-white/65">{change.meaning}</p> : null}
              </li>
            ))}
      </ul>
    </AppModal>
  )
}
