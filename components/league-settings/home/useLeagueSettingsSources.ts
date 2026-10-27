'use client'

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { SettingsHomeDraft, SettingsHomeGuillotine } from '@/lib/league-settings-home/buildLeagueSettingsHome'
import type { GuillotineAdvanced } from '@/lib/guillotine/chopSchedule'

type Json = Record<string, unknown>

async function getJson(url: string, signal: AbortSignal): Promise<Json | null> {
  try {
    const res = await fetch(url, { credentials: 'include', signal, cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as Json
  } catch {
    return null
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export type LeagueSettingsSources = {
  /** null = still loading; {} = loaded but empty. */
  rosterSlots: Record<string, number> | null
  draft: SettingsHomeDraft | null
  /** null = loading, or not a guillotine league. */
  guillotine: SettingsHomeGuillotine | null
  setGuillotine: Dispatch<SetStateAction<SettingsHomeGuillotine | null>>
  /** The draft settings GET's AF Commissioner check, when it reports one. */
  hasAfCommissionerSub: boolean | null
}

/**
 * The values the League Settings list and the rules page show that the league row does not carry:
 * roster slots, the draft settings and (Guilly) the chop config. Read from the existing GET
 * endpoints; `reloadKey` refetches after an editor closes, and `enabled: false` fetches nothing.
 */
export function useLeagueSettingsSources(leagueId: string, guillotine: boolean, reloadKey = 0, enabled = true): LeagueSettingsSources {
  const [rosterSlots, setRosterSlots] = useState<Record<string, number> | null>(null)
  const [draft, setDraft] = useState<SettingsHomeDraft | null>(null)
  const [guillotineState, setGuillotine] = useState<SettingsHomeGuillotine | null>(null)
  const [hasAfCommissionerSub, setHasAfCommissionerSub] = useState<boolean | null>(null)

  useEffect(() => {
    if (!enabled) return
    const ac = new AbortController()
    const id = encodeURIComponent(leagueId)
    void getJson(`/api/commissioner/leagues/${id}/roster-settings`, ac.signal).then((d) => {
      if (ac.signal.aborted) return
      const slots = (d?.config as Json | undefined)?.slots
      setRosterSlots(slots && typeof slots === 'object' ? (slots as Record<string, number>) : {})
    })
    void getJson(`/api/leagues/${id}/draft/settings`, ac.signal).then((d) => {
      if (ac.signal.aborted) return
      const cfg = (d?.config as Json | undefined) ?? {}
      setDraft({
        dateIso: typeof d?.draftDate === 'string' ? d.draftDate : null,
        type: typeof cfg.draft_type === 'string' ? cfg.draft_type : null,
        rounds: num(cfg.rounds) ?? num(d?.computedRounds),
        timerSeconds: num(cfg.timer_seconds),
        autostart: typeof d?.autostartEnabled === 'boolean' ? d.autostartEnabled : null,
      })
      if (typeof d?.hasAfCommissionerSub === 'boolean') setHasAfCommissionerSub(d.hasAfCommissionerSub)
    })
    if (guillotine) {
      void getJson(`/api/leagues/${id}/guillotine/summary`, ac.signal).then((d) => {
        if (ac.signal.aborted) return
        const cfg = (d?.config as Json | undefined) ?? {}
        const events = Array.isArray(d?.recentChopEvents) ? (d?.recentChopEvents as unknown[]) : []
        setGuillotine({
          firstChopWeek: num(cfg.eliminationStartWeek) ?? 1,
          endWeek: num(cfg.eliminationEndWeek),
          locked: events.length > 0,
          scheduleLines: Array.isArray(cfg.scheduleLines) ? (cfg.scheduleLines as unknown[]).filter((l): l is string => typeof l === 'string') : [],
          advanced: cfg.advanced && typeof cfg.advanced === 'object' ? (cfg.advanced as GuillotineAdvanced) : null,
          teamsPerChop: num(cfg.teamsPerChop) ?? 1,
          canEditPaidRules: typeof cfg.canEditPaidRules === 'boolean' ? cfg.canEditPaidRules : null,
          tiebreakerOrder: Array.isArray(cfg.tiebreakerOrder) ? (cfg.tiebreakerOrder as unknown[]).filter((s): s is string => typeof s === 'string') : [],
          rosterReleaseTiming: typeof cfg.rosterReleaseTiming === 'string' ? cfg.rosterReleaseTiming : null,
          dangerMarginPoints: num(cfg.dangerMarginPoints),
          blindAuction: typeof cfg.blindAuction === 'boolean' ? cfg.blindAuction : null,
        })
      })
    }
    return () => ac.abort()
  }, [leagueId, guillotine, reloadKey, enabled])

  return { rosterSlots, draft, guillotine: guillotineState, setGuillotine, hasAfCommissionerSub }
}
