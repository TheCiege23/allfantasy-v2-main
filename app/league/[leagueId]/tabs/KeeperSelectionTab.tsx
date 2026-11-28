'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { LEAGUE_TYPE_MEDIA } from '@/lib/create-league-v2/theme'
import './keeper/keeper-surfaces.css'

type SessionRow = {
  id: string
  seasonId: string
  status: string
  deadline: string
  teamsSubmitted: number
  totalTeams: number
}

type ContextPayload = {
  league: { keeperCount: number | null }
  session: SessionRow | null
  viewerRoster: { id: string; seasonId: string } | null
  /** The viewer's team in the season just played: the players listed here come from it. */
  sourceRoster?: { id: string; seasonId: string } | null
}

type RosterPlayer = {
  playerId: string
  playerName: string
  position: string
  team: string | null
}

type EligRow = {
  playerId: string
  isEligible: boolean
  ineligibleReason: string | null
  projectedCost: string | null
  projectedCostRound: number | null
  yearsKept: number
}

type KeeperValue = { marketRank: number; pickSlot: number; surplus: number }
type ValueReport = { available: true; values: Record<string, KeeperValue> } | { available: false; reason: string }

const rounds = (n: number) => `${n} ${n === 1 ? 'round' : 'rounds'}`

/**
 * The keeper value line, in ROUNDS — the unit the War Room uses for the same player ("8 rounds of value"), and the
 * round he costs is already on the line above, so it is not said again (2026-11-24 audit: "Keeping him costs a
 * round 9 pick" then "Worth 93 picks more than he costs (drafted around pick 9, costs pick 102)").
 * `tone` is `bad` when keeping him costs more than he is worth.
 */
export function keeperValueLine(v: KeeperValue, costRound: number | null, teams: number): { text: string; tone: 'good' | 'even' | 'bad' } {
  const marketRound = Math.max(1, Math.ceil(v.marketRank / Math.max(1, teams)))
  const goes = `usually goes in round ${marketRound}`
  // The round gap when the cost round is known (what the War Room computes); else the pick gap in rounds.
  const gap = costRound != null ? costRound - marketRound : Math.round(v.surplus / Math.max(1, teams))
  if (gap > 0) return { text: `${rounds(gap)} of value · ${goes}`, tone: 'good' }
  if (gap === 0) return { text: `About what he costs · ${goes}`, tone: 'even' }
  return { text: `Costs ${rounds(-gap)} more than he's worth · ${goes}`, tone: 'bad' }
}

/** A submitted keeper's status in words. */
const RECORD_STATUS: Record<string, string> = {
  pending: 'Waiting for your commissioner',
  confirmed: 'Confirmed',
  approved: 'Confirmed',
  rejected: 'Rejected by your commissioner',
  locked: 'Locked in',
}
const RECORD_TONE: Record<string, string> = { pending: 'kp-warn', confirmed: 'kp-good', approved: 'kp-good', rejected: 'kp-bad', locked: 'kp-good' }
const roundPick = (label: string | null, round: number | null) =>
  (label ?? (round != null ? `Round ${round}` : null))?.replace(/^Round (\d+)$/, 'a round $1 pick') ?? null

/**
 * Why a player could not be kept, in words. The save answered with the engine's own codes
 * ("duplicate_round_5; rejected_by_commissioner"), which is what the manager was shown.
 */
export function keeperRefusalText(conflict: { playerIds?: string[]; reason: string }, nameOf: (playerId: string) => string): string {
  const names = (conflict.playerIds ?? []).map(nameOf).filter(Boolean).join(' and ') || 'This player'
  const many = (conflict.playerIds ?? []).length > 1
  const round = /^duplicate_round_(\d+)$/.exec(conflict.reason)?.[1]
  if (round) return `${names} ${many ? 'both cost' : 'costs'} a round ${round} pick. Keep one, or ask your commissioner how the league settles it.`
  switch (conflict.reason) {
    case 'rejected_by_commissioner': return `${names}: your commissioner rejected this keeper.`
    case 'not_on_roster': return `${names} ${many ? 'are' : 'is'} not on your roster.`
    case 'max_years_reached': return `${names} ${many ? 'have' : 'has'} been kept the most seasons your league allows.`
    case 'not_drafted': return `${names}: your league only allows keeping players who were drafted.`
    case 'above_round_floor': return `${names} ${many ? 'were' : 'was'} drafted too early to keep under your league's rules.`
    case 'no_pick_available': return `${names}: you have no draft pick left to pay for this keeper.`
    default: return `${names} ${many ? 'are' : 'is'} not eligible to be kept.`
  }
}

type KeeperRec = {
  id: string
  playerId: string
  playerName: string | null
  status: string
  costRound: number | null
  costLabel: string | null
}

export function KeeperSelectionTab({ leagueId }: { leagueId: string }) {
  const [loading, setLoading] = useState(true)
  const [ctx, setCtx] = useState<ContextPayload | null>(null)
  const [players, setPlayers] = useState<RosterPlayer[]>([])
  const [eligibility, setEligibility] = useState<EligRow[]>([])
  const [valueReport, setValueReport] = useState<ValueReport | null>(null)
  const [records, setRecords] = useState<KeeperRec[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  const media = LEAGUE_TYPE_MEDIA.keeper

  const loadContext = useCallback(async () => {
    const res = await fetch(`/api/keeper/context?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'include',
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Failed to load')
    return j as ContextPayload
  }, [leagueId])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const c = await loadContext()
      setCtx(c)
      if (!c.session || !c.viewerRoster) {
        setPlayers([])
        setEligibility([])
        setRecords([])
        setSelected(new Set())
        return
      }

      const [eligRes, rosterRes, recRes] = await Promise.all([
        fetch(
          `/api/keeper/eligibility?leagueId=${encodeURIComponent(leagueId)}&seasonId=${encodeURIComponent(c.session.seasonId)}&rosterId=${encodeURIComponent(c.viewerRoster.id)}`,
          { credentials: 'include' },
        ),
        // Keepers come FROM last season's team; `viewerRoster` is next season's empty shell they land on.
        fetch(`/api/redraft/roster?rosterId=${encodeURIComponent(c.sourceRoster?.id ?? c.viewerRoster.id)}&week=1`, {
          credentials: 'include',
        }),
        fetch(
          `/api/keeper/selections?leagueId=${encodeURIComponent(leagueId)}&seasonId=${encodeURIComponent(c.session.seasonId)}&rosterId=${encodeURIComponent(c.viewerRoster.id)}`,
          { credentials: 'include' },
        ),
      ])

      const eligJson = await eligRes.json().catch(() => ({}))
      if (eligRes.ok && Array.isArray(eligJson.raw)) {
        setEligibility(eligJson.raw as EligRow[])
        setValueReport(eligJson.valueReport && typeof eligJson.valueReport === 'object' ? (eligJson.valueReport as ValueReport) : null)
      } else {
        setEligibility([])
        setValueReport(null)
      }

      const rosterJson = await rosterRes.json().catch(() => ({}))
      const rp = rosterJson.roster?.players
      if (rosterRes.ok && Array.isArray(rp)) {
        setPlayers(
          rp
            .filter((p: { droppedAt?: string | null }) => !p.droppedAt)
            .map((p: { playerId: string; playerName: string; position: string; team?: string | null }) => ({
              playerId: p.playerId,
              playerName: p.playerName,
              position: p.position,
              team: p.team ?? null,
            })),
        )
      } else {
        setPlayers([])
      }

      const recJson = await recRes.json().catch(() => ({}))
      const recs = Array.isArray(recJson.records) ? (recJson.records as KeeperRec[]) : []
      setRecords(recs)
      setSelected(new Set(recs.filter((r) => r.status !== 'rejected').map((r) => r.playerId)))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Load failed')
      setCtx(null)
    } finally {
      setLoading(false)
    }
  }, [leagueId, loadContext])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const maxKeepers = ctx?.league.keeperCount ?? 3
  const session = ctx?.session
  const locked = session?.status === 'locked'
  const deadlinePassed = session ? new Date(session.deadline).getTime() < Date.now() : false

  const eligByPlayer = useMemo(() => {
    const m = new Map<string, EligRow>()
    for (const e of eligibility) m.set(e.playerId, e)
    return m
  }, [eligibility])

  const toggle = (pid: string) => {
    if (locked || deadlinePassed) return
    const e = eligByPlayer.get(pid)
    if (e && !e.isEligible) {
      toast.error(e.ineligibleReason ?? 'Not eligible')
      return
    }
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(pid)) next.delete(pid)
      else {
        if (next.size >= maxKeepers) {
          toast.error(`You can keep at most ${maxKeepers} players.`)
          return prev
        }
        next.add(pid)
      }
      return next
    })
  }

  const submit = async () => {
    if (!ctx?.session || !ctx.viewerRoster || locked) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/keeper/selections', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          seasonId: ctx.session.seasonId,
          rosterId: ctx.viewerRoster.id,
          playerIds: Array.from(selected),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : 'Could not save keepers')
        return
      }
      if (Array.isArray(j.conflicted) && j.conflicted.length > 0) {
        toast.message('Some players could not be kept', {
          description: j.conflicted.map((c: { playerIds?: string[]; reason: string }) => keeperRefusalText(c, (id) => players.find((p) => p.playerId === id)?.playerName ?? '')).join(' '),
        })
      } else {
        toast.success('Keeper declaration saved')
      }
      await refresh()
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && !ctx) {
    return (
      <div className="kp-muted flex items-center gap-2 px-4 py-8 text-[13px]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your keepers…
      </div>
    )
  }

  const closed = locked || deadlinePassed
  const recordByPlayer = new Map(records.map((r) => [r.playerId, r]))
  // Once the window closes the list is the keepers themselves, not the roster they were picked from.
  const shown = closed ? players.filter((p) => recordByPlayer.has(p.playerId) && recordByPlayer.get(p.playerId)!.status !== 'rejected') : players
  const deadlineText = session
    ? new Date(session.deadline).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : ''

  return (
    <div className="space-y-4 px-4 py-4">
      {/*
       * The artwork is a banner only. Its title used to sit ON the art as text-white, which light mode turns dark
       * (keeper audit 2026-11-22); the one headline now sits below it in token colours. On a phone it took the top
       * 140px of every state, so it shows from sm up (2026-11-24 audit).
       */}
      <div className="kp-card hidden overflow-hidden rounded-2xl sm:block" data-testid="keeper-hero-media">
        <div className="relative aspect-[21/9] max-h-[200px] w-full">
          <video
            className="h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            aria-hidden="true"
            poster={media.fallback}
            src={media.video}
          />
        </div>
      </div>

      <div>
        {/* The headline follows the window: "Pick your keepers" over a locked list told you to do what you can't. */}
        <h2 className="kp-text text-[18px] font-bold">{!session ? 'Keepers' : closed ? 'Your keepers' : 'Pick your keepers'}</h2>
        <p className="kp-muted mt-1 text-[13px] leading-snug">
          {!session
            ? 'Keepers carry over to next season and skip the draft.'
            : locked
              ? 'Keepers are locked. These are final for the draft.'
              : deadlinePassed
                ? 'The deadline has passed. Your commissioner can still make changes.'
                : `Pick up to ${maxKeepers} keepers by ${deadlineText}. Each one costs a draft pick.`}
        </p>
      </div>

      {!session ? (
        <div className="kp-card kp-text2 rounded-xl p-4 text-[13px]">
          <AlertCircle className="kp-warn mb-1 mr-1 inline h-4 w-4" /> The keeper window isn’t open yet. Your commissioner opens it before the draft.
        </div>
      ) : !ctx?.viewerRoster ? (
        <div className="kp-card kp-text2 rounded-xl p-4 text-[13px]">
          You don’t have a team in this season yet. If you just joined, your commissioner will assign you one.
        </div>
      ) : (
        <>
          <div className="kp-card flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl px-4 py-3 text-[13px]">
            <p className="kp-text font-semibold" data-testid="keeper-picked-count">
              {closed ? `${shown.length} kept` : `${selected.size} of ${maxKeepers} picked`}
            </p>
            <p className="kp-muted">
              {session.teamsSubmitted} of {session.totalTeams} teams have picked
            </p>
          </div>

          {valueReport?.available ? (
            <p className="kp-muted text-[12px]" data-testid="keeper-value-note">
              Value compares where a player goes in drafts with the pick he costs to keep.
            </p>
          ) : null}

          <div className="grid gap-2 lg:grid-cols-2" data-testid="keeper-list">
            {shown.length === 0 ? (
              // The roster arrives after the window does: say "loading" until it has, not that there is no team.
              <p className="kp-muted text-[13px]">
                {loading ? 'Loading your roster…' : closed ? 'You kept no one this season.' : 'No players on your roster for this season yet.'}
              </p>
            ) : (
              shown.map((p) => {
                const e = eligByPlayer.get(p.playerId)
                const sel = selected.has(p.playerId)
                const ineligible = e && !e.isEligible
                const rec = recordByPlayer.get(p.playerId)
                const cost = e ? roundPick(e.projectedCost, e.projectedCostRound) : rec ? roundPick(rec.costLabel, rec.costRound) : null
                const v = valueReport?.available ? valueReport.values[p.playerId] : undefined
                const value = v ? keeperValueLine(v, e?.projectedCostRound ?? rec?.costRound ?? null, session.totalTeams || 12) : null
                const body = (
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="kp-text text-[14px] font-semibold">{p.playerName}</span>
                      {/* Where his submission stands, on his own card — it was a second list under the roster. */}
                      {rec ? (
                        <span className={`text-[12px] font-semibold ${RECORD_TONE[rec.status] ?? 'kp-muted'}`} data-testid={`keeper-status-${p.playerId}`}>
                          {RECORD_STATUS[rec.status] ?? rec.status.replace(/_/g, ' ')}
                        </span>
                      ) : null}
                    </span>
                    <span className="kp-muted text-[12px]">
                      {p.position}
                      {p.team ? ` · ${p.team}` : ''}
                    </span>
                    {cost ? <span className="kp-text2 mt-0.5 block text-[12px]">Costs {cost}</span> : null}
                    {value ? (
                      <span
                        className={`mt-0.5 flex items-center gap-1 text-[12px] ${value.tone === 'good' ? 'kp-good' : value.tone === 'bad' ? 'kp-warn' : 'kp-muted'}`}
                        data-testid="keeper-value"
                        data-tone={value.tone}
                      >
                        {value.tone === 'bad' ? <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
                        {value.text}
                      </span>
                    ) : null}
                    {ineligible ? (
                      <span className="kp-bad mt-1 flex items-center gap-1 text-[12px]">
                        <XCircle className="h-3 w-3" /> {e?.ineligibleReason ?? 'Can’t be kept'}
                      </span>
                    ) : null}
                  </span>
                )
                // A closed window lists only the keepers, as plain cards: no box to tick that cannot be ticked.
                return closed ? (
                  <div key={p.playerId} className="kp-row flex w-full items-start gap-3 rounded-xl px-3 py-2.5" data-testid={`keeper-select-${p.playerId}`}>
                    {body}
                  </div>
                ) : (
                  <button
                    key={p.playerId}
                    type="button"
                    disabled={Boolean(ineligible)}
                    aria-pressed={sel}
                    data-testid={`keeper-select-${p.playerId}`}
                    onClick={() => toggle(p.playerId)}
                    // Only an ineligible row is dimmed (audit item 6, 2026-11-22).
                    className={`kp-row flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${ineligible ? 'opacity-70' : ''}`}
                  >
                    <span className="kp-accent mt-0.5" aria-hidden="true">
                      {sel ? <CheckCircle2 className="h-4 w-4" /> : <span className="kp-box inline-block h-4 w-4 rounded" />}
                    </span>
                    {body}
                  </button>
                )
              })
            )}
          </div>

          {!closed ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit()}
              className="kp-btn-primary inline-flex min-h-[48px] w-full items-center justify-center rounded-xl text-[14px] font-bold disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Save keepers'}
            </button>
          ) : null}
        </>
      )}

      {session && !closed ? (
      <div className="kp-card rounded-lg p-3 text-[13px]" data-testid="keeper-draft-room-note">
        <p className="kp-text font-semibold">Draft room</p>
        <p className="kp-muted mt-1">
          In a snake draft you can also set keepers from the draft room’s Keeper panel before the clock starts.
        </p>
        <Link href={`/league/${leagueId}?tab=draft`} className="kp-accent mt-2 inline-block font-semibold hover:underline">
          Go to draft →
        </Link>
      </div>
      ) : null}
    </div>
  )
}
