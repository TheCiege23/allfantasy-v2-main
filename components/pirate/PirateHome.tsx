'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Anchor, Clock3, LockKeyhole, Shield, Skull, Sparkles, Trophy, X } from 'lucide-react'

type Player = { id: string; playerId: string; playerName: string; position: string; team: string | null; slotType: string }
type Roster = { id: string; ownerId: string; ownerName: string; teamName: string | null; players: Player[] }
type Protection = { rosterId: string; week: number; playerIds: string[]; status: string; voidReason: string | null }
type LineupRuling = { claimId: string; decision: 'forfeit' | 'excused'; reason: string; createdAt: string; source?: 'automatic' | 'commissioner' }
type LineupEvidence = {
  decision: string; reason: string; issues: string[]; eventAt: string; snapshotCount: number
  snapshot: { capturedAt: string; injurySyncAt: string | null; lineupCertified: boolean; waiverWitnessCount: number
    players: Array<{ playerId: string; playerName: string; slotType: string; injuryStatus: string | null; kickoffAt: string | null; availabilityKnown: boolean; waiverVerified: boolean; dropPlayerName?: string | null }> }
}
type Claim = {
  id: string; week: number; winnerRosterId: string; loserRosterId: string
  playerId: string | null; offeredPlayerId: string | null; counterPlayerId: string | null
  status: string; deadlineAt: string | null; selectionDeadlineAt: string | null; overflowGraceUntil: string | null
  transferredAt: string | null; resolutionNote: string | null; scoreCorrectionNeedsReversal: boolean
}
type Data = {
  league: { id: string; name: string | null; sport: string; rosterLimit: number }
  rules: { protectionLimit: number; claimHours: number; selectionHours: number; overflowGraceHours: number; playoffClaims: boolean }
  season: { playoffStartWeek: number }
  week: number
  lockAt: string | null
  canEditProtections: boolean
  myRosterId: string | null
  rosters: Roster[]
  protections: Protection[]
  lineupRulings: LineupRuling[]
  lineupPreviews: Record<string, { issues: string[]; reason: string }>
  lineupEvidence?: Record<string, LineupEvidence | null>
  claims: Claim[]
}

function dateText(value: string | null): string {
  if (!value) return 'Schedule pending'
  return new Date(value).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function nameOf(roster: Roster | undefined): string {
  return roster?.teamName || roster?.ownerName || 'Unclaimed crew'
}

function playerName(roster: Roster | undefined, playerId: string | null): string {
  return roster?.players.find((player) => player.playerId === playerId)?.playerName ?? playerId ?? 'a player'
}

export function PirateHome({ leagueId, isCommissioner }: { leagueId: string; isCommissioner: boolean }) {
  const [data, setData] = useState<Data | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [offered, setOffered] = useState<Record<string, string>>({})
  const [counter, setCounter] = useState<Record<string, string>>({})
  const [reviewReason, setReviewReason] = useState<Record<string, string>>({})
  const [lineupReason, setLineupReason] = useState<Record<string, string>>({})
  const [settings, setSettings] = useState<Data['rules'] | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showVideo, setShowVideo] = useState(false)
  const [celebration, setCelebration] = useState<{ winner: string; loser: string } | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/pirate`, { cache: 'no-store' })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Unable to load the Pirate League.')
    const next = payload as Data
    setData(next)
    setSettings(next.rules)
    const own = next.protections.find((set) => set.rosterId === next.myRosterId && set.week === next.week)
    setSelected(own?.status === 'active' && Array.isArray(own.playerIds) ? own.playerIds : [])
  }, [leagueId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    refresh().catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refresh])

  const byId = useMemo(() => new Map((data?.rosters ?? []).map((roster) => [roster.id, roster])), [data?.rosters])
  const myRoster = data?.myRosterId ? byId.get(data.myRosterId) : undefined
  const mySet = data?.protections.find((set) => set.rosterId === data.myRosterId && set.week === data.week)
  const selectedSet = new Set(selected)

  async function mutate(url: string, body: Record<string, unknown>, celebrate = false) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(url, {
        method: url.endsWith('/pirate') ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Action failed')
      setMessage(payload.message || 'Saved.')
      await refresh()
      if (celebrate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const claim = payload.claim as Claim | undefined
        if (claim) setCelebration({
          winner: nameOf(data?.rosters.find((roster) => roster.id === claim.winnerRosterId)),
          loser: nameOf(data?.rosters.find((roster) => roster.id === claim.loserRosterId)),
        })
        setShowVideo(true)
        window.setTimeout(() => setShowVideo(false), 5000)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  function toggle(playerId: string) {
    if (!data?.canEditProtections || mySet?.status === 'void') return
    if (selectedSet.has(playerId)) {
      setSelected(selected.filter((id) => id !== playerId))
      return
    }
    if (selected.length >= data.rules.protectionLimit) {
      setError(`Only ${data.rules.protectionLimit} players can be protected. Remove a lock before adding another.`)
      return
    }
    setError('')
    setSelected([...selected, playerId])
  }

  const base = `/api/leagues/${encodeURIComponent(leagueId)}/pirate`
  const claimUrl = (claimId: string) => `${base}/claims/${encodeURIComponent(claimId)}`
  const commissionerUrl = (claimId: string) => `${claimUrl(claimId)}/commissioner`
  const activeClaims = data?.claims.filter((claim) => ['awaiting_selection', 'selection_expired', 'pending', 'countered'].includes(claim.status)) ?? []
  const settledClaims = data?.claims.filter((claim) => claim.status === 'transferred') ?? []
  const voidedClaims = data?.claims.filter((claim) => ['void', 'score_corrected', 'reversed'].includes(claim.status)) ?? []
  const rosterOverflow = Math.max(0, (myRoster?.players.length ?? 0) - (data?.league.rosterLimit ?? 0))
  const overflowGraceUntil = data?.claims.filter((claim) => claim.winnerRosterId === data.myRosterId && claim.status === 'transferred' && claim.overflowGraceUntil)
    .map((claim) => claim.overflowGraceUntil!).sort()[0] ?? null

  return (
    <div className="mx-auto w-full max-w-6xl pb-20 text-white">
      <div className="relative isolate overflow-hidden rounded-[28px] border border-amber-300/25 bg-[#071625] shadow-[0_24px_80px_rgba(0,0,0,.4)]">
        <div className="absolute inset-0 bg-[url('/images/league-types/pirate-hero.png')] bg-cover bg-[center_55%] opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#03101e] via-[#03101e]/75 to-[#03101e]/10 sm:bg-gradient-to-r sm:from-[#03101e] sm:via-[#03101e]/90 sm:via-45% sm:to-[#03101e]/25" />
        <div className="relative flex min-h-[295px] flex-col justify-between gap-8 p-6 sm:p-9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/35 bg-[#061421]/80 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.2em] text-amber-200">
              <Anchor size={14} /> Pirate League
            </span>
            {data && <span className="rounded-full border border-white/15 bg-black/35 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-white/80">{data.league.sport} · Week {data.week}</span>}
          </div>
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[.23em] text-amber-300">The weekly hunt</p>
            <h2 className="mt-2 text-4xl font-black tracking-tight sm:text-6xl">{data?.league.name || 'Claim the booty'}</h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-slate-200 sm:text-base">Lock your crew before the first game. Win your matchup. Choose one unprotected player from the losing roster.</p>
          </div>
        </div>
      </div>

      {loading && <p className="mt-6 rounded-2xl border border-white/10 bg-[#081625] p-6 text-sm text-slate-300">Loading the league deck…</p>}
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-400/35 bg-red-950/35 px-4 py-3 text-sm text-red-100">{error}</p>}
      {message && <p role="status" className="mt-5 rounded-xl border border-emerald-400/35 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100">{message}</p>}
      {data && (
        <>
          {myRoster && data.league.rosterLimit > 0 && rosterOverflow > 0 && (
            <p role="status" className="mt-5 rounded-xl border border-amber-300/40 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100">
              Your crew has {myRoster.players.length} players in a {data.league.rosterLimit}-player roster after a steal. Free {rosterOverflow} {rosterOverflow === 1 ? 'spot' : 'spots'} before another acquisition{overflowGraceUntil ? ` and by ${dateText(overflowGraceUntil)}` : ''}. No player will be dropped automatically.
            </p>
          )}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Stat icon={<Shield size={18} />} label="Protection" value={`${selected.length} / ${data.rules.protectionLimit}`} detail={mySet?.status === 'void' ? 'Voided this week' : data.canEditProtections ? 'Still editable' : 'Locked for this week'} />
            <Stat icon={<Clock3 size={18} />} label="First game lock" value={dateText(data.lockAt)} detail={data.lockAt ? 'League schedule time' : 'Awaiting sport schedule'} />
            <Stat icon={<Trophy size={18} />} label="Active claims" value={String(activeClaims.length)} detail={`${data.rules.claimHours}h to respond after selection`} />
          </div>

          <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,.88fr)]">
            <section className="overflow-hidden rounded-[24px] border border-white/10 bg-[#081625] shadow-[0_18px_55px_rgba(0,0,0,.24)]">
              <div className="border-b border-white/10 bg-gradient-to-r from-amber-400/10 to-transparent p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[.18em] text-amber-300">Your crew</p>
                    <h3 className="mt-1 text-2xl font-black">Protection deck</h3>
                    <p className="mt-1 text-sm leading-5 text-slate-400">Choose any starter, bench player, or IR player. Empty slots expire when games begin.</p>
                  </div>
                  <LockKeyhole className="shrink-0 text-amber-300" size={25} />
                </div>
              </div>
              {!myRoster ? (
                <p className="p-6 text-sm text-slate-300">Claim a team in this league to set its protections.</p>
              ) : (
                <div className="p-4 sm:p-6">
                  {mySet?.status === 'void' && <p className="mb-4 rounded-xl border border-rose-400/35 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">All locks were voided for this week: {mySet.voidReason === 'over_limit' ? 'too many players were submitted' : mySet.voidReason === 'illegal_lineup' ? 'the commissioner ruled the lineup illegal with an available replacement' : 'a change was attempted after games began'}.</p>}
                  <div className="grid gap-2">
                    {myRoster.players.map((player) => {
                      const locked = selectedSet.has(player.playerId)
                      return (
                        <button
                          key={player.id}
                          type="button"
                          disabled={!data.canEditProtections || mySet?.status === 'void' || busy}
                          onClick={() => toggle(player.playerId)}
                          aria-pressed={locked}
                          className={`flex min-h-[56px] items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ${locked ? 'border-amber-300/55 bg-amber-300/12 shadow-[inset_0_0_0_1px_rgba(251,191,36,.12)]' : 'border-white/10 bg-white/[.035] hover:border-white/25 hover:bg-white/[.07]'}`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-white">{player.playerName}</span>
                            <span className="block text-xs text-slate-400">{player.position} · {player.team || 'FA'} · {player.slotType}</span>
                          </span>
                          <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${locked ? 'bg-amber-300 text-[#071522]' : 'bg-white/10 text-slate-400'}`}><LockKeyhole size={17} /></span>
                        </button>
                      )
                    })}
                    {!myRoster.players.length && <p className="py-6 text-sm text-slate-400">Your roster is empty. Draft players before setting protections.</p>}
                  </div>
                  <button
                    type="button"
                    disabled={!data.canEditProtections || mySet?.status === 'void' || busy || !data.lockAt}
                    onClick={() => mutate(`${base}/protections`, { rosterId: myRoster.id, week: data.week, playerIds: selected })}
                    className="mt-4 min-h-[48px] w-full rounded-xl bg-amber-300 px-4 py-3 text-sm font-black text-[#071522] transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-45"
                  >{busy ? 'Saving…' : 'Save protection locks'}</button>
                </div>
              )}
            </section>

            <section className="rounded-[24px] border border-white/10 bg-[#081625] p-5 shadow-[0_18px_55px_rgba(0,0,0,.24)] sm:p-6">
              <p className="text-xs font-bold uppercase tracking-[.18em] text-cyan-300">Head-to-head spoils</p>
              <h3 className="mt-1 text-2xl font-black">The claim board</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">Final matchups create claims automatically. The winner names a player; the loser can accept or request a player back.</p>
              <div className="mt-5 space-y-3">
                {activeClaims.map((claim) => {
                  const winner = byId.get(claim.winnerRosterId)
                  const loser = byId.get(claim.loserRosterId)
                  const isWinner = data.myRosterId === claim.winnerRosterId
                  const isLoser = data.myRosterId === claim.loserRosterId
                  const protection = data.protections.find((set) => set.rosterId === claim.loserRosterId && set.week === claim.week)
                  const lineupRuling = data.lineupRulings?.find((ruling) => ruling.claimId === claim.id)
                  const evidence = data.lineupEvidence?.[claim.id]
                  const locked = new Set(protection?.status === 'active' ? protection.playerIds : [])
                  const claimable = loser?.players.filter((player) => !locked.has(player.playerId)) ?? []
                  return (
                    <div key={claim.id} className="rounded-2xl border border-white/12 bg-[#0d2133] p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-[.15em] text-amber-300">Week {claim.week} · {claim.status.replaceAll('_', ' ')}</span>
                        <Skull size={17} className="text-amber-300/70" />
                      </div>
                      <p className="mt-2 text-sm font-semibold text-white">{nameOf(winner)} <span className="text-amber-300">→</span> {nameOf(loser)}</p>
                      {lineupRuling && <p className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200">{lineupRuling.source === 'automatic' ? 'Automatic lineup ruling' : 'Lineup ruling'}: <strong>{lineupRuling.decision === 'forfeit' ? 'protections forfeited' : 'protections kept'}</strong>. {lineupRuling.reason}</p>}
                      {claim.playerId && <p className="mt-2 text-xs text-slate-300">Claimed: <strong className="text-white">{playerName(loser, claim.playerId)}</strong></p>}
                      {claim.deadlineAt && <p className="mt-1 text-xs text-slate-400">Automatic transfer: {dateText(claim.deadlineAt)}</p>}
                      {claim.selectionDeadlineAt && claim.status === 'awaiting_selection' && <p className="mt-1 text-xs text-slate-400">Choose by: {dateText(claim.selectionDeadlineAt)}</p>}
                      {claim.status === 'selection_expired' && <p className="mt-1 text-xs text-amber-200">Winner selection expired. Commissioner review is available.</p>}
                      {claim.status === 'awaiting_selection' && isWinner && (
                        <div className="mt-4 space-y-2">
                          <select aria-label="Player to claim" value={chosen[claim.id] ?? ''} onChange={(e) => setChosen({ ...chosen, [claim.id]: e.target.value })} className="min-h-[44px] w-full rounded-lg border border-white/20 bg-[#061421] px-3 text-sm text-white">
                            <option value="">Choose unprotected player</option>
                            {claimable.map((player) => <option key={player.id} value={player.playerId}>{player.playerName} · {player.position}</option>)}
                          </select>
                          <select aria-label="Optional player offered in return" value={offered[claim.id] ?? ''} onChange={(e) => setOffered({ ...offered, [claim.id]: e.target.value })} className="min-h-[44px] w-full rounded-lg border border-white/20 bg-[#061421] px-3 text-sm text-white">
                            <option value="">No player offered in return</option>
                            {winner?.players.map((player) => <option key={player.id} value={player.playerId}>{player.playerName} · {player.position}</option>)}
                          </select>
                          <button disabled={busy || !chosen[claim.id]} onClick={() => mutate(claimUrl(claim.id), { action: 'select', playerId: chosen[claim.id], offeredPlayerId: offered[claim.id] || null })} className="min-h-[44px] w-full rounded-lg bg-amber-300 px-4 py-2 text-sm font-bold text-[#061421] disabled:opacity-45">Send claim</button>
                        </div>
                      )}
                      {claim.status === 'pending' && isLoser && (
                        <div className="mt-4 space-y-2">
                          <button disabled={busy} onClick={() => mutate(claimUrl(claim.id), { action: 'accept' }, true)} className="min-h-[44px] w-full rounded-lg bg-emerald-300 px-4 py-2 text-sm font-bold text-[#061421] disabled:opacity-50">Accept {claim.offeredPlayerId ? 'trade' : 'claim'}</button>
                          <select aria-label="Player requested in counteroffer" value={counter[claim.id] ?? ''} onChange={(e) => setCounter({ ...counter, [claim.id]: e.target.value })} className="min-h-[44px] w-full rounded-lg border border-white/20 bg-[#061421] px-3 text-sm text-white">
                            <option value="">Request a player in return</option>
                            {winner?.players.map((player) => <option key={player.id} value={player.playerId}>{player.playerName} · {player.position}</option>)}
                          </select>
                          <button disabled={busy || !counter[claim.id]} onClick={() => mutate(claimUrl(claim.id), { action: 'counter', counterPlayerId: counter[claim.id] })} className="min-h-[44px] w-full rounded-lg border border-cyan-300/45 px-4 py-2 text-sm font-bold text-cyan-200 disabled:opacity-45">Send counteroffer</button>
                        </div>
                      )}
                      {claim.status === 'countered' && isWinner && (
                        <div className="mt-4 space-y-2">
                          <p className="text-xs text-slate-300">They request {playerName(winner, claim.counterPlayerId)} in return.</p>
                          <div className="grid grid-cols-2 gap-2">
                            <button disabled={busy} onClick={() => mutate(claimUrl(claim.id), { action: 'accept_counter' }, true)} className="min-h-[44px] rounded-lg bg-emerald-300 px-3 py-2 text-xs font-bold text-[#061421] disabled:opacity-50">Accept counter</button>
                            <button disabled={busy} onClick={() => mutate(claimUrl(claim.id), { action: 'decline_counter' }, true)} className="min-h-[44px] rounded-lg border border-amber-300/50 px-3 py-2 text-xs font-bold text-amber-200 disabled:opacity-50">Take original claim</button>
                          </div>
                        </div>
                      )}
                      {isCommissioner && (
                        <div className="mt-4 border-t border-white/10 pt-4">
                          <p className="text-[11px] font-bold uppercase tracking-[.15em] text-cyan-300">Commissioner review</p>
                          {!evidence && data.lineupPreviews?.[claim.id]?.issues.length > 0 && <p className="mt-2 rounded-lg border border-amber-300/25 bg-amber-300/5 px-3 py-2 text-xs leading-5 text-amber-100">Current roster flags: {data.lineupPreviews[claim.id].issues.join('; ')}. {data.lineupPreviews[claim.id].reason}</p>}
                          {evidence && <details className="mt-3 rounded-xl border border-cyan-300/25 bg-cyan-300/5 p-3">
                            <summary className="min-h-[44px] cursor-pointer text-sm font-bold text-cyan-200">Captured lineup evidence · {evidence.snapshotCount} snapshots</summary>
                            <p className="text-xs leading-5 text-slate-300">{evidence.reason}</p>
                            {evidence.issues.length > 0 && <p className="mt-2 text-xs text-amber-200">{evidence.issues.join('; ')}</p>}
                            <p className="mt-2 text-xs leading-5 text-slate-400">Game lock: {dateText(evidence.eventAt)}. Captured: {dateText(evidence.snapshot.capturedAt)}. Injury feed checked: {evidence.snapshot.injurySyncAt ? dateText(evidence.snapshot.injurySyncAt) : 'Unverified'}.</p>
                            {!evidence.snapshot.lineupCertified && <p className="mt-2 text-xs text-amber-200">The saved starting slots need commissioner verification.</p>}
                            <ul className="mt-3 divide-y divide-white/10">
                              {evidence.snapshot.players.map((player) => <li key={player.playerId} className="py-2 text-xs leading-5">
                                <span className="font-semibold text-white">{player.playerName}</span><span className="ml-2 text-cyan-200">{player.slotType}</span>
                                <p className="text-slate-400">{player.availabilityKnown ? player.injuryStatus || 'No reported restriction' : 'Availability unverified'} · {dateText(player.kickoffAt)}</p>
                                {player.slotType === 'WAIVER' && <p className="text-cyan-200">{player.waiverVerified
                                  ? player.dropPlayerName ? `Verified option before lock: add this player and drop ${player.dropPlayerName}.` : 'Verified immediate pickup before this lock; no drop required.'
                                  : 'Pickup availability needs verification for this lock.'}</p>}
                              </li>)}
                            </ul>
                            <p className="mt-2 text-xs leading-5 text-slate-400">{evidence.snapshot.waiverWitnessCount > 0 ? 'The recorded option passed the league’s add and drop checks before lock. No roster move was made. ' : ''}Multiple pickups, reserve activations, and daily lineup cases need commissioner review.</p>
                          </details>}
                          {['awaiting_selection', 'selection_expired', 'pending', 'countered'].includes(claim.status) && (
                            <div className="mt-3 rounded-xl border border-amber-300/25 bg-amber-300/5 p-3">
                              <p className="text-xs font-bold text-amber-200">Legal-lineup protection rule</p>
                              <p className="mt-1 text-xs leading-5 text-slate-300">Rule only with evidence from before the relevant lineup lock. If the losing team could not fill every required starter slot with active roster players or players actually addable from waivers, keep its locks. Missing historical evidence means keep locks while you review. If an open claim selected a newly restored protected player, the winner gets a new selection window.</p>
                              <textarea aria-label="Lock-time lineup and replacement evidence" maxLength={1000} placeholder="Which slot was empty or inactive? Which eligible replacement was available before lock? Or why was none available?" value={lineupReason[claim.id] ?? ''} onChange={(e) => setLineupReason({ ...lineupReason, [claim.id]: e.target.value })} className="mt-2 min-h-[88px] w-full rounded-lg border border-white/20 bg-[#061421] px-3 py-2 text-sm text-white placeholder:text-slate-500" />
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <button disabled={busy || (lineupReason[claim.id] ?? '').trim().length < 10} onClick={() => mutate(commissionerUrl(claim.id), { action: 'lineup_ruling', decision: 'excused', reason: lineupReason[claim.id] })} className="min-h-[44px] rounded-lg border border-emerald-300/45 px-3 text-xs font-bold text-emerald-200 disabled:opacity-45">Keep protections</button>
                                <button disabled={busy || (lineupReason[claim.id] ?? '').trim().length < 10} onClick={() => mutate(commissionerUrl(claim.id), { action: 'lineup_ruling', decision: 'forfeit', reason: lineupReason[claim.id] })} className="min-h-[44px] rounded-lg border border-rose-300/45 px-3 text-xs font-bold text-rose-200 disabled:opacity-45">Forfeit protections</button>
                              </div>
                            </div>
                          )}
                          {['awaiting_selection', 'selection_expired'].includes(claim.status) && (
                            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                              <select aria-label="Commissioner player selection" value={chosen[claim.id] ?? ''} onChange={(e) => setChosen({ ...chosen, [claim.id]: e.target.value })} className="min-h-[44px] rounded-lg border border-white/20 bg-[#061421] px-3 text-sm text-white">
                                <option value="">Select for the winner</option>
                                {claimable.map((player) => <option key={player.id} value={player.playerId}>{player.playerName} · {player.position}</option>)}
                              </select>
                              <button disabled={busy || !chosen[claim.id]} onClick={() => mutate(commissionerUrl(claim.id), { action: 'select', playerId: chosen[claim.id] })} className="min-h-[44px] rounded-lg border border-cyan-300/45 px-4 text-xs font-bold text-cyan-200 disabled:opacity-45">Start response window</button>
                            </div>
                          )}
                          {['pending', 'countered'].includes(claim.status) && claim.deadlineAt && new Date(claim.deadlineAt).getTime() <= Date.now() && (
                            <button disabled={busy} onClick={() => mutate(commissionerUrl(claim.id), { action: 'retry' }, true)} className="mt-2 min-h-[44px] rounded-lg border border-cyan-300/45 px-4 text-xs font-bold text-cyan-200 disabled:opacity-45">Retry overdue transfer</button>
                          )}
                          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                            <input aria-label="Reason for voiding claim" maxLength={500} placeholder="Reason to void this claim" value={reviewReason[claim.id] ?? ''} onChange={(e) => setReviewReason({ ...reviewReason, [claim.id]: e.target.value })} className="min-h-[44px] rounded-lg border border-white/20 bg-[#061421] px-3 text-sm text-white placeholder:text-slate-500" />
                            <button disabled={busy || (reviewReason[claim.id] ?? '').trim().length < 5} onClick={() => mutate(commissionerUrl(claim.id), { action: 'void', reason: reviewReason[claim.id] })} className="min-h-[44px] rounded-lg border border-rose-300/45 px-4 text-xs font-bold text-rose-200 disabled:opacity-45">Void claim</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                {!activeClaims.length && <p className="rounded-xl border border-dashed border-white/15 px-4 py-6 text-center text-sm text-slate-400">No live claims. The board fills after a matchup is final.</p>}
              </div>
            </section>
          </div>

          {settledClaims.length > 0 && (
            <section className="mt-7 rounded-[24px] border border-white/10 bg-[#081625] p-5 sm:p-6">
              <div className="flex items-center gap-2"><Sparkles size={19} className="text-amber-300" /><h3 className="text-xl font-black">Recent plunder</h3></div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {settledClaims.slice(0, 6).map((claim) => (
                  <div key={claim.id} className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-amber-300">Week {claim.week} · Claimed</p>
                    <p className="mt-2 text-sm font-semibold">{nameOf(byId.get(claim.winnerRosterId))} took {playerName(byId.get(claim.winnerRosterId), claim.playerId)}</p>
                    {isCommissioner && claim.scoreCorrectionNeedsReversal && <div className="mt-3 space-y-2">
                      <p className="text-xs font-semibold text-rose-200">Final score changed. Reverse this steal after reviewing both rosters.</p>
                      <input aria-label="Score correction reversal reason" maxLength={500} placeholder="Reason for reversal" value={reviewReason[claim.id] ?? ''} onChange={(e) => setReviewReason({ ...reviewReason, [claim.id]: e.target.value })} className="min-h-[44px] w-full rounded-lg border border-white/20 bg-[#061421] px-3 text-sm text-white" />
                      <button disabled={busy || (reviewReason[claim.id] ?? '').trim().length < 5} onClick={() => mutate(commissionerUrl(claim.id), { action: 'reverse', reason: reviewReason[claim.id] })} className="min-h-[44px] rounded-lg border border-rose-300/45 px-4 text-xs font-bold text-rose-200 disabled:opacity-45">Reverse audited steal</button>
                    </div>}
                    <button onClick={() => {
                      setCelebration({ winner: nameOf(byId.get(claim.winnerRosterId)), loser: nameOf(byId.get(claim.loserRosterId)) })
                      setShowVideo(true)
                    }} className="mt-3 min-h-[40px] text-xs font-bold text-cyan-200 underline underline-offset-4">Replay the 5-second steal</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {isCommissioner && settings && (
            <section className="mt-7 rounded-[24px] border border-cyan-300/15 bg-[#081625] p-5 sm:p-6">
              <p className="text-xs font-bold uppercase tracking-[.18em] text-cyan-300">Commissioner controls</p>
              <h3 className="mt-1 text-xl font-black">The league's code</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <label className="text-sm text-slate-300">Protected players
                  <input type="number" min={1} max={10} value={settings.protectionLimit} onChange={(e) => setSettings({ ...settings, protectionLimit: Number(e.target.value) })} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/20 bg-[#061421] px-3 text-white" />
                </label>
                <label className="text-sm text-slate-300">Claim response hours
                  <input type="number" min={1} max={72} value={settings.claimHours} onChange={(e) => setSettings({ ...settings, claimHours: Number(e.target.value) })} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/20 bg-[#061421] px-3 text-white" />
                </label>
                <label className="text-sm text-slate-300">Winner selection hours
                  <input type="number" min={1} max={72} value={settings.selectionHours} onChange={(e) => setSettings({ ...settings, selectionHours: Number(e.target.value) })} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/20 bg-[#061421] px-3 text-white" />
                </label>
                <label className="text-sm text-slate-300">Overflow grace hours
                  <input type="number" min={0} max={72} value={settings.overflowGraceHours} onChange={(e) => setSettings({ ...settings, overflowGraceHours: Number(e.target.value) })} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/20 bg-[#061421] px-3 text-white" />
                </label>
                <label className="flex min-h-[44px] items-center gap-3 self-end rounded-lg border border-white/20 bg-[#061421] px-3 text-sm text-white">
                  <input type="checkbox" checked={settings.playoffClaims} onChange={(e) => setSettings({ ...settings, playoffClaims: e.target.checked })} className="size-5 accent-amber-300" />
                  Steals in playoffs
                </label>
              </div>
              <button disabled={busy} onClick={() => mutate(base, settings)} className="mt-4 min-h-[44px] rounded-lg border border-cyan-300/45 bg-cyan-300/10 px-5 text-sm font-bold text-cyan-100 disabled:opacity-50">Save Pirate rules</button>
              <p className="mt-3 text-xs text-slate-400">Roster, scoring, draft, and playoff start settings stay in the league's standard commissioner controls.</p>
              {voidedClaims.length > 0 && (
                <div className="mt-5 border-t border-white/10 pt-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Reviewed claims</p>
                  {voidedClaims.slice(0, 5).map((claim) => <p key={claim.id} className="mt-2 text-xs text-slate-300">Week {claim.week}: {claim.resolutionNote || 'No reason recorded'}</p>)}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {showVideo && (
        <div role="dialog" aria-modal="true" aria-label="Pirate claim celebration" className="fixed inset-0 z-[120] flex items-center justify-center bg-[#010713]/90 p-4 backdrop-blur-md">
          <div className="relative w-full max-w-4xl overflow-hidden rounded-3xl border border-amber-300/40 bg-[#051222] shadow-[0_35px_100px_rgba(0,0,0,.8)]">
            <video autoPlay muted playsInline poster="/images/league-types/pirate-hero.png" onEnded={() => setShowVideo(false)} className="aspect-video w-full object-cover">
              <source src="/media/league-intros/pirate-claim.mp4" type="video/mp4" />
            </video>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#03101e] to-transparent px-6 pb-6 pt-12">
              <p className="text-xs font-bold uppercase tracking-[.22em] text-amber-300">The booty changes hands</p>
              <p className="mt-1 text-2xl font-black sm:text-4xl">{celebration ? `${celebration.winner} claimed from ${celebration.loser}.` : 'A new player joins the crew.'}</p>
            </div>
            <button aria-label="Close celebration" onClick={() => setShowVideo(false)} className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-full bg-black/70 text-white"><X size={20} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#081625] px-4 py-4">
      <div className="flex items-center gap-2 text-amber-300">{icon}<span className="text-[11px] font-bold uppercase tracking-[.17em]">{label}</span></div>
      <p className="mt-2 text-lg font-black text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </div>
  )
}
