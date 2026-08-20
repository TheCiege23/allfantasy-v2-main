'use client'

import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Clock,
  Cpu,
  LayoutGrid,
  Link2,
  Lock,
  MonitorPlay,
  Pencil,
  RefreshCw,
  Search,
  Shield,
  Swords,
  UserCog,
  Wallet,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAfSubGate } from '@/hooks/useAfSubGate'
import { LEAGUE_SETTINGS_AI_PANEL_FEATURE } from '@/lib/monetization/entitlements'
import { QRCodeSVG } from 'qrcode.react'
import type { League, LeagueInvite, LeagueTeam } from '@prisma/client'
import type { UserLeague } from '@/app/dashboard/types'
import { DiscordLeagueSyncPanel } from './DiscordLeagueSyncPanel'
import { PlayoffSettingsEditor as PlayoffSettingsEditorLazy } from '@/components/league-settings/PlayoffSettingsEditor'
import { RosterSettingsEditor as RosterSettingsEditorLazy } from '@/components/league-settings/RosterSettingsEditor'
import {
  detectScoringFlavor,
  getDivisionCount,
  getDraftIdFromSettings,
  getScoringSettings,
  getSleeperLikeBundle,
  getSettingsRecord,
  groupRosterSlotCounts,
  initialsFromName,
  leagueAvatarSrc,
  sleeperAvatarUrl,
  waiverTypeLabel,
} from './league-settings-modal-utils'
import { IDPRosterPanel } from '@/app/idp/components/settings/IDPRosterPanel'
import { IDPScoringPanel } from '@/app/idp/components/settings/IDPScoringPanel'
import { IDPDisplayPanel } from '@/app/idp/components/settings/IDPDisplayPanel'
import { IDPAIPanel } from '@/app/idp/components/settings/IDPAIPanel'
import { DeleteLeagueFromAfPanel } from './DeleteLeagueFromAfPanel'
import { NflScoringSettingsPanel } from '@/components/league-settings/NflScoringSettingsPanel'
import { NbaScoringSettingsPanel } from '@/components/league-settings/NbaScoringSettingsPanel'
import { NcaabScoringSettingsPanel } from '@/components/league-settings/NcaabScoringSettingsPanel'
import { MlbScoringSettingsPanel } from '@/components/league-settings/MlbScoringSettingsPanel'
import { NhlScoringSettingsPanel } from '@/components/league-settings/NhlScoringSettingsPanel'
import { NcaafScoringSettingsPanel } from '@/components/league-settings/NcaafScoringSettingsPanel'
import { SoccerScoringSettingsPanel } from '@/components/league-settings/SoccerScoringSettingsPanel'
import { DraftSettingsCommissionerPanel } from '@/components/league-settings/DraftSettingsCommissionerPanel'
import { DivisionSettingsCommissionerPanel } from '@/components/league-settings/DivisionSettingsCommissionerPanel'
import { MemberSettingsCommissionerPanel } from '@/components/league-settings/MemberSettingsCommissionerPanel'

/** Matches `LeagueShellLeague` without importing `LeagueShell` (avoid circular imports). */
export type LeagueSettingsModalLeague = League & {
  teams: LeagueTeam[]
  invites: LeagueInvite[]
}

export type SleeperMemberMap = Record<string, { display_name: string; avatar: string | null }>

export type SubPanelContext = {
  league: LeagueSettingsModalLeague
  displayLeague: UserLeague
  userId: string
  userTeam: LeagueTeam | null
  sleeperLeagueId: string | null
  platformLeagueId: string
  isCommissioner: boolean
  isHeadCommissioner: boolean
  sleeperMemberMap: SleeperMemberMap
  onGoToDraftTab: () => void
  /** From `/api/league/settings` when available - powers IDP Intelligence panel gating. */
  hasAfCommissionerSub?: boolean
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-white/[0.06] py-2.5 last:border-0">
      <span className="text-[12px] text-white/45">{label}</span>
      <span className="max-w-[60%] text-right text-[12px] font-medium text-white/90">{value}</span>
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-white/35">{children}</p>
}

function SleeperLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 inline-flex text-[13px] font-semibold text-[#ff3d81]/95 underline-offset-2 hover:text-[#ff9ec0]"
    >
      {children}
    </a>
  )
}

function CommishLinkRow({ href, label }: { href: string; label: string }) {
  const testId = `commish-menu-${label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-2 border-b border-white/[0.06] py-3.5 first:pt-0 last:border-0"
      data-testid={testId}
    >
      <span className="text-[14px] font-medium text-white/95">{label}</span>
      <ChevronRight className="h-5 w-5 shrink-0 text-white/40" aria-hidden />
    </a>
  )
}

const SLOT_DOT: Record<string, string> = {
  QB: 'bg-rose-500',
  RB: 'bg-teal-500',
  WR: 'bg-sky-500',
  TE: 'bg-amber-500',
  FLEX: 'bg-slate-500',
  REC_FLEX: 'bg-slate-500',
  WRRB_FLEX: 'bg-slate-600',
  WRT_FLEX: 'bg-slate-600',
  SUPER_FLEX: 'bg-slate-700',
  K: 'bg-violet-500',
  DEF: 'bg-amber-800',
  DL: 'bg-orange-500',
  LB: 'bg-violet-400',
  DB: 'bg-pink-400',
  IDP_FLEX: 'bg-slate-600',
  BN: 'bg-cyan-600',
}

function slotDotClass(slot: string): string {
  return SLOT_DOT[slot] ?? 'bg-white/30'
}

function formatSlotLabel(slot: string): string {
  const names: Record<string, string> = {
    QB: 'Quarterback (QB)',
    RB: 'Running Back (RB)',
    WR: 'Wide Receiver (WR)',
    TE: 'Tight End (TE)',
    FLEX: 'Flex (W/R/T)',
    REC_FLEX: 'Flex (REC)',
    WRRB_FLEX: 'Flex (W/R)',
    WRT_FLEX: 'Flex (W/T)',
    SUPER_FLEX: 'Super Flex (Q/W/R/T)',
    K: 'Kicker (K)',
    DEF: 'Defense (DEF)',
    DL: 'Defensive Linemen (DL)',
    LB: 'Linebacker (LB)',
    DB: 'Defensive Back (DB)',
    IDP_FLEX: 'IDP Flex',
    BN: 'Bench (BN)',
  }
  return names[slot] ?? `${slot.replace(/_/g, ' ')} (${slot})`
}

const IDP_SLOTS = new Set(['DL', 'LB', 'DB', 'IDP_FLEX'])

function DivisionSettingsPanel({ ctx }: { ctx: SubPanelContext }) {
  const count = useMemo(() => getDivisionCount(ctx.league.settings), [ctx.league.settings])
  const sleeperSettingsHref = ctx.sleeperLeagueId
    ? `https://sleeper.com/leagues/${ctx.sleeperLeagueId}/settings`
    : null
  const label = count != null ? `${count} Division${count === 1 ? '' : 's'}` : '—'

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-sky-200/50">Number of divisions</p>
      {sleeperSettingsHref ? (
        <a
          href={sleeperSettingsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-3 text-left transition hover:border-[#ff3d81]/25"
          data-testid="division-settings-count-row"
        >
          <span className="text-[15px] font-semibold text-white">{label}</span>
          <span className="text-[13px] font-semibold text-[#ff3d81]">Edit</span>
        </a>
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-[#0a1228]/80 px-3 py-3 text-[14px] text-white/85">{label}</div>
      )}
      <p className="text-[12px] leading-relaxed text-white/45">
        Division structure is edited in your host app. AllFantasy shows a read-only snapshot from sync.
      </p>
    </div>
  )
}

function RosterSettingsReadonlyPanel({ ctx }: { ctx: SubPanelContext }) {
  const bundle = useMemo(() => getSleeperLikeBundle(ctx.league.settings), [ctx.league.settings])
  const settings = useMemo(() => getSettingsRecord(ctx.league.settings), [ctx.league.settings])
  const rosterPositions = (bundle.roster_positions as string[] | undefined) ?? []
  const groups = useMemo(() => groupRosterSlotCounts(rosterPositions), [rosterPositions])
  const [tab, setTab] = useState<'spots' | 'limits'>('spots')
  const reserveSlots = bundle.reserve_slots ?? settings.reserve_slots
  const taxiSlots = bundle.taxi_slots ?? settings.taxi_slots
  const sleeperSettingsHref = ctx.sleeperLeagueId
    ? `https://sleeper.com/leagues/${ctx.sleeperLeagueId}/settings`
    : null

  const { main, idp } = useMemo(() => {
    const main = groups.filter((g) => !IDP_SLOTS.has(g.slot))
    const idp = groups.filter((g) => IDP_SLOTS.has(g.slot))
    return { main, idp }
  }, [groups])

  const totalSlots = rosterPositions.length

  return (
    <div className="space-y-3">
      <div className="flex rounded-full border border-white/[0.08] bg-[#060c18] p-0.5">
        <button
          type="button"
          onClick={() => setTab('spots')}
          className={`flex-1 rounded-full px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${
            tab === 'spots' ? 'bg-[#ff3d81]/25 text-[#ffd7e5] shadow-[inset_0_0_0_1px_rgba(255,61,129,0.25)]' : 'text-white/45'
          }`}
          data-testid="roster-tab-spots"
        >
          Roster spots
        </button>
        <button
          type="button"
          onClick={() => setTab('limits')}
          className={`flex-1 rounded-full px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${
            tab === 'limits' ? 'bg-[#ff3d81]/25 text-[#ffd7e5] shadow-[inset_0_0_0_1px_rgba(255,61,129,0.25)]' : 'text-white/45'
          }`}
          data-testid="roster-tab-limits"
        >
          Position limits
        </button>
      </div>

      {tab === 'spots' ? (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wide text-white/45">
            Roster spots{totalSlots > 0 ? `: ${totalSlots}` : ''}
          </p>
          {groups.length === 0 ? (
            <p className="text-[12px] text-white/45">No roster_positions in synced settings.</p>
          ) : (
            <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#0a1228]/80">
              {main.map(({ slot, count }) => (
                <div key={slot} className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${slotDotClass(slot)}`} aria-hidden />
                    <span className="truncate text-[13px] font-medium text-white/90">{formatSlotLabel(slot)}</span>
                  </div>
                  <span
                    className="shrink-0 rounded-lg border border-white/[0.12] bg-white/[0.06] px-3 py-1 text-[13px] font-semibold tabular-nums text-white/90"
                    aria-label={`${formatSlotLabel(slot)}: ${count}`}
                  >
                    {count}
                  </span>
                </div>
              ))}
              {idp.length > 0 ? (
                <>
                  <p className="bg-[#060c18] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-sky-200/55">
                    IDP roster spots
                  </p>
                  {idp.map(({ slot, count }) => (
                    <div key={slot} className="flex items-center justify-between gap-2 px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${slotDotClass(slot)}`} aria-hidden />
                        <span className="truncate text-[13px] font-medium text-white/90">{formatSlotLabel(slot)}</span>
                      </div>
                      <span
                        className="shrink-0 rounded-lg border border-white/[0.12] bg-white/[0.06] px-3 py-1 text-[13px] font-semibold tabular-nums text-white/90"
                        aria-label={`${formatSlotLabel(slot)}: ${count}`}
                      >
                        {count}
                      </span>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wide text-white/45">Position limits</p>
          {groups.length === 0 ? (
            <p className="text-[12px] text-white/45">No positions to show.</p>
          ) : (
            <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#0a1228]/80">
              {groups.map(({ slot }) => (
                <div key={`lim-${slot}`} className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${slotDotClass(slot)}`} aria-hidden />
                    <span className="truncate text-[13px] font-medium text-white/90">{formatSlotLabel(slot)}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-white/38">No limit</span>
                    {sleeperSettingsHref ? (
                      <a
                        href={sleeperSettingsHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.06] text-[#ff9ec0]/90 hover:border-[#ff3d81]/30"
                        title="Edit position limits in Sleeper"
                        aria-label={`Edit position limits for ${formatSlotLabel(slot)} in Sleeper`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.06] text-white/35">
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-white/38">Per-position caps are managed in your host commissioner tools.</p>
        </>
      )}

      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#0a1228]/60">
        <Row label="IR slots" value={reserveSlots != null ? String(reserveSlots) : '—'} />
        <Row label="Taxi slots" value={taxiSlots != null ? String(taxiSlots) : '—'} />
      </div>
      {sleeperSettingsHref ? (
        <SleeperLink href={sleeperSettingsHref}>Open roster settings in Sleeper →</SleeperLink>
      ) : null}
    </div>
  )
}

function playoffRoundTypeLabel(v: unknown): string {
  if (v === 0 || v === '0') return 'One week per round'
  if (v === 1 || v === '1') return 'Two week championship'
  if (v === 2 || v === '2') return 'Two weeks per round'
  return v != null && String(v).trim() ? String(v) : '—'
}

function playoffSeedTypeLabel(v: unknown): string {
  if (v === 0 || v === '0') return 'Default bracket side'
  if (v === 1 || v === '1') return 'Re-seed each round'
  return v != null && String(v).trim() ? String(v) : '—'
}

function lowerBracketLabel(toilet: unknown, s: Record<string, unknown>): string {
  const t = toilet ?? s.toilet_bowl
  if (t === true || t === 1 || t === '1') return 'Toilet bowl'
  if (t === false || t === 0 || t === '0') return 'Consolation style'
  return '—'
}

function yn(v: unknown): string {
  if (v === true || v === 1 || v === '1') return 'On'
  if (v === false || v === 0 || v === '0') return 'Off'
  return '—'
}

function PlayoffSettingsReadonlyPanel({ ctx }: { ctx: SubPanelContext }) {
  const bundle = useMemo(() => getSleeperLikeBundle(ctx.league.settings), [ctx.league.settings])
  const settings = useMemo(() => getSettingsRecord(ctx.league.settings), [ctx.league.settings])
  const sleeperSettingsHref = ctx.sleeperLeagueId
    ? `https://sleeper.com/leagues/${ctx.sleeperLeagueId}/settings`
    : null

  const playoffTeams = bundle.playoff_teams ?? settings.playoff_teams
  const playoffStart = bundle.playoff_week_start ?? settings.playoff_week_start
  const roundType = bundle.playoff_round_type ?? settings.playoff_round_type
  const seedType = bundle.playoff_seed_type ?? settings.playoff_seed_type
  const toilet = bundle.toilet_bowl ?? settings.toilet_bowl
  const consolation = settings.consolation_bracket_enabled ?? bundle.consolation_bracket_enabled

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-white/50">
        Playoff settings usually lock after the regular season ends. Below is a read-only snapshot from synced host
        settings — open Sleeper to change brackets or seeding.
      </p>
      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#0a1228]/80">
        <Row label="Playoffs start week" value={playoffStart != null ? `Week ${playoffStart}` : '—'} />
        <Row label="Playoff teams" value={playoffTeams != null ? String(playoffTeams) : '—'} />
        <Row label="Playoff rounds" value={playoffRoundTypeLabel(roundType)} />
        <Row label="Seeding rules" value={playoffSeedTypeLabel(seedType)} />
        <Row label="Lower bracket" value={lowerBracketLabel(toilet, settings)} />
        <Row label="Consolation bracket" value={yn(consolation)} />
      </div>
      {sleeperSettingsHref ? (
        <SleeperLink href={sleeperSettingsHref}>Edit playoff settings in Sleeper →</SleeperLink>
      ) : null}
    </div>
  )
}

type SeasonDraftRow = {
  season: string
  leagueId: string
  draftId: string | null
  draft: Record<string, unknown> | null
}

function draftStatusBadge(status: string): { label: string; className: string } {
  const s = status.toLowerCase()
  if (s === 'complete' || s === 'completed')
    return { label: 'COMPLETE', className: 'border border-white/15 bg-zinc-900 text-white' }
  if (s === 'drafting' || s === 'in_progress')
    return { label: 'LIVE', className: 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-100' }
  if (s === 'pre_draft' || s === 'scheduled' || s === 'not_started')
    return { label: 'PRE-DRAFT', className: 'border border-sky-500/25 bg-sky-500/15 text-sky-100' }
  if (s === 'missing' || s === 'no draft')
    return { label: 'NO DATA', className: 'border border-white/10 bg-white/[0.06] text-white/45' }
  return {
    label: s.replace(/_/g, ' ').toUpperCase() || '—',
    className: 'border border-white/10 bg-white/[0.08] text-white/80',
  }
}

function draftTypeDisplay(type: unknown): string {
  const t = String(type ?? '').toLowerCase()
  if (t === 'snake') return 'Snake Draft'
  if (t === 'linear') return 'Linear Draft'
  if (t === 'auction') return 'Auction Draft'
  return t ? t.replace(/_/g, ' ') : '—'
}

function formatPickTimerSeconds(sec: unknown): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '—'
  if (sec >= 3600) {
    const h = sec / 3600
    return `${h % 1 === 0 ? String(h) : h.toFixed(1)} Hours`
  }
  if (sec >= 60) return `${Math.round(sec / 60)} Mins`
  return `${sec} Secs`
}

function formatPlayerPool(settings: Record<string, unknown>, meta: Record<string, unknown>): string {
  const v = settings.player_pool ?? settings.player_type ?? meta.player_type
  if (v === 0 || v === '0' || v === 'all' || v === 'ALL') return 'All Players'
  if (v === 1 || v === '1' || v === 'rookies' || v === 'ROOKIES') return 'Rookies Only'
  if (v === 2 || v === '2' || v === 'vets' || v === 'VETS') return 'Vets Only'
  if (typeof v === 'string' && v.trim())
    return v
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  return '—'
}

function parseDraftDetail(draft: Record<string, unknown> | null) {
  if (!draft) return null
  const settings = (draft.settings as Record<string, unknown> | undefined) ?? {}
  const meta = (draft.metadata as Record<string, unknown> | undefined) ?? {}
  const rounds = settings.rounds ?? settings.num_rounds
  const pickTimer = settings.pick_timer ?? settings.pickTimer
  const cpu = settings.cpu_autopick ?? settings.autopick_enabled
  const cpuOn = cpu === true || cpu === 1 || cpu === '1'
  return {
    typeLabel: draftTypeDisplay(draft.type),
    roundsLabel: typeof rounds === 'number' && Number.isFinite(rounds) ? `${rounds} Rounds` : '—',
    poolLabel: formatPlayerPool(settings, meta),
    timerLabel: formatPickTimerSeconds(pickTimer),
    cpuLabel: cpuOn ? 'CPU Autopick' : 'CPU off',
  }
}

function DraftSeasonCard({ row }: { row: SeasonDraftRow }) {
  const d = row.draft
  const statusRaw = d ? String(d.status ?? 'pre_draft') : row.draftId ? 'missing' : 'no draft'
  const badge = draftStatusBadge(statusRaw)
  const detail = parseDraftDetail(d)

  if (!row.draftId) {
    return (
      <li className="rounded-xl border border-white/[0.06] bg-[#0a1228]/80 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[17px] font-bold text-white">{row.season}</span>
          <span className="rounded-md border border-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/45">
            No draft
          </span>
        </div>
      </li>
    )
  }

  if (!d) {
    return (
      <li className="rounded-xl border border-white/[0.06] bg-[#0a1228]/80 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[17px] font-bold text-white">{row.season}</span>
          <span
            className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge.className}`}
          >
            {badge.label}
          </span>
        </div>
        <p className="mt-2 text-[12px] text-white/45">Draft metadata unavailable from host.</p>
      </li>
    )
  }

  return (
    <li
      className="rounded-xl border border-white/[0.06] bg-[#0a1228]/80 px-3 py-3"
      data-testid={`draft-season-card-${row.season}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[17px] font-bold text-white">{row.season}</span>
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge.className}`}>
          {badge.label}
        </span>
      </div>
      {detail ? (
        <div className="mt-3 grid grid-cols-2 gap-x-2 gap-y-3 text-[11px]">
          <div className="flex items-start gap-2">
            <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" aria-hidden />
            <div>
              <p className="font-semibold text-orange-200/95">{detail.typeLabel}</p>
              <p className="text-[10px] text-white/38">Type</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <LayoutGrid className="mt-0.5 h-4 w-4 shrink-0 text-pink-400" aria-hidden />
            <div>
              <p className="font-semibold text-pink-200/95">{detail.roundsLabel}</p>
              <p className="text-[10px] text-white/38">Rounds</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
            <div>
              <p className="font-semibold text-emerald-200/95">{detail.poolLabel}</p>
              <p className="text-[10px] text-white/38">Player pool</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" aria-hidden />
            <div>
              <p className="font-semibold text-violet-200/95">{detail.timerLabel}</p>
              <p className="text-[10px] text-white/38">Time / pick</p>
            </div>
          </div>
          <div className="col-span-2 flex items-start gap-2">
            <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" aria-hidden />
            <div>
              <p className="font-semibold text-sky-200/95">{detail.cpuLabel}</p>
              <p className="text-[10px] text-white/38">Autopick</p>
            </div>
          </div>
        </div>
      ) : null}
    </li>
  )
}

function DraftResultsPanel({ ctx, isCommish }: { ctx: SubPanelContext; isCommish: boolean }) {
  const afLeagueId = ctx.league.id
  const currentDraftId = getDraftIdFromSettings(ctx.league.settings)
  const [seasonDrafts, setSeasonDrafts] = useState<SeasonDraftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [picks, setPicks] = useState<unknown[] | null>(null)
  const [picksLoading, setPicksLoading] = useState(false)

  useEffect(() => {
    if (!afLeagueId) {
      setLoading(false)
      setSeasonDrafts([])
      setErr(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setErr(null)
    void (async () => {
      try {
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(afLeagueId)}/sleeper-hosted-draft-history`,
          { credentials: 'include' },
        )
        const json = (await res.json().catch(() => ({}))) as { rows?: SeasonDraftRow[]; error?: string }
        if (cancelled) return
        if (!res.ok) {
          setErr(json.error ?? 'Could not load draft history.')
          setSeasonDrafts([])
          return
        }
        setSeasonDrafts(Array.isArray(json.rows) ? json.rows : [])
      } catch {
        if (!cancelled) {
          setErr('Could not load draft history.')
          setSeasonDrafts([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [afLeagueId])

  useEffect(() => {
    if (!currentDraftId || !afLeagueId) {
      setPicks(null)
      return
    }
    let cancelled = false
    setPicksLoading(true)
    void fetch(
      `/api/leagues/${encodeURIComponent(afLeagueId)}/sleeper-hosted-draft/${encodeURIComponent(currentDraftId)}/picks`,
      { credentials: 'include' },
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('picks'))))
      .then((data: unknown) => {
        const body = data && typeof data === 'object' ? (data as { picks?: unknown }).picks : undefined
        if (!cancelled) setPicks(Array.isArray(body) ? body : [])
      })
      .catch(() => {
        if (!cancelled) setPicks([])
      })
      .finally(() => {
        if (!cancelled) setPicksLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentDraftId, afLeagueId])

  if (!afLeagueId) {
    return <p className="text-[13px] text-white/45">League unavailable — draft history unavailable.</p>
  }
  if (loading) return <p className="text-[13px] text-white/45">Loading drafts…</p>
  if (err) return <p className="text-[13px] text-rose-300">{err}</p>

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-white/40">
        Per-season drafts from the Sleeper league chain (current season first).{' '}
        {isCommish ? 'Edits stay on the host.' : ''}
      </p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-white/38">Drafts</p>
      {seasonDrafts.length === 0 ? (
        <p className="text-[13px] text-white/45">No seasons found for this league chain.</p>
      ) : (
        <ul className="space-y-3">
          {seasonDrafts.map((row) => (
            <DraftSeasonCard key={`${row.season}-${row.leagueId}`} row={row} />
          ))}
        </ul>
      )}
      <div className="space-y-2 border-t border-white/[0.06] pt-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-white/38">Picks (synced draft id)</p>
        {!currentDraftId ? (
          <p className="text-[12px] text-white/45">No draft_id on synced league settings.</p>
        ) : picksLoading ? (
          <p className="text-[12px] text-white/45">Loading picks…</p>
        ) : (
          <>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-[#0d1117] p-2">
              {(picks ?? []).slice(0, 50).map((p, i) => {
                const row = p as Record<string, unknown>
                const pid = String(row.player_id ?? row.pick_no ?? i)
                return (
                  <div key={`${pid}-${i}`} className="flex justify-between gap-2 text-[11px] text-white/80">
                    <span className="text-white/45">#{i + 1}</span>
                    <span className="truncate">{pid}</span>
                  </div>
                )
              })}
            </div>
            <button
              type="button"
              className="w-full rounded-xl border border-white/12 py-2 text-[12px] font-semibold text-white/80 hover:bg-white/[0.04]"
              data-testid="draft-results-export-csv"
              onClick={() => {
                const csv = 'pick,player_id\n' + (picks ?? []).map((p, i) => `${i + 1},${(p as { player_id?: string }).player_id ?? ''}`).join('\n')
                void navigator.clipboard.writeText(csv)
              }}
            >
              Export picks as CSV (clipboard)
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function SettingsSubPanelBody({
  panelId,
  ctx,
}: {
  panelId: string
  ctx: SubPanelContext
}) {
  const bundle = useMemo(() => getSleeperLikeBundle(ctx.league.settings), [ctx.league.settings])
  const settings = useMemo(() => getSettingsRecord(ctx.league.settings), [ctx.league.settings])
  const scoring = useMemo(() => getScoringSettings(ctx.league.settings), [ctx.league.settings])
  const flavor = detectScoringFlavor(scoring)
  const waiverRaw = bundle.waiver_type ?? settings.waiver_type
  const numTeams = typeof bundle.total_rosters === 'number' ? bundle.total_rosters : ctx.displayLeague.teamCount
  const sport = String(bundle.sport ?? ctx.displayLeague.sport ?? '—')
  const season = bundle.season != null ? String(bundle.season) : String(ctx.displayLeague.season ?? '—')
  const playoffTeams = bundle.playoff_teams ?? settings.playoff_teams
  const playoffStart = bundle.playoff_week_start ?? settings.playoff_week_start
  const tradeDl = bundle.trade_deadline ?? settings.trade_deadline
  const waiverBudget = bundle.waiver_budget ?? settings.waiver_budget
  const draftId = getDraftIdFromSettings(ctx.league.settings)

  const sleeperSettingsHref = ctx.sleeperLeagueId
    ? `https://sleeper.com/leagues/${ctx.sleeperLeagueId}/settings`
    : null
  const mockDraftHref = ctx.sleeperLeagueId ? `https://sleeper.com/mock-draft/${ctx.sleeperLeagueId}` : null
  const inviteUrl =
    ctx.platformLeagueId.length > 0
      ? `https://sleeper.com/leagues/${ctx.platformLeagueId}`
      : 'https://sleeper.com/'

  switch (panelId) {
    case 'discord-sync':
      return <DiscordLeagueSyncPanel ctx={ctx} />
    case 'my-team':
      return <MyTeamPanel ctx={ctx} />
    case 'general-info':
      return (
        <div className="space-y-1">
          <SectionTitle>League snapshot</SectionTitle>
          <Row label="League name" value={ctx.displayLeague.name} />
          <Row label="Teams" value={String(numTeams)} />
          <Row label="Sport" value={sport} />
          <Row label="Season" value={season} />
          <Row label="Scoring" value={flavor} />
          <Row label="Waiver type" value={waiverTypeLabel(waiverRaw)} />
          <Row label="FAAB budget" value={waiverBudget != null ? String(waiverBudget) : '—'} />
          <Row label="Playoff teams" value={playoffTeams != null ? String(playoffTeams) : '—'} />
          <Row label="Playoff start week" value={playoffStart != null ? String(playoffStart) : '—'} />
          <Row label="Trade deadline week" value={tradeDl != null ? String(tradeDl) : '—'} />
          {sleeperSettingsHref ? (
            <SleeperLink href={sleeperSettingsHref}>Open full settings in Sleeper →</SleeperLink>
          ) : null}
        </div>
      )
    case 'draft':
      return (
        <div className="space-y-6">
          <DraftSubPanel
            bundle={bundle}
            draftId={draftId}
            draftDateIso={ctx.displayLeague.draftDate ?? null}
            mockDraftHref={mockDraftHref}
            onGoToDraftTab={ctx.onGoToDraftTab}
          />
          {ctx.isCommissioner && (
            <DraftSettingsCommissionerPanel leagueId={ctx.league.id} />
          )}
        </div>
      )
    case 'playoffs':
      return (
        <>
          <PlayoffSettingsReadonlyPanel ctx={ctx} />
          {ctx.isCommissioner && (
            <div className="mt-6">
              <PlayoffSettingsEditorLazy leagueId={ctx.league.id} />
            </div>
          )}
        </>
      )
    case 'roster':
      return (
        <>
          <RosterSettingsReadonlyPanel ctx={ctx} />
          {(ctx.league.sport === 'NFL' || ctx.league.sport === 'NBA' || ctx.league.sport === 'NCAAB' || ctx.league.sport === 'MLB' || ctx.league.sport === 'NCAAF' || ctx.league.sport === 'NHL' || ctx.league.sport === 'SOCCER') && (
            <div className="mt-6">
              <RosterSettingsEditorLazy leagueId={ctx.league.id} />
            </div>
          )}
        </>
      )
    case 'scoring':
      return (
        <div className="space-y-6">
          <ScoringSubPanel scoring={scoring} flavor={flavor} sleeperSettingsHref={sleeperSettingsHref} />
          {ctx.league.sport === 'NFL' && (
            <NflScoringSettingsPanel
              leagueId={ctx.league.id}
              isCommissioner={ctx.isCommissioner}
            />
          )}
          {ctx.league.sport === 'NBA' && (
            <NbaScoringSettingsPanel
              leagueId={ctx.league.id}
              isCommissioner={ctx.isCommissioner}
            />
          )}
          {ctx.league.sport === 'NCAAB' && (
            <NcaabScoringSettingsPanel
              leagueId={ctx.league.id}
              isCommissioner={ctx.isCommissioner}
            />
          )}
          {ctx.league.sport === 'MLB' && (
            <MlbScoringSettingsPanel
              leagueId={ctx.league.id}
              isCommissioner={ctx.isCommissioner}
            />
          )}
          {ctx.league.sport === 'NHL' && (
            <NhlScoringSettingsPanel
              leagueId={ctx.league.id}
              isCommissioner={ctx.isCommissioner}
            />
          )}
          {ctx.league.sport === 'NCAAF' && (
            <NcaafScoringSettingsPanel
              leagueId={ctx.league.id}
              isCommissioner={ctx.isCommissioner}
            />
          )}
          {ctx.league.sport === 'SOCCER' && (
            <SoccerScoringSettingsPanel
              leagueId={ctx.league.id}
              isCommissioner={ctx.isCommissioner}
            />
          )}
        </div>
      )
    case 'notifications':
      return <NotificationsPanel />
    case 'invite':
      return (
        <InvitePanel
          inviteUrl={inviteUrl}
          // Count only slots a real manager has claimed — `teams.length` includes
          // auto-materialized placeholder slots and reported the league as "full"
          // before anyone but the commissioner had joined.
          filled={ctx.league.teams.filter((team) => Boolean(team.claimedByUserId)).length}
          total={numTeams}
        />
      )
    case 'co-owners':
      return <CoOwnersPanel ctx={ctx} />
    case 'draft-results':
    case 'draft-results-commish':
      return <DraftResultsPanel ctx={ctx} isCommish={panelId === 'draft-results-commish'} />
    case 'league-history':
    case 'league-history-commish':
      return (
        <LeagueHistoryPanel
          platformLeagueId={ctx.platformLeagueId}
          isCommish={panelId === 'league-history-commish'}
          isHeadCommissioner={ctx.isHeadCommissioner}
        />
      )
    case 'commish-general':
      return <CommishGeneralPanel leagueName={ctx.displayLeague.name} sleeperSettingsHref={sleeperSettingsHref} />
    case 'division-settings':
      return (
        <div className="space-y-6">
          <DivisionSettingsPanel ctx={ctx} />
          <DivisionSettingsCommissionerPanel leagueId={ctx.league.id} />
        </div>
      )
    case 'members-commish':
      return (
        <MemberSettingsCommissionerPanel leagueId={ctx.league.id} />
      )
    case 'commish-note':
      return <CommishNotePanel ctx={ctx} />
    case 'commish-controls':
      return <CommishControlsPanel ctx={ctx} />
    case 'audit-log':
      return (
        <div
          data-testid="settings-audit-log-panel"
          className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 text-[13px] leading-relaxed text-white/65"
        >
          <p className="mb-2 text-[14px] font-semibold text-white/85">Audit Log</p>
          <p>
            Audit logging is ready to be wired. Commissioner actions will appear
            here once backend logging is enabled.
          </p>
        </div>
      )
    case 'league-dues':
      return <LeagueDuesTrackerPanel ctx={ctx} />
    case 'ai-chimmy-setup':
    case 'ai-power-rankings':
    case 'ai-trade':
    case 'ai-waiver':
    case 'ai-recap':
    case 'ai-draft-help':
    case 'ai-matchup':
    case 'ai-trash':
      return <AiFeaturePanel panelId={panelId} ctx={ctx} />
    case 'idp_roster':
      return <IDPRosterPanel />
    case 'idp_scoring':
      return <IDPScoringPanel />
    case 'idp_display':
      return <IDPDisplayPanel />
    case 'idp_ai':
      return (
        <IDPAIPanel
          leagueId={ctx.league.id}
          hasAfSub={ctx.hasAfCommissionerSub ?? false}
          isCommissioner={ctx.isCommissioner}
        />
      )
    default:
      return <p className="text-[13px] text-white/45">Unknown panel.</p>
  }
}

function MyTeamPanel({ ctx }: { ctx: SubPanelContext }) {
  const [teamName, setTeamName] = useState(ctx.userTeam?.teamName ?? '')
  const [uploading, setUploading] = useState(false)
  const onAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.set('file', file)
      fd.set('type', 'image')
      fd.set('leagueId', ctx.league.id)
      const res = await fetch('/api/chat/upload', { method: 'POST', body: fd })
      await res.json().catch(() => ({}))
    } finally {
      setUploading(false)
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative h-16 w-16 overflow-hidden rounded-full border border-white/15 bg-white/10">
          {ctx.userTeam?.avatarUrl ? (
            <img src={sleeperAvatarUrl(ctx.userTeam.avatarUrl) ?? ''} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-sm font-bold text-white/70">
              {initialsFromName(teamName || ctx.userTeam?.ownerName || 'TM')}
            </span>
          )}
        </div>
        <label className="cursor-pointer rounded-lg border border-[#ff3d81]/35 bg-[#ff3d81]/10 px-3 py-1.5 text-[12px] font-semibold text-[#ffb8d1] hover:bg-[#ff3d81]/20">
          {uploading ? 'Uploading…' : 'Upload avatar'}
          <input type="file" accept="image/*" className="hidden" onChange={onAvatar} />
        </label>
      </div>
      <div>
        <label className="text-[11px] font-semibold text-white/45">Team name</label>
        <input
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1f3a] px-3 py-2 text-[13px] text-white outline-none focus:border-[#ff3d81]/40"
        />
      </div>
      <p className="text-[11px] text-white/40">
        Player nicknames and persisted team settings use Supabase when `user_team_settings` is enabled.
      </p>
      <button
        type="button"
        className="w-full rounded-xl bg-[#ff3d81]/20 py-2.5 text-[13px] font-bold text-[#ffd7e5] hover:bg-[#ff3d81]/30"
      >
        Save
      </button>
    </div>
  )
}

function DraftSubPanel({
  bundle,
  draftId,
  draftDateIso,
  mockDraftHref,
  onGoToDraftTab,
}: {
  bundle: Record<string, unknown>
  draftDateIso: string | null
  mockDraftHref: string | null
  draftId: string | null
  onGoToDraftTab: () => void
}) {
  const status = String(bundle.status ?? '—')
  const start = draftDateIso ? new Date(draftDateIso).toLocaleString() : '—'
  return (
    <div className="space-y-3">
      <Row label="Draft ID" value={draftId ?? '—'} />
      <Row label="Status" value={status} />
      <Row label="Scheduled" value={start} />
      <div className="flex flex-col gap-2 pt-2">
        <button
          type="button"
          onClick={onGoToDraftTab}
          className="rounded-xl border border-white/12 bg-white/[0.06] py-2.5 text-[13px] font-semibold text-white hover:bg-white/[0.1]"
        >
          View Draft Board
        </button>
        {mockDraftHref ? (
          <a
            href={mockDraftHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-[#ff3d81]/30 bg-[#ff3d81]/10 py-2.5 text-center text-[13px] font-semibold text-[#ffd7e5]"
          >
            Mock Draft
          </a>
        ) : null}
      </div>
    </div>
  )
}

function ScoringSubPanel({
  scoring,
  flavor,
  sleeperSettingsHref,
}: {
  scoring: Record<string, number>
  flavor: string
  sleeperSettingsHref: string | null
}) {
  const keys = ['pass_td', 'pass_yd', 'pass_int', 'rush_td', 'rush_yd', 'rec_td', 'rec_yd', 'rec']
  return (
    <div className="space-y-2">
      <div className="inline-flex rounded-full border border-violet-500/35 bg-violet-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-violet-200">
        {flavor}
      </div>
      <div className="space-y-0">
        {keys.map((k) => (
          <Row key={k} label={k.replace(/_/g, ' ')} value={scoring[k] != null ? String(scoring[k]) : '—'} />
        ))}
      </div>
      {sleeperSettingsHref ? (
        <SleeperLink href={sleeperSettingsHref}>Open scoring settings in Sleeper →</SleeperLink>
      ) : null}
    </div>
  )
}

const NOTIF_KEYS = [
  'trade_offers',
  'waiver_claims',
  'injury_alerts',
  'scoring_updates',
  'draft_reminders',
  'chat_mentions',
  'chimmy_recap',
  'commish_announcements',
] as const

function NotificationsPanel() {
  const [toggles, setToggles] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NOTIF_KEYS.map((k) => [k, true])),
  )
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-white/45">Stored in Supabase `user_notification_prefs` when wired.</p>
      {NOTIF_KEYS.map((key) => (
        <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#1a1f3a] px-3 py-2">
          <span className="text-[12px] text-white/85">{key.replace(/_/g, ' ')}</span>
          <input
            type="checkbox"
            checked={toggles[key] ?? false}
            onChange={(e) => setToggles((s) => ({ ...s, [key]: e.target.checked }))}
            className="h-4 w-4 accent-[#ff3d81]"
          />
        </label>
      ))}
      <button
        type="button"
        className="w-full rounded-xl bg-[#ff3d81]/20 py-2.5 text-[13px] font-bold text-[#ffd7e5]"
        onClick={() => {}}
      >
        Save preferences
      </button>
    </div>
  )
}

function InvitePanel({ inviteUrl, filled, total }: { inviteUrl: string; filled: number; total: number }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="space-y-4">
      <Row label="Members" value={`${filled} / ${total} teams`} />
      <div className="flex justify-center rounded-xl border border-white/10 bg-white p-3">
        <QRCodeSVG value={inviteUrl} size={160} level="M" />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copy}
          className="flex-1 rounded-xl border border-white/12 bg-white/[0.06] py-2 text-[12px] font-semibold text-white"
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(inviteUrl)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2 text-center text-[12px] font-semibold text-emerald-200"
        >
          WhatsApp
        </a>
      </div>
      <p className="text-[11px] text-white/35">Invite metadata from Sleeper may include invite_code when synced.</p>
    </div>
  )
}

function CoOwnersPanel({ ctx }: { ctx: SubPanelContext }) {
  const [q, setQ] = useState('')
  const sleeperSettingsHref = ctx.sleeperLeagueId
    ? `https://sleeper.com/leagues/${ctx.sleeperLeagueId}/settings`
    : null
  const teams = ctx.league.teams
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return teams
    return teams.filter(
      (x) =>
        x.teamName.toLowerCase().includes(t) ||
        x.ownerName.toLowerCase().includes(t) ||
        (x.platformUserId && (ctx.sleeperMemberMap[x.platformUserId]?.display_name ?? '').toLowerCase().includes(t)),
    )
  }, [teams, q, ctx.sleeperMemberMap])

  return (
    <div className="space-y-3">
      <label className="relative block">
        <span className="sr-only">Search usernames</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search usernames"
          className="w-full rounded-full border border-white/[0.08] bg-white/[0.06] py-2.5 pl-9 pr-3 text-[13px] text-white placeholder:text-white/35 outline-none focus:border-[#ff3d81]/35"
          data-testid="co-owners-search"
        />
      </label>
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-sky-200/45">Co-owners</p>
        {filtered.length === 0 ? (
          <p className="rounded-xl border border-white/[0.06] bg-[#0a1228]/60 px-3 py-6 text-center text-[13px] text-white/45">
            No teams match this search.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {filtered.map((t) => {
              const su = t.platformUserId ? ctx.sleeperMemberMap[t.platformUserId] : null
              const av = su?.avatar ? sleeperAvatarUrl(su.avatar) : null
              return (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-[#0a1228]/80 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-white/10">
                      {av ? <img src={av} alt="" className="h-full w-full object-cover" /> : null}
                      {!av ? (
                        <span className="flex h-full w-full items-center justify-center text-[10px] font-bold">
                          {initialsFromName(su?.display_name ?? t.ownerName)}
                        </span>
                      ) : null}
                    </div>
                    <span className="truncate text-[12px] font-semibold text-white">{t.teamName}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-white/40">
        Co-owner invites and permissions are managed in your host app. This list is a read-only roster view for search.
      </p>
      {sleeperSettingsHref ? (
        <SleeperLink href={sleeperSettingsHref}>Manage co-owners in Sleeper →</SleeperLink>
      ) : null}
    </div>
  )
}

function LeagueHistoryPanel({
  platformLeagueId,
  isCommish,
  isHeadCommissioner,
}: {
  platformLeagueId: string
  isCommish: boolean
  isHeadCommissioner: boolean
}) {
  const [rows, setRows] = useState<{ season: string; name: string; leagueId: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setRows([])
    async function walk(id: string, depth: number) {
      if (depth > 8 || cancelled) return
      const res = await fetch(`https://api.sleeper.app/v1/league/${id}`) // db-first-exception: historical league walk tool pending DB history table
      if (!res.ok) return
      const L = (await res.json()) as Record<string, unknown>
      if (cancelled) return
      const season = String(L.season ?? '')
      const name = String(L.name ?? 'League')
      setRows((r) => [...r, { season, name, leagueId: id }])
      const prev = L.previous_league_id
      if (typeof prev === 'string' && prev && prev !== id) await walk(prev, depth + 1)
    }
    setLoading(true)
    void walk(platformLeagueId, 0).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [platformLeagueId])

  if (loading) return <p className="text-[13px] text-white/45">Loading history chain…</p>

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-sky-200/45">Previous leagues</p>
      <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.06] bg-[#0a1228]/80">
        {rows.map((r, i) => (
          <li key={`${r.season}-${r.leagueId}-${i}`}>
            <a
              href={`https://sleeper.com/leagues/${r.leagueId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col gap-0.5 px-3 py-3 transition hover:bg-white/[0.04]"
              data-testid={`league-history-season-${r.season}`}
            >
              <span className="text-[16px] font-bold text-white">{r.season}</span>
              <span className="text-[12px] text-white/45">{r.name}</span>
              <span className="text-[11px] font-medium text-[#ff3d81]/90">Open in Sleeper →</span>
            </a>
          </li>
        ))}
      </ul>
      {isCommish && isHeadCommissioner ? (
        <p className="text-[11px] text-white/38">
          Add trophies, high scores, and season edits in your host app when available.
        </p>
      ) : null}
    </div>
  )
}

function CommishGeneralPanel({
  leagueName,
  sleeperSettingsHref,
}: {
  leagueName: string
  sleeperSettingsHref: string | null
}) {
  const [name, setName] = useState(leagueName)
  return (
    <div className="space-y-3">
      <div>
        <label className="text-[11px] text-white/45">League name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1f3a] px-3 py-2 text-[13px] text-white"
        />
        <p className="mt-1 text-[10px] text-white/35">Updates AllFantasy + mirror changes in Sleeper.</p>
      </div>
      <label className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-[#1a1f3a] px-3 py-2">
        <span className="text-[12px] text-white/85">Public league</span>
        <input type="checkbox" className="h-4 w-4 accent-[#ff3d81]" />
      </label>
      {sleeperSettingsHref ? (
        <SleeperLink href={sleeperSettingsHref}>Open in Sleeper Commissioner Tools →</SleeperLink>
      ) : null}
    </div>
  )
}

function MembersCommishPanel({ ctx }: { ctx: SubPanelContext }) {
  const sleeperSettingsHref = ctx.sleeperLeagueId
    ? `https://sleeper.com/leagues/${ctx.sleeperLeagueId}/settings`
    : null

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-white/55">
        Assign members to different rosters. Unassigned members remain in the league. Member moves happen in your host
        commissioner tools.
      </p>
      {sleeperSettingsHref ? (
        <div className="-mx-0.5 rounded-xl border border-white/[0.06] bg-[#0a1228]/50 px-0.5">
          <CommishLinkRow href={sleeperSettingsHref} label="Assign members to rosters" />
          <CommishLinkRow href={sleeperSettingsHref} label="Remove members from league" />
        </div>
      ) : (
        <p className="text-[12px] text-white/45">Connect a Sleeper league to open member management on the host.</p>
      )}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-white/38">Rosters</p>
        <ul className="space-y-2">
          {ctx.league.teams.map((t, i) => (
            <li
              key={t.id}
              className="rounded-xl border border-white/[0.06] bg-[#0a1228]/80 px-3 py-2.5"
              data-testid={`member-roster-preview-${i}`}
            >
              <p className="text-[13px] font-semibold text-white">
                <span className="text-white/45">{i + 1}. </span>
                {t.teamName}
              </p>
              <p className="text-[11px] text-white/40">{t.ownerName}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function CommishNotePanel({ ctx }: { ctx: SubPanelContext }) {
  const [body, setBody] = useState('')
  const [week, setWeek] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ title?: string; body?: string } | null>(null)

  const run = async () => {
    if (!ctx.isCommissioner) return
    setLoading(true)
    setError(null)
    try {
      const w = week.trim() ? parseInt(week, 10) : undefined
      const res = await fetch('/api/ai/commish-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId: ctx.league.id,
          week: Number.isFinite(w) ? w : undefined,
          context: body,
        }),
      })
      const data = (await res.json()) as { title?: string; body?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Generate failed')
      setResult({ title: data.title, body: data.body })
      if (data.body) setBody(data.body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  if (!ctx.isCommissioner) {
    return <p className="text-[13px] text-white/45">Only the commissioner can generate league notes.</p>
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-[11px] text-white/45">Week focus (optional)</label>
        <input
          type="number"
          min={1}
          max={24}
          value={week}
          onChange={(e) => setWeek(e.target.value)}
          placeholder="e.g. 12"
          className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1f3a] px-3 py-2 text-[13px] text-white placeholder:text-white/25"
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={6}
        placeholder="Extra context for Chimmy (optional)…"
        className="w-full rounded-xl border border-white/10 bg-[#1a1f3a] px-3 py-2 text-[13px] text-white placeholder:text-white/25"
        data-testid="commish-note-context"
      />
      <button
        type="button"
        disabled={loading}
        onClick={() => void run()}
        className="w-full rounded-xl bg-gradient-to-r from-violet-600/40 to-fuchsia-600/40 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
        data-testid="commish-note-generate"
      >
        {loading ? 'Generating…' : '✨ Generate with Chimmy'}
      </button>
      {error ? <p className="text-[12px] text-rose-300">{error}</p> : null}
      {result?.title ? (
        <p className="text-[12px] font-semibold text-[#ffb8d1]">{result.title}</p>
      ) : null}
      <button type="button" className="w-full rounded-xl bg-[#ff3d81]/20 py-2.5 text-[13px] font-bold text-[#ffd7e5]">
        Post / Update
      </button>
    </div>
  )
}

/** Tools where we show a Sleeper-style team owner list before sending the user to the host. */
const COMMISH_TEAM_LIST_TOOL_IDS = new Set([
  'lock-roster',
  'edit-lineups',
  'edit-waiver',
  'edit-scores',
  'roster-draft-picks',
])

const COMMISH_TOOL_EXTRA_HINT: Partial<Record<string, string>> = {
  'edit-scores':
    'Host apps only allow score changes for completed weeks. If the season has not started, you may see an empty state there.',
  'edit-lineups': 'Choose a team below, then complete lineup edits in your host commissioner tools.',
  'edit-waiver': 'Use the host to edit FAAB and waiver priority per team after you jump in.',
  'lock-roster': 'Per-team lock toggles are applied in the host app.',
  'roster-draft-picks': 'Roster and pick overrides are completed in the host app.',
}

function CommishTeamPickerList({
  ctx,
  hostSettingsHref,
}: {
  ctx: SubPanelContext
  hostSettingsHref: string | null
}) {
  const teams = useMemo(
    () => [...ctx.league.teams].sort((a, b) => a.teamName.localeCompare(b.teamName)),
    [ctx.league.teams],
  )

  if (teams.length === 0) {
    return <p className="text-[13px] text-white/45">No teams synced for this league yet.</p>
  }

  return (
    <ul
      className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.06] bg-[#0a1228]/80"
      data-testid="commish-team-picker-list"
    >
      {teams.map((t, i) => {
        const su = t.platformUserId ? ctx.sleeperMemberMap[t.platformUserId] : null
        const av = su?.avatar ? sleeperAvatarUrl(su.avatar) : null
        const primary = su?.display_name?.trim() || t.ownerName || 'Owner'
        const rowInner = (
          <>
            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/[0.08] bg-white/10">
              {av ? <img src={av} alt="" className="h-full w-full object-cover" /> : null}
              {!av ? (
                <span className="flex h-full w-full items-center justify-center text-[11px] font-bold text-white/75">
                  {initialsFromName(primary)}
                </span>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-white">{primary}</p>
              <p className="truncate text-[12px] text-white/40">{t.teamName}</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-white/30" aria-hidden />
          </>
        )
        if (hostSettingsHref) {
          return (
            <li key={t.id}>
              <a
                href={hostSettingsHref}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`commish-team-row-${i}`}
                className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-white/[0.04]"
              >
                {rowInner}
              </a>
            </li>
          )
        }
        return (
          <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 opacity-50">
            {rowInner}
          </li>
        )
      })}
    </ul>
  )
}

function CommishControlsPanel({ ctx }: { ctx: SubPanelContext }) {
  const href = ctx.sleeperLeagueId ? `https://sleeper.com/leagues/${ctx.sleeperLeagueId}/settings` : null
  const [activeTool, setActiveTool] = useState<string | null>(null)

  useEffect(() => {
    if (!activeTool) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveTool(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTool])

  const tiles: {
    id: string
    title: string
    description: string
    icon: typeof Zap
  }[] = [
    {
      id: 'playoff-bracket',
      title: 'Edit Playoff Bracket',
      description: 'Adjust seeds, rounds, and placement games in the host bracket editor.',
      icon: Zap,
    },
    {
      id: 'update-commish',
      title: 'Update Commissioner',
      description: 'Transfer or add head commissioners and co-commissioners.',
      icon: UserCog,
    },
    {
      id: 'roster-draft-picks',
      title: 'Roster & draft picks',
      description: 'Force add, drop, trade picks, or fix roster issues.',
      icon: MonitorPlay,
    },
    {
      id: 'lock-roster',
      title: 'Lock roster',
      description: 'Prevent a team from making roster moves until unlocked.',
      icon: Lock,
    },
    {
      id: 'edit-scores',
      title: 'Edit matchup scores',
      description: 'Adjust past-week scores and recalc standings on the host.',
      icon: Swords,
    },
    {
      id: 'edit-waiver',
      title: 'Edit waiver',
      description: 'Override FAAB budget and waiver priority per team.',
      icon: Wallet,
    },
    {
      id: 'edit-lineups',
      title: 'Edit lineups',
      description: 'Set weekly lineups for any team (past weeks on host).',
      icon: Swords,
    },
    {
      id: 'schedule-matchups',
      title: 'Schedule matchups',
      description: 'Change weekly pairings when the host allows it.',
      icon: CalendarDays,
    },
  ]

  const selected = activeTool ? tiles.find((x) => x.id === activeTool) : null
  const showTeamList = activeTool != null && COMMISH_TEAM_LIST_TOOL_IDS.has(activeTool)
  const extraHint = activeTool ? COMMISH_TOOL_EXTRA_HINT[activeTool] : undefined

  const currentWeek = ctx.displayLeague.currentWeek
  /** Hosts typically allow editing past-week scores only after at least one week is in the books. */
  const scoresNotReadyYet =
    activeTool === 'edit-scores' && (currentWeek == null || currentWeek < 2)
  const lineupsEarlyNote =
    activeTool === 'edit-lineups' && (currentWeek == null || currentWeek < 1)

  if (selected) {
    const Icon = selected.icon
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setActiveTool(null)}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#ff3d81]/95 hover:text-[#ff9ec0]"
          data-testid="commish-tool-back"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back
        </button>
        <span className="sr-only">Press Escape to return to the commissioner tools grid.</span>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-[#ff9ec0]/95">
            <Icon className="h-5 w-5" strokeWidth={2} aria-hidden />
          </div>
          <div>
            <h3 className="text-[16px] font-bold text-white">{selected.title}</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-white/45">{selected.description}</p>
          </div>
        </div>
        {scoresNotReadyYet ? (
          <p
            className="rounded-lg border border-amber-500/25 bg-amber-950/25 px-3 py-2 text-[12px] leading-relaxed text-amber-100/95"
            data-testid="commish-edit-scores-prewrite"
          >
            Only past weeks can be updated on the host. If the season has not started or week 1 is still in progress,
            you may need to check back after week 1.
          </p>
        ) : null}
        {lineupsEarlyNote ? (
          <p className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] leading-relaxed text-white/55">
            Weekly lineup edits for past slates follow the host’s schedule — some tools unlock after the season
            begins.
          </p>
        ) : null}
        {extraHint && !scoresNotReadyYet ? (
          <p className="rounded-lg border border-[#ff3d81]/15 bg-[#ff3d81]/[0.07] px-3 py-2 text-[11px] leading-relaxed text-[#ffd7e5]/85">
            {extraHint}
          </p>
        ) : null}
        {showTeamList ? (
          <>
            <p className="text-[10px] font-bold uppercase tracking-wide text-white/38">Teams</p>
            <CommishTeamPickerList ctx={ctx} hostSettingsHref={href} />
          </>
        ) : (
          <p className="text-[13px] leading-relaxed text-white/50">
            This flow is completed in your host commissioner experience (bracket, co-commissioners, schedule, etc.).
          </p>
        )}
        {href ? (
          <SleeperLink href={href}>Open {showTeamList ? 'commissioner tools' : 'host settings'} in Sleeper →</SleeperLink>
        ) : (
          <p className="text-[12px] text-white/45">Connect a Sleeper league to open host tools.</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-[12px] leading-relaxed text-white/50">
        These tools live on your fantasy host (e.g. Sleeper). Tap a tile for a team list (where it applies), then finish
        in the host app. All seven supported sports use the same host pattern when integrated.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {tiles.map((t) => {
          const Icon = t.icon
          const inner = (
            <>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.06] text-[#ff9ec0]/95">
                <Icon className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              </div>
              <h3 className="text-[12px] font-bold leading-snug text-white">{t.title}</h3>
              <p className="mt-1 text-[10px] leading-relaxed text-white/40">{t.description}</p>
            </>
          )
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTool(t.id)}
              data-testid={`commish-tile-${t.id}`}
              className="rounded-xl border border-white/[0.08] bg-[#0a1228]/90 p-3 text-left transition hover:border-[#ff3d81]/25 hover:bg-[#0c1220]"
            >
              {inner}
            </button>
          )
        })}
      </div>

      <div className="border-t border-white/[0.08] pt-4">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-wide text-white/35">Danger zone</p>
        <div className="space-y-3">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-3 text-left transition hover:border-amber-500/40"
              data-testid="commish-reset-league-host"
            >
              <div>
                <p className="text-[14px] font-semibold text-amber-200">Reset league</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-white/45">
                  Clear rosters while keeping settings — performed in the host app.
                </p>
              </div>
              <RefreshCw className="h-5 w-5 shrink-0 text-amber-300/80" aria-hidden />
            </a>
          ) : (
            <div className="rounded-xl border border-white/[0.06] bg-[#0a1228]/60 px-3 py-3 text-[12px] text-white/45">
              Connect a league with a platform id to link host commissioner tools.
            </div>
          )}

          <div className="rounded-xl border border-rose-500/20 bg-rose-950/15 px-3 py-3">
            <p className="mb-2 text-[14px] font-semibold text-rose-200">Delete / remove</p>
            <p className="mb-3 text-[11px] leading-relaxed text-white/45">
              Nuke on the host is done in Sleeper (or your platform). Removing from AllFantasy only drops your import
              here.
            </p>
            <DeleteLeagueFromAfPanel
              leagueId={ctx.league.id}
              currentUserId={ctx.userId}
              leagueOwnerUserId={ctx.league.userId}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function LeagueDuesTrackerPanel({ ctx }: { ctx: SubPanelContext }) {
  const storageKey = `af-league-dues-track-${ctx.league.id}`
  const [track, setTrack] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null
      setTrack(v === '1')
    } catch {
      /* ignore */
    }
    setLoaded(true)
  }, [storageKey])

  const save = () => {
    try {
      window.localStorage.setItem(storageKey, track ? '1' : '0')
      toast.success('Saved on this device')
    } catch {
      toast.error('Could not save preference')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[15px] font-bold text-white">League Dues Tracker</h3>
        <p className="mt-1 text-[12px] text-sky-200/55">Track league payments status</p>
      </div>
      <label className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#0a1228]/80 px-3 py-3">
        <span className="text-[13px] font-medium text-white/90">Track dues</span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-[#ff3d81]"
          checked={track}
          disabled={!loaded}
          onChange={(e) => setTrack(e.target.checked)}
          data-testid="league-dues-track-toggle"
        />
      </label>
      <p className="text-[11px] leading-relaxed text-sky-200/45">
        For tracking only. All money exchanges should be handled outside AllFantasy.
      </p>
      <button
        type="button"
        onClick={() => save()}
        disabled={!loaded}
        className="w-full rounded-xl border border-[#ff3d81]/35 bg-[#ff3d81]/15 py-2.5 text-[13px] font-bold text-[#ffd7e5] hover:bg-[#ff3d81]/25 disabled:cursor-not-allowed disabled:opacity-40"
        data-testid="league-dues-save"
      >
        Save
      </button>
      <p className="text-[10px] text-white/35">
        Preference is stored locally until a server API is available for your league.
      </p>
    </div>
  )
}

function parseNameList(raw: string): { name: string }[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name }))
}

function AiFeaturePanel({ panelId, ctx }: { panelId: string; ctx: SubPanelContext }) {
  const { handleApiResponse } = useAfSubGate('commissioner_ai_tools')
  const titles: Record<string, string> = {
    'ai-chimmy-setup': 'League helper setup',
    'ai-power-rankings': 'League health rankings',
    'ai-trade': 'Trade health review',
    'ai-waiver': 'Waiver watchlist',
    'ai-recap': 'Weekly League Report',
    'ai-draft-help': 'Draft guide',
    'ai-matchup': 'Matchup prep',
    'ai-trash': 'Rivalry prompt',
  }

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<unknown>(null)
  const [giveText, setGiveText] = useState('')
  const [getText, setGetText] = useState('')
  const [week, setWeek] = useState('')
  const [targetName, setTargetName] = useState('')
  const [recentPerf, setRecentPerf] = useState('')
  const [intensity, setIntensity] = useState<'mild' | 'medium' | 'savage'>('medium')

  const leagueId = ctx.league.id

  const run = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      let endpoint = ''
      let payload: Record<string, unknown> = { leagueId }

      switch (panelId) {
        case 'ai-chimmy-setup':
          endpoint = '/api/ai/chimmy-setup'
          break
        case 'ai-power-rankings':
          endpoint = '/api/ai/power-rankings'
          break
        case 'ai-trade': {
          const give = parseNameList(giveText)
          const get = parseNameList(getText)
          if (give.length === 0 && get.length === 0) {
            throw new Error('Add at least one player on the give or get side (comma-separated names).')
          }
          endpoint = '/api/ai/trade-analysis'
          payload = { leagueId, give, get }
          break
        }
        case 'ai-waiver':
          endpoint = '/api/ai/waiver-recs'
          payload = { leagueId, userId: ctx.userId }
          break
        case 'ai-recap': {
          endpoint = '/api/ai/weekly-recap'
          const w = week.trim() ? parseInt(week, 10) : undefined
          payload = { leagueId, week: Number.isFinite(w) ? w : undefined }
          break
        }
        case 'ai-draft-help':
          endpoint = '/api/ai/draft-help'
          break
        case 'ai-matchup': {
          endpoint = '/api/ai/matchup-preview'
          const w = week.trim() ? parseInt(week, 10) : undefined
          payload = { leagueId, userId: ctx.userId, week: Number.isFinite(w) ? w : undefined }
          break
        }
        case 'ai-trash':
          endpoint = '/api/ai/trash-talk'
          if (!targetName.trim()) throw new Error('Enter a target display name.')
          payload = {
            targetDisplayName: targetName.trim(),
            recentPerformance: recentPerf.trim() || undefined,
            intensity,
          }
          break
        default:
          throw new Error('Unknown AI tool panel')
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const fk = LEAGUE_SETTINGS_AI_PANEL_FEATURE[panelId] ?? 'commissioner_ai_tools'
      if (!(await handleApiResponse(res, fk))) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Request failed')
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  const testId = `ai-run-${panelId.replace(/[^a-z-]/gi, '-')}`

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-white/70">{titles[panelId] ?? 'AI tool'}</p>

      {panelId === 'ai-trade' ? (
        <div className="space-y-2">
          <div>
            <label className="text-[11px] text-white/45">Players you give (comma-separated)</label>
            <textarea
              value={giveText}
              onChange={(e) => setGiveText(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1f3a] px-3 py-2 text-[12px] text-white"
              placeholder="e.g. Josh Allen, Travis Kelce"
            />
          </div>
          <div>
            <label className="text-[11px] text-white/45">Players you get</label>
            <textarea
              value={getText}
              onChange={(e) => setGetText(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1f3a] px-3 py-2 text-[12px] text-white"
            />
          </div>
        </div>
      ) : null}

      {panelId === 'ai-recap' || panelId === 'ai-matchup' ? (
        <div>
          <label className="text-[11px] text-white/45">Week (optional — defaults to current)</label>
          <input
            type="number"
            min={1}
            max={24}
            value={week}
            onChange={(e) => setWeek(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1f3a] px-3 py-2 text-[13px] text-white"
          />
        </div>
      ) : null}

      {panelId === 'ai-trash' ? (
        <div className="space-y-2">
          <div>
            <label className="text-[11px] text-white/45">Target display name</label>
            <input
              value={targetName}
              onChange={(e) => setTargetName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1f3a] px-3 py-2 text-[13px] text-white"
            />
          </div>
          <div>
            <label className="text-[11px] text-white/45">Recent performance (optional)</label>
            <textarea
              value={recentPerf}
              onChange={(e) => setRecentPerf(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1f3a] px-3 py-2 text-[12px] text-white"
              placeholder="e.g. Lost 3 straight, lowest PF in league"
            />
          </div>
          <div>
            <label className="text-[11px] text-white/45">Intensity</label>
            <select
              value={intensity}
              onChange={(e) => setIntensity(e.target.value as 'mild' | 'medium' | 'savage')}
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1f3a] px-3 py-2 text-[13px] text-white"
            >
              <option value="mild">Mild</option>
              <option value="medium">Medium</option>
              <option value="savage">Savage</option>
            </select>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        disabled={loading}
        onClick={() => void run()}
        className="w-full rounded-xl bg-gradient-to-r from-violet-600/50 to-fuchsia-600/45 py-2.5 text-[13px] font-bold text-white shadow-lg shadow-violet-900/20 disabled:opacity-50"
        data-testid={testId}
      >
        {loading ? 'Running…' : 'Run'}
      </button>
      {error ? <p className="text-[12px] text-rose-300">{error}</p> : null}
      {result != null ? (
        <pre className="max-h-64 overflow-auto rounded-xl border border-white/[0.08] bg-[#0d1117] p-3 text-[11px] leading-relaxed text-white/85">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}
