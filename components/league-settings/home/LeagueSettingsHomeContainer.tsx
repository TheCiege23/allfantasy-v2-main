'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, ChevronRight } from 'lucide-react'
import type { SubPanelContext } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'
import {
  buildLeagueSettingsHome,
  isGuillotineSettingsLeague,
  type SettingsSubPageId,
} from '@/lib/league-settings-home/buildLeagueSettingsHome'
import { readSavedLeagueOverrides } from '@/lib/league-settings/savedLeagueOverrides'
import { leagueJoinUrl, nativeLeagueInviteCode } from '@/lib/league/league-invite-link'
import { getGuillotineSportConfig } from '@/lib/guillotine/sportConfig'
import { LeagueSettingsHome, type SettingsSubPageRender } from './LeagueSettingsHome'
import { GuillotineFirstChopEditor, patchFirstChopWeek } from './GuillotineFirstChopEditor'
import { GuillotineRulesEditor } from './GuillotineRulesEditor'
import { GuillotineChopRulesEditor, patchChopRules } from './GuillotineChopRulesEditor'
import { SUB_PAGE_TITLES } from './LeagueSettingsSubPageTitles'
import { CommissionerCenter } from './CommissionerCenter'
import { SettingsLockPanel } from './SettingsLockPanel'
import { ScoreAdjustmentsWithCorrections } from './StatCorrectionsCard'
import { SurvivorTribesPanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorTribesPanel'
import { nativeLeaguePhase } from '@/lib/league/nativeLeagueNavigation'
import { buildSetupDecisions } from '@/lib/league-settings-home/setupDecisions'
import { SetupDecisionsCard } from './SetupDecisionsCard'
import { useLeagueSettingsSources } from './useLeagueSettingsSources'
import { leagueSettingsLabels } from './leagueSettingsLabels'
import { buildLeagueRulebook } from '@/lib/league-rules/buildLeagueRulebook'
import { LeagueRulebook } from '@/components/league-rules/LeagueRulebook'

/** The Commissioner center needs room for its two columns; phones keep the list → sub-page flow. */
function useWideLayout(): boolean {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(min-width: 1024px)')
    const sync = () => setWide(query.matches)
    sync()
    query.addEventListener?.('change', sync)
    return () => query.removeEventListener?.('change', sync)
  }, [])
  return wide
}

// The editors carry most of the old settings tree; load them only when a row is opened.
const LeagueSettingsSubPageBody = dynamic(() => import('./LeagueSettingsSubPageBody'), {
  ssr: false,
  loading: () => <p className="lsh-help">Loading…</p>,
})

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
  const sources = useLeagueSettingsSources(leagueId, guillotine, reloadKey)
  const { rosterSlots, draft, guillotine: guillotineState, setGuillotine: setGuillotineState } = sources
  const hasAfCommissionerSub = sources.hasAfCommissionerSub ?? Boolean(ctx.hasAfCommissionerSub)

  // Values saved this page-session (autosaving tabs record them) win over the stale page props.
  const effectiveLeague = useMemo(
    () => ({ ...league, ...readSavedLeagueOverrides(leagueId) }) as typeof league,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [league, leagueId, reloadKey],
  )

  const labels = useMemo(() => leagueSettingsLabels(effectiveLeague), [effectiveLeague])

  const sections = useMemo(
    () =>
      buildLeagueSettingsHome({
        league: effectiveLeague,
        teams: effectiveLeague.teams ?? [],
        canEdit: ctx.isCommissioner,
        ...labels,
        rosterSlots,
        draft,
        guillotine: guillotineState,
        inviteUrl: leagueJoinUrl(nativeLeagueInviteCode(effectiveLeague.settings, effectiveLeague.invites)),
      }),
    [effectiveLeague, ctx.isCommissioner, labels, rosterSlots, draft, guillotineState],
  )

  const rulebook = useMemo(
    () => buildLeagueRulebook({ league: effectiveLeague, ...labels, rosterSlots, draft, guillotine: guillotineState }),
    [effectiveLeague, labels, rosterSlots, draft, guillotineState],
  )

  const subCtx = useMemo(() => ({ ...ctx, league: effectiveLeague, hasAfCommissionerSub }), [ctx, effectiveLeague, hasAfCommissionerSub])

  const renderSubPage = useCallback(
    (id: SettingsSubPageId): SettingsSubPageRender | null => {
      // Every member may read the rules; only the commissioner opens an editor.
      if (id === 'rulebook') return { title: SUB_PAGE_TITLES[id], content: <LeagueRulebook sections={rulebook} /> }
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
      return {
        title: SUB_PAGE_TITLES[id],
        content: <LeagueSettingsSubPageBody id={id} ctx={subCtx} hasAfCommissionerSub={hasAfCommissionerSub} />,
      }
    },
    [ctx.isCommissioner, guillotineState, setGuillotineState, league.sport, leagueId, subCtx, hasAfCommissionerSub, rulebook],
  )

  const wide = useWideLayout()
  const phase = nativeLeaguePhase(ctx.displayLeague)
  // Before the draft, the commissioner is walked through the five settings that matter most.
  const setupDecisions = useMemo(() => buildSetupDecisions(sections), [sections])
  const showSetup = ctx.isCommissioner && phase === 'Setup'
  const header = (open: (id: SettingsSubPageId) => void) => (
    <>
      <button type="button" className="lsh-rules-link" onClick={() => open('rulebook')} data-testid="lsh-open-rulebook">
        <BookOpen size={18} aria-hidden />
        <span>
          <strong>Rules explained</strong>
          <span>What every setting in this league means</span>
        </span>
        <ChevronRight size={18} aria-hidden />
      </button>
      {showSetup ? <SetupDecisionsCard leagueId={leagueId} decisions={setupDecisions} onOpen={open} /> : null}
    </>
  )

  if (wide && ctx.isCommissioner) {
    const teams = effectiveLeague.teams ?? []
    const inviteRow = sections.flatMap((section) => section.rows).find((row) => row.id === 'invite')
    return (
      <CommissionerCenter
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
      initialSubPage={ctx.isCommissioner || initialSubPage === 'rulebook' ? initialSubPage : null}
      header={header}
    />
  )
}
