'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SubPanelContext } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'
import {
  buildLeagueSettingsHome,
  isGuillotineSettingsLeague,
  type SettingsHomeDraft,
  type SettingsHomeGuillotine,
  type SettingsSubPageId,
} from '@/lib/league-settings-home/buildLeagueSettingsHome'
import { readSavedLeagueOverrides } from '@/lib/league-settings/savedLeagueOverrides'
import { getLeagueTypeMedia, resolveLeagueConceptIntroKey } from '@/lib/league-media/leagueTypeMedia'
import { findScoringPresetRule } from '@/lib/league-creation-preset/scoring-presets'
import { leagueJoinUrl, nativeLeagueInviteCode } from '@/lib/league/league-invite-link'
import { getGuillotineSportConfig } from '@/lib/guillotine/sportConfig'
import { LeagueSettingsHome, type SettingsSubPageRender } from './LeagueSettingsHome'
import { GuillotineFirstChopEditor, patchFirstChopWeek } from './GuillotineFirstChopEditor'
import { GuillotineRulesEditor } from './GuillotineRulesEditor'
import { GuillotineChopRulesEditor, patchChopRules } from './GuillotineChopRulesEditor'
import { PirateRulesEditor } from './PirateRulesEditor'
import type { PirateRules } from '@/lib/pirate/rules'
import type { GuillotineAdvanced } from '@/lib/guillotine/chopSchedule'
import { SUB_PAGE_TITLES } from './LeagueSettingsSubPageTitles'
import { CommissionerCenter } from './CommissionerCenter'
import { SettingsLockPanel } from './SettingsLockPanel'
import { ScoreAdjustmentsWithCorrections } from './StatCorrectionsCard'
import { SurvivorTribesPanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorTribesPanel'
import { nativeLeaguePhase } from '@/lib/league/nativeLeagueNavigation'
import { buildSetupDecisions } from '@/lib/league-settings-home/setupDecisions'
import { SetupDecisionsCard } from './SetupDecisionsCard'

// The editors carry most of the old settings tree; load them only when a row is opened.
const LeagueSettingsSubPageBody = dynamic(() => import('./LeagueSettingsSubPageBody'), {
  ssr: false,
  loading: () => <p className="lsh-help">Loading…</p>,
})

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

/**
 * The League Settings page for a real league: reads the current values from the existing GET
 * endpoints, builds the list, and opens the existing editors as sub-pages. Saving is never done
 * here — each editor keeps the save route it already had.
 */
export function LeagueSettingsHomeContainer({
  ctx,
  onExit,
  initialSubPage = null,
}: {
  ctx: SubPanelContext
  onExit?: () => void
  /** Opens straight into this sub-page (an old settings link routed here); members get the list. */
  initialSubPage?: SettingsSubPageId | null
}) {
  const league = ctx.league
  const leagueId = league.id
  const guillotine = isGuillotineSettingsLeague(league)
  const [reloadKey, setReloadKey] = useState(0)
  const [rosterSlots, setRosterSlots] = useState<Record<string, number> | null>(null)
  const [draft, setDraft] = useState<SettingsHomeDraft | null>(null)
  const [hasAfCommissionerSub, setHasAfCommissionerSub] = useState(Boolean(ctx.hasAfCommissionerSub))
  const [guillotineState, setGuillotineState] = useState<SettingsHomeGuillotine | null>(null)
  const [pirateRules, setPirateRules] = useState<PirateRules | null>(null)

  useEffect(() => {
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
        setGuillotineState({
          firstChopWeek: num(cfg.eliminationStartWeek) ?? 1,
          endWeek: num(cfg.eliminationEndWeek),
          locked: events.length > 0,
          scheduleLines: Array.isArray(cfg.scheduleLines) ? (cfg.scheduleLines as unknown[]).filter((l): l is string => typeof l === 'string') : [],
          advanced: cfg.advanced && typeof cfg.advanced === 'object' ? (cfg.advanced as GuillotineAdvanced) : null,
          teamsPerChop: num(cfg.teamsPerChop) ?? 1,
          canEditPaidRules: typeof cfg.canEditPaidRules === 'boolean' ? cfg.canEditPaidRules : null,
        })
      })
    }
    return () => ac.abort()
  }, [leagueId, guillotine, reloadKey])

  // Values saved this page-session (autosaving tabs record them) win over the stale page props.
  const effectiveLeague = useMemo(
    () => ({ ...league, ...readSavedLeagueOverrides(leagueId) }) as typeof league,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [league, leagueId, reloadKey],
  )

  const sections = useMemo(() => {
    const conceptKey = resolveLeagueConceptIntroKey({
      leagueType: effectiveLeague.leagueType,
      leagueVariant: effectiveLeague.leagueVariant,
      settings: effectiveLeague.settings,
      isDynasty: effectiveLeague.isDynasty,
      guillotineMode: effectiveLeague.guillotineMode,
      bestBallMode: effectiveLeague.bestBallMode,
    })
    return buildLeagueSettingsHome({
      league: effectiveLeague,
      teams: effectiveLeague.teams ?? [],
      canEdit: ctx.isCommissioner,
      formatLabel: getLeagueTypeMedia(conceptKey).label,
      scoringLabel:
        (effectiveLeague.scoringPresetId ? findScoringPresetRule(effectiveLeague.scoringPresetId)?.label : null) ?? null,
      rosterSlots,
      draft,
      guillotine: guillotineState,
      pirateRules,
      inviteUrl: leagueJoinUrl(nativeLeagueInviteCode(effectiveLeague.settings, effectiveLeague.invites)),
    })
  }, [effectiveLeague, ctx.isCommissioner, rosterSlots, draft, guillotineState, pirateRules])

  const subCtx = useMemo(() => ({ ...ctx, league: effectiveLeague, hasAfCommissionerSub }), [ctx, effectiveLeague, hasAfCommissionerSub])

  const renderSubPage = useCallback(
    (id: SettingsSubPageId): SettingsSubPageRender | null => {
      if (!ctx.isCommissioner) return null
      if (id === 'survivor-tribes') {
        return {
          title: SUB_PAGE_TITLES[id],
          content: <SurvivorTribesPanel leagueId={leagueId} canEdit={ctx.isCommissioner} hasAfCommissionerSub={hasAfCommissionerSub} />,
        }
      }
      if (id === 'settings-lock') {
        return { title: SUB_PAGE_TITLES[id], content: <SettingsLockPanel leagueId={leagueId} /> }
      }
      if (id === 'score-adjustments') {
        return {
          title: SUB_PAGE_TITLES[id],
          content: <ScoreAdjustmentsWithCorrections leagueId={leagueId} />,
        }
      }
      if (id === 'guillotine-first-chop') {
        if (!guillotineState) return null
        const profile = getGuillotineSportConfig(String(league.sport ?? 'NFL'))
        return {
          title: SUB_PAGE_TITLES[id],
          content: (
            <GuillotineFirstChopEditor
              initialWeek={guillotineState.firstChopWeek}
              endWeek={guillotineState.endWeek ?? profile?.regularSeasonWeeks ?? 18}
              locked={guillotineState.locked}
              chopLabel={profile?.chopLabel ?? null}
              save={patchFirstChopWeek(leagueId)}
              onSaved={(week) => setGuillotineState((s) => (s ? { ...s, firstChopWeek: week } : s))}
            />
          ),
        }
      }
      if (id === 'guillotine-chop-rules') {
        if (!guillotineState) return null
        const profile = getGuillotineSportConfig(String(league.sport ?? 'NFL'))
        return {
          title: SUB_PAGE_TITLES[id],
          content: (
            <GuillotineChopRulesEditor
              initial={guillotineState.advanced ?? null}
              baseChops={guillotineState.teamsPerChop ?? 1}
              startWeek={guillotineState.firstChopWeek}
              endWeek={guillotineState.endWeek ?? profile?.regularSeasonWeeks ?? 18}
              hasAfCommissionerSub={guillotineState.canEditPaidRules ?? hasAfCommissionerSub}
              save={patchChopRules(leagueId)}
              onSaved={(advanced, lines) => setGuillotineState((s) => (s ? { ...s, advanced, scheduleLines: lines } : s))}
            />
          ),
        }
      }
      if (id === 'guillotine-rules') {
        return {
          title: SUB_PAGE_TITLES[id],
          content: (
            <GuillotineRulesEditor
              leagueId={leagueId}
              onSaved={(rules) => setGuillotineState((s) => (s ? { ...s, teamsPerChop: rules.teamsPerChop, endWeek: rules.eliminationEndWeek } : s))}
            />
          ),
        }
      }
      if (id === 'pirate-rules') {
        return { title: SUB_PAGE_TITLES[id], content: <PirateRulesEditor leagueId={leagueId} onSaved={setPirateRules} /> }
      }
      return {
        title: SUB_PAGE_TITLES[id],
        content: <LeagueSettingsSubPageBody id={id} ctx={subCtx} hasAfCommissionerSub={hasAfCommissionerSub} />,
      }
    },
    [ctx.isCommissioner, guillotineState, league.sport, leagueId, subCtx, hasAfCommissionerSub],
  )

  const phase = nativeLeaguePhase(ctx.displayLeague)
  // Before the draft, the commissioner is walked through the five settings that matter most.
  const setupDecisions = useMemo(() => buildSetupDecisions(sections), [sections])
  const header =
    ctx.isCommissioner && phase === 'Setup'
      ? (open: (id: SettingsSubPageId) => void) => <SetupDecisionsCard leagueId={leagueId} decisions={setupDecisions} onOpen={open} />
      : undefined

  if (ctx.isCommissioner) {
    const teams = effectiveLeague.teams ?? []
    const inviteRow = sections.flatMap((section) => section.rows).find((row) => row.id === 'invite')
    return (
      <CommissionerCenter
        leagueId={leagueId}
        leagueName={effectiveLeague.name}
        sections={sections}
        renderSubPage={renderSubPage}
        onExit={onExit}
        initialSubPage={initialSubPage}
        inSeason={phase === 'Regular season' || phase === 'Playoffs'}
        managers={{
          joined: teams.filter((t) => Boolean(t.claimedByUserId)).length,
          total: effectiveLeague.leagueSize ?? teams.length,
          inviteUrl: inviteRow?.copyText ?? null,
        }}
        onSubPageClosed={() => setReloadKey((k) => k + 1)}
        header={header}
      />
    )
  }

  return (
    <LeagueSettingsHome
      leagueName={effectiveLeague.name}
      sections={sections}
      canEdit={ctx.isCommissioner}
      renderSubPage={renderSubPage}
      onExit={onExit}
      onSubPageClosed={() => setReloadKey((k) => k + 1)}
      initialSubPage={ctx.isCommissioner ? initialSubPage : null}
      header={header}
    />
  )
}
