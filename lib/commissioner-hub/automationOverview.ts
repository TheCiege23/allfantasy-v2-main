/**
 * "What runs itself" — every automation a commissioner can switch on, in one list (phase 9,
 * 2026-10-29). The switches live on about ten cards and settings pages; this reads them all and says,
 * for each, whether it is on, what it is doing, and where its switch is. It changes nothing.
 *
 * Pure: the reader (`./automationOverviewService.ts`) gathers the facts; this turns them into rows.
 */
import { tradeReviewAutoApproveOn } from '@/lib/league-trade-engine/tradeReviewAutoApprove'
import { fillEmptyStartersOn } from '@/lib/lineup-automation/fillEmptyStarters'
import { readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { readEliminatedLineupRule } from '@/lib/eliminated-lineups/eliminatedLineups'
import { readIrAutoMoveEnabled } from '@/lib/ir-activation/irAutoMove'
import { readRookieDraftCalendarSettings } from '@/lib/dynasty-core/rookieDraftCalendar'
import { readTaxiRulesEnforced } from '@/lib/taxi/taxiMoveRules'
import { readAutoHandover } from '@/lib/inactive-manager/autoHandover'

export type AutomationGroup = 'lineups' | 'drafts' | 'fairness'
export type AutomationState = 'on' | 'off' | 'needs_plan'

export type AutomationRow = {
  key: string
  group: AutomationGroup
  label: string
  state: AutomationState
  /** What it is doing right now, in a few words; null when off. */
  detail: string | null
  /** The same in Spanish. */
  detailEs: string | null
  /** Where its switch is: a Commissioner Hub card (`#…`) or a league page. */
  href: string
  plan: 'free' | 'commissioner'
}

export type AutomationFacts = {
  leagueId: string
  settings: unknown
  dynasty: boolean
  /** The league owner holds AF Commissioner. */
  commissionerPlan: boolean
  /** The rookie draft opens itself this offseason (`resolveRookieDraftAutoOpen`). */
  rookieDraftAutoOpen: boolean
  liveRookieOrderOn: boolean
  tankingMonitorOn: boolean
  tankingPenaltiesOn: boolean
  holdFlaggedTradesMode: 'off' | 'severe' | 'all'
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export function buildAutomationOverview(f: AutomationFacts): AutomationRow[] {
  const id = encodeURIComponent(f.leagueId)
  const settingsHref = `/league/${id}?view=settings`
  const integrityHref = `/league/${id}/commissioner/integrity`
  const paid = (on: boolean): AutomationState => (!f.commissionerPlan ? 'needs_plan' : on ? 'on' : 'off')
  const managed = Object.values(readManagedLineups(f.settings))
  const autopilot = managed.filter((m) => m.autopilot).length
  const eliminated = readEliminatedLineupRule(f.settings)
  const calendar = readRookieDraftCalendarSettings(f.settings)
  const fillOn = fillEmptyStartersOn(f.settings)
  const draftAsMeOn = asRecord(f.settings).draft_as_me !== false

  const rows: AutomationRow[] = [
    {
      key: 'fill_empty_starters',
      group: 'lineups',
      label: 'Fill empty starting spots before lock',
      state: fillOn ? 'on' : 'off',
      detail: fillOn ? 'From the bench, after telling the owner first' : null,
      detailEs: fillOn ? 'Desde la banca, tras avisar primero al dueño' : null,
      href: '#ch-fill-empty-starters',
      plan: 'free',
    },
    {
      key: 'managed_teams',
      group: 'lineups',
      label: 'Teams AllFantasy or Chimmy runs',
      state: managed.length > 0 ? 'on' : 'off',
      detail: managed.length > 0 ? `${managed.length} team${managed.length === 1 ? '' : 's'}${autopilot ? `, ${autopilot} on Chimmy autopilot` : ''}` : null,
      detailEs: managed.length > 0 ? `${managed.length} equipo${managed.length === 1 ? '' : 's'}${autopilot ? `, ${autopilot} con piloto automático de Chimmy` : ''}` : null,
      href: '#ch-inactive-managers',
      plan: 'free',
    },
    (() => {
      const rule = readAutoHandover(f.settings)
      return {
        key: 'auto_handover',
        group: 'lineups' as const,
        label: 'Hand over a team with no activity',
        state: rule ? ('on' as const) : ('off' as const),
        detail: rule ? `After ${rule.days} days, to ${rule.to === 'autopilot' && f.commissionerPlan ? 'Chimmy autopilot' : 'AllFantasy'}` : null,
        detailEs: rule ? `Tras ${rule.days} días, a ${rule.to === 'autopilot' && f.commissionerPlan ? 'piloto automático de Chimmy' : 'AllFantasy'}` : null,
        href: '#ch-inactive-managers',
        plan: 'free' as const,
      }
    })(),
    {
      key: 'eliminated_lineups',
      group: 'lineups',
      label: 'Lineup minimums for eliminated teams',
      state: paid(Boolean(eliminated)),
      detail: eliminated ? (eliminated.autoFill ? 'Short spots filled from the bench' : 'Managers warned') : null,
      detailEs: eliminated ? (eliminated.autoFill ? 'Puestos faltantes llenados desde la banca' : 'Se avisa a los mánagers') : null,
      href: '#ch-eliminated-lineups',
      plan: 'commissioner',
    },
    {
      key: 'ir_auto_move',
      group: 'lineups',
      label: 'Move healthy players off IR',
      state: paid(readIrAutoMoveEnabled(f.settings)),
      detail: readIrAutoMoveEnabled(f.settings) ? 'To the bench, when activated' : null,
      detailEs: readIrAutoMoveEnabled(f.settings) ? 'A la banca, al ser activados' : null,
      href: '#ch-ir-auto-move',
      plan: 'commissioner',
    },
    {
      key: 'draft_as_me',
      group: 'drafts',
      label: 'Missed picks made the way the manager drafts',
      state: paid(draftAsMeOn),
      detail: f.commissionerPlan && draftAsMeOn ? 'Every live draft' : null,
      detailEs: f.commissionerPlan && draftAsMeOn ? 'Cada draft en vivo' : null,
      href: '#ch-inactive-managers',
      plan: 'commissioner',
    },
  ]
  if (f.dynasty) {
    rows.push(
      {
        key: 'rookie_draft_opens',
        group: 'drafts',
        label: 'Rookie draft opens itself',
        state: f.rookieDraftAutoOpen ? 'on' : 'off',
        detail: f.rookieDraftAutoOpen ? (calendar.customOpenDate ? `On ${calendar.customOpenDate}` : "On the sport's calendar") : null,
        detailEs: f.rookieDraftAutoOpen ? (calendar.customOpenDate ? `El ${calendar.customOpenDate}` : 'Según el calendario del deporte') : null,
        href: settingsHref,
        plan: 'free',
      },
      {
        key: 'rookie_draft_starts',
        group: 'drafts',
        label: 'Rookie draft starts itself',
        state: calendar.autoStartDays != null ? 'on' : 'off',
        detail: calendar.autoStartDays != null ? `${calendar.autoStartDays} days after it opens` : null,
        detailEs: calendar.autoStartDays != null ? `${calendar.autoStartDays} días después de abrirse` : null,
        href: settingsHref,
        plan: 'free',
      },
      {
        key: 'live_rookie_order',
        group: 'drafts',
        label: 'Rookie draft order kept up to date',
        state: paid(f.liveRookieOrderOn),
        detail: f.commissionerPlan && f.liveRookieOrderOn ? 'Locks in as the playoffs finish' : null,
        detailEs: f.commissionerPlan && f.liveRookieOrderOn ? 'Se fija al terminar los playoffs' : null,
        href: settingsHref,
        plan: 'commissioner',
      },
    )
  }
  rows.push(
    {
      key: 'tanking',
      group: 'fairness',
      label: 'Anti-tanking monitor',
      state: paid(f.tankingMonitorOn),
      detail: f.commissionerPlan && f.tankingMonitorOn ? (f.tankingPenaltiesOn ? 'Warning, then the penalty you chose' : 'Flags only') : null,
      detailEs: f.commissionerPlan && f.tankingMonitorOn ? (f.tankingPenaltiesOn ? 'Aviso y luego la sanción que elegiste' : 'Solo alertas') : null,
      href: integrityHref,
      plan: 'commissioner',
    },
    {
      key: 'trade_review_auto_approve',
      group: 'fairness',
      label: 'Approve unflagged trades after 48 hours with no review',
      state: tradeReviewAutoApproveOn(f.settings) ? 'on' : 'off',
      detail: tradeReviewAutoApproveOn(f.settings) ? 'You are told at 24 hours; flagged trades always wait for you' : null,
      detailEs: tradeReviewAutoApproveOn(f.settings) ? 'Te avisamos a las 24 horas; los intercambios marcados siempre te esperan' : null,
      href: settingsHref,
      plan: 'free',
    },
    {
      key: 'hold_flagged_trades',
      group: 'fairness',
      label: 'Hold suspicious trades for review',
      state: paid(f.holdFlaggedTradesMode !== 'off'),
      detail: f.commissionerPlan && f.holdFlaggedTradesMode !== 'off' ? (f.holdFlaggedTradesMode === 'all' ? 'Every flagged trade' : 'Serious flags only') : null,
      detailEs: f.commissionerPlan && f.holdFlaggedTradesMode !== 'off' ? (f.holdFlaggedTradesMode === 'all' ? 'Todo cambio marcado' : 'Solo alertas graves') : null,
      href: integrityHref,
      plan: 'commissioner',
    },
  )
  if (f.dynasty) {
    const taxiOn = readTaxiRulesEnforced(f.settings)
    rows.push({
      key: 'taxi_rules',
      group: 'fairness',
      label: 'Taxi squad rules enforced',
      state: paid(taxiOn),
      detail: f.commissionerPlan && taxiOn ? 'On every save, with deadline warnings' : null,
      detailEs: f.commissionerPlan && taxiOn ? 'En cada guardado, con avisos de plazo' : null,
      href: settingsHref,
      plan: 'commissioner',
    })
  }
  return rows
}
