'use client'

/**
 * The Pirate Deck: lock players before the first game, then the weekly claims.
 *
 * Pirate audit, 2026-11-22 (__tests__/pirate/pirateDeckAudit.test.tsx):
 *   - every colour is a `--pr-*` token from ./pirate-identity.css; the deck was hard-coded dark and light mode
 *     drew dark text on navy;
 *   - a claim you must act on (pick, answer, counter) comes BEFORE the protection list — on a phone it sat ~1,950px
 *     down, under the whole roster;
 *   - commissioner review folds away and opens itself only when something is flagged or overdue;
 *   - claim cards say what is happening in a sentence ("Jolly Rogers is taking Garrett Wilson from you");
 *   - the rules editor lives in Settings only (it had a second, differently-labelled copy here);
 *   - one headline: the page header already names the league, so the banner does not repeat it.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Anchor, Clock3, LockKeyhole, Shield, Skull, Sparkles, Trophy, X } from 'lucide-react'
import './pirate-identity.css'

type Player = { id: string; playerId: string; playerName: string; position: string; team: string | null; slotType: string }
type Roster = { id: string; ownerId: string; ownerName: string; teamName: string | null; players: Player[] }
type Protection = { rosterId: string; week: number; playerIds: string[]; status: string; voidReason: string | null }
type LineupRuling = { claimId: string; decision: 'forfeit' | 'excused'; reason: string; createdAt: string; source?: 'automatic' | 'commissioner' }
type LineupEvidence = {
  decision: string; reason: string; issues: string[]; eventAt: string; snapshotCount: number
  snapshot: { capturedAt: string; injurySyncAt: string | null; lineupCertified: boolean; waiverWitnessCount: number; scoringDay?: string | null
    movePlans?: Array<{ checkedAt: string; steps: Array<{ kind: string; playerName: string; fromSlot: string | null; dropPlayerName: string | null }> }>
    players: Array<{ playerId: string; playerName: string; slotType: string; injuryStatus: string | null; kickoffAt: string | null; availabilityKnown: boolean; waiverVerified: boolean; dropPlayerName?: string | null; jointPlanOnly?: boolean; hasGameOnScoringDay?: boolean }> }
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

const LIVE = ['awaiting_selection', 'selection_expired', 'pending', 'countered']

function dateText(value: string | null): string {
  if (!value) return 'Schedule pending'
  return new Date(value).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function nameOf(roster: Roster | undefined): string {
  return roster?.teamName || roster?.ownerName || 'Open team'
}

/** A player's name from any roster in the league: a stolen player may since have moved on from the winner. */
function playerName(rosters: Roster[], playerId: string | null): string {
  if (!playerId) return 'a player'
  for (const roster of rosters) {
    const hit = roster.players.find((player) => player.playerId === playerId)
    if (hit) return hit.playerName
  }
  return 'a player who has since left the league'
}

const SLOT_WORDS: Record<string, string> = { starter: 'Starter', bench: 'Bench', ir: 'IR', taxi: 'Taxi', reserve: 'Reserve' }
const slotWord = (slot: string) => SLOT_WORDS[slot.toLowerCase()] ?? slot.charAt(0).toUpperCase() + slot.slice(1).toLowerCase()

/** The claim's state as the viewer should read it. */
function statusWord(claim: Claim, isWinner: boolean, isLoser: boolean): string {
  switch (claim.status) {
    case 'awaiting_selection': return isWinner ? 'Your pick' : 'Waiting for a pick'
    case 'selection_expired': return 'Pick window closed'
    case 'pending': return isLoser ? 'Waiting for your answer' : 'Waiting for an answer'
    case 'countered': return isWinner ? 'Counteroffer for you' : 'Counteroffer sent'
    default: return claim.status.replaceAll('_', ' ')
  }
}

/** One sentence: who is taking whom, from whom. */
function claimSentence(claim: Claim, winner: string, loser: string, isWinner: boolean, isLoser: boolean, rosters: Roster[]): string {
  const player = playerName(rosters, claim.playerId)
  const who = isWinner ? 'You' : winner
  switch (claim.status) {
    case 'awaiting_selection':
      return isWinner ? `You beat ${loser}. Pick one unlocked player to take.` : `${winner} beat ${isLoser ? 'you' : loser} and is picking a player to take.`
    case 'selection_expired':
      return `${isWinner ? 'You' : winner} didn’t pick a player from ${isLoser ? 'you' : loser} in time.`
    case 'pending':
      return `${who} ${isWinner ? 'are' : 'is'} taking ${player} from ${isLoser ? 'you' : loser}.`
    case 'countered':
      return `${isLoser ? 'You' : loser} asked for ${playerName(rosters, claim.counterPlayerId)} back in return for ${player}.`
    default:
      return `${winner} and ${loser}: ${player}.`
  }
}

export function PirateHome({ leagueId, isCommissioner }: { leagueId: string; isCommissioner: boolean }) {
  const [data, setData] = useState<Data | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [offered, setOffered] = useState<Record<string, string>>({})
  const [counter, setCounter] = useState<Record<string, string>>({})
  const [reviewReason, setReviewReason] = useState<Record<string, string>>({})
  const [lineupReason, setLineupReason] = useState<Record<string, string>>({})
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
  const rosters = data?.rosters ?? []
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
  const activeClaims = data?.claims.filter((claim) => LIVE.includes(claim.status)) ?? []
  const settledClaims = data?.claims.filter((claim) => claim.status === 'transferred') ?? []
  const voidedClaims = data?.claims.filter((claim) => ['void', 'score_corrected', 'reversed'].includes(claim.status)) ?? []
  const rosterOverflow = Math.max(0, (myRoster?.players.length ?? 0) - (data?.league.rosterLimit ?? 0))
  const overflowGraceUntil = data?.claims.filter((claim) => claim.winnerRosterId === data.myRosterId && claim.status === 'transferred' && claim.overflowGraceUntil)
    .map((claim) => claim.overflowGraceUntil!).sort()[0] ?? null
  /** A claim waiting on THIS viewer: their pick, their answer, or a counter to them. */
  const needsMe = activeClaims.some((claim) =>
    (claim.status === 'awaiting_selection' && claim.winnerRosterId === data?.myRosterId)
    || (claim.status === 'pending' && claim.loserRosterId === data?.myRosterId)
    || (claim.status === 'countered' && claim.winnerRosterId === data?.myRosterId))

  const protectionDeck = data ? (
    <section key="deck" data-testid="pirate-protection-deck" className="pr-card overflow-hidden rounded-[20px]">
      <div className="p-5 sm:p-6" style={{ borderBottom: '1px solid var(--pr-line)' }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="pr-text text-xl font-black">Lock your players</h3>
            <p className="pr-muted mt-1 text-sm leading-5">Locked players can’t be taken this week. Lock up to {data.rules.protectionLimit}, from your starters, bench or IR. Locks you don’t use are lost when games start.</p>
          </div>
          <LockKeyhole className="pr-gold shrink-0" size={24} aria-hidden />
        </div>
      </div>
      {!myRoster ? (
        <p className="pr-text2 p-6 text-sm">Claim a team in this league to set its locks.</p>
      ) : (
        <div className="p-4 sm:p-6">
          {mySet?.status === 'void' && <p className="pr-alert mb-4 rounded-xl px-4 py-3 text-sm">All your locks were cancelled for this week: {mySet.voidReason === 'over_limit' ? 'too many players were submitted' : mySet.voidReason === 'illegal_lineup' ? 'the commissioner ruled your lineup illegal when a replacement was available' : 'a change was attempted after games began'}.</p>}
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
                  aria-label={`${locked ? 'Unlock' : 'Lock'} ${player.playerName}`}
                  className="pr-row flex min-h-[56px] items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition disabled:cursor-not-allowed"
                >
                  <span className="min-w-0">
                    <span className="pr-text block truncate text-sm font-semibold">{player.playerName}</span>
                    <span className="pr-muted block text-xs">{player.position} · {player.team || 'FA'} · {slotWord(player.slotType)}</span>
                  </span>
                  <span className="pr-lock flex size-9 shrink-0 items-center justify-center rounded-lg" aria-hidden><LockKeyhole size={17} /></span>
                </button>
              )
            })}
            {!myRoster.players.length && <p className="pr-muted py-6 text-sm">Your roster is empty. Draft players before locking any.</p>}
          </div>
          {data.canEditProtections && mySet?.status !== 'void' ? (
            <button
              type="button"
              disabled={busy || !data.lockAt}
              onClick={() => mutate(`${base}/protections`, { rosterId: myRoster.id, week: data.week, playerIds: selected })}
              className="pr-btn-gold mt-4 min-h-[48px] w-full rounded-xl px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-45"
            >{busy ? 'Saving…' : 'Save locks'}</button>
          ) : null}
        </div>
      )}
    </section>
  ) : null

  const claimBoard = data ? (
    <section key="claims" data-testid="pirate-claim-board" className="pr-card rounded-[20px] p-5 sm:p-6">
      <h3 className="pr-text text-xl font-black">Claims</h3>
      <p className="pr-muted mt-1 text-sm leading-6">When a matchup ends, the winner takes one unlocked player from the team they beat. That team can accept, or ask for a player back.</p>
      <div className="mt-5 space-y-3">
        {activeClaims.map((claim) => {
          const winner = byId.get(claim.winnerRosterId)
          const loser = byId.get(claim.loserRosterId)
          const isWinner = data.myRosterId === claim.winnerRosterId
          const isLoser = data.myRosterId === claim.loserRosterId
          const protection = data.protections.find((set) => set.rosterId === claim.loserRosterId && set.week === claim.week)
          const lineupRuling = data.lineupRulings?.find((ruling) => ruling.claimId === claim.id)
          const evidence = data.lineupEvidence?.[claim.id]
          const preview = data.lineupPreviews?.[claim.id]
          const locked = new Set(protection?.status === 'active' ? protection.playerIds : [])
          const claimable = loser?.players.filter((player) => !locked.has(player.playerId)) ?? []
          const overdue = ['pending', 'countered'].includes(claim.status) && Boolean(claim.deadlineAt) && new Date(claim.deadlineAt!).getTime() <= Date.now()
          // Review opens itself only when there is something to review.
          const reviewOpen = Boolean(evidence) || (preview?.issues.length ?? 0) > 0 || claim.status === 'selection_expired' || overdue
          return (
            <div key={claim.id} data-testid={`pirate-claim-${claim.id}`} className="pr-well rounded-2xl p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="pr-gold text-xs font-bold">Week {claim.week} · {statusWord(claim, isWinner, isLoser)}</span>
                <Skull size={16} className="pr-gold" aria-hidden />
              </div>
              <p className="pr-text mt-2 text-sm font-semibold leading-6">{claimSentence(claim, nameOf(winner), nameOf(loser), isWinner, isLoser, rosters)}</p>
              {lineupRuling && <p className="pr-well pr-text2 mt-2 rounded-lg px-3 py-2 text-xs">{lineupRuling.source === 'automatic' ? 'Automatic lineup ruling' : 'Lineup ruling'}: <strong className="pr-text">{lineupRuling.decision === 'forfeit' ? 'locks removed' : 'locks kept'}</strong>. {lineupRuling.reason}</p>}
              {claim.offeredPlayerId && claim.status === 'pending' && <p className="pr-text2 mt-1 text-xs">Offered back: <strong className="pr-text">{playerName(rosters, claim.offeredPlayerId)}</strong></p>}
              {claim.deadlineAt && ['pending', 'countered'].includes(claim.status) && <p className="pr-muted mt-1 text-xs">Moves automatically {dateText(claim.deadlineAt)} if nobody answers.</p>}
              {claim.selectionDeadlineAt && claim.status === 'awaiting_selection' && <p className="pr-muted mt-1 text-xs">Pick by {dateText(claim.selectionDeadlineAt)}.</p>}
              {claim.status === 'selection_expired' && <p className="pr-warn mt-1 text-xs">The commissioner can pick for the winner.</p>}
              {claim.status === 'awaiting_selection' && isWinner && (
                <div className="mt-4 space-y-2">
                  <select aria-label="Player to claim" value={chosen[claim.id] ?? ''} onChange={(e) => setChosen({ ...chosen, [claim.id]: e.target.value })} className="pr-field min-h-[44px] w-full rounded-lg px-3 text-sm">
                    <option value="">Choose an unlocked player</option>
                    {claimable.map((player) => <option key={player.id} value={player.playerId}>{player.playerName} · {player.position}</option>)}
                  </select>
                  <select aria-label="Optional player offered in return" value={offered[claim.id] ?? ''} onChange={(e) => setOffered({ ...offered, [claim.id]: e.target.value })} className="pr-field min-h-[44px] w-full rounded-lg px-3 text-sm">
                    <option value="">Offer nobody back (optional)</option>
                    {winner?.players.map((player) => <option key={player.id} value={player.playerId}>{player.playerName} · {player.position}</option>)}
                  </select>
                  <button disabled={busy || !chosen[claim.id]} onClick={() => mutate(claimUrl(claim.id), { action: 'select', playerId: chosen[claim.id], offeredPlayerId: offered[claim.id] || null })} className="pr-btn-gold min-h-[44px] w-full rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-45">Send claim</button>
                </div>
              )}
              {claim.status === 'pending' && isLoser && (
                <div className="mt-4 space-y-2">
                  <button disabled={busy} onClick={() => mutate(claimUrl(claim.id), { action: 'accept' }, true)} className="pr-btn-good min-h-[44px] w-full rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50">Accept {claim.offeredPlayerId ? 'trade' : 'claim'}</button>
                  <select aria-label="Player requested in counteroffer" value={counter[claim.id] ?? ''} onChange={(e) => setCounter({ ...counter, [claim.id]: e.target.value })} className="pr-field min-h-[44px] w-full rounded-lg px-3 text-sm">
                    <option value="">Or ask for a player back</option>
                    {winner?.players.map((player) => <option key={player.id} value={player.playerId}>{player.playerName} · {player.position}</option>)}
                  </select>
                  <button disabled={busy || !counter[claim.id]} onClick={() => mutate(claimUrl(claim.id), { action: 'counter', counterPlayerId: counter[claim.id] })} className="pr-btn min-h-[44px] w-full rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-45">Send counteroffer</button>
                </div>
              )}
              {claim.status === 'countered' && isWinner && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button disabled={busy} onClick={() => mutate(claimUrl(claim.id), { action: 'accept_counter' }, true)} className="pr-btn-good min-h-[44px] rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50">Accept counter</button>
                  <button disabled={busy} onClick={() => mutate(claimUrl(claim.id), { action: 'decline_counter' }, true)} className="pr-btn min-h-[44px] rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50">Take original claim</button>
                </div>
              )}
              {isCommissioner && (
                <details data-testid={`pirate-commish-review-${claim.id}`} open={reviewOpen} className="mt-4 pt-3" style={{ borderTop: '1px solid var(--pr-line)' }}>
                  <summary className="pr-accent min-h-[36px] cursor-pointer text-xs font-bold">Commissioner review</summary>
                  {!evidence && (preview?.issues.length ?? 0) > 0 && <p className="pr-note mt-2 rounded-lg px-3 py-2 text-xs leading-5">Flagged now: {preview!.issues.join('; ')}. {preview!.reason}</p>}
                  {evidence && <details className="pr-well mt-3 rounded-xl p-3">
                    <summary className="pr-accent min-h-[44px] cursor-pointer text-sm font-bold">Captured lineup evidence · {evidence.snapshotCount} snapshots</summary>
                    <p className="pr-text2 text-xs leading-5">{evidence.reason}</p>
                    {evidence.snapshot.scoringDay && <p className="pr-accent mt-2 text-xs font-semibold">Daily lineup: {evidence.snapshot.scoringDay} · Eastern time</p>}
                    {evidence.issues.length > 0 && <p className="pr-warn mt-2 text-xs">{evidence.issues.join('; ')}</p>}
                    <p className="pr-muted mt-2 text-xs leading-5">Game lock: {dateText(evidence.eventAt)}. Captured: {dateText(evidence.snapshot.capturedAt)}. Injury feed checked: {evidence.snapshot.injurySyncAt ? dateText(evidence.snapshot.injurySyncAt) : 'Unverified'}.</p>
                    {!evidence.snapshot.lineupCertified && <p className="pr-warn mt-2 text-xs">The saved starting slots need commissioner verification.</p>}
                    <ul className="mt-3">
                      {evidence.snapshot.players.map((player) => <li key={player.playerId} className="py-2 text-xs leading-5" style={{ borderTop: '1px solid var(--pr-line)' }}>
                        <span className="pr-text font-semibold">{player.playerName}</span><span className="pr-accent ml-2">{player.slotType}</span>
                        <p className="pr-muted">{player.availabilityKnown ? player.hasGameOnScoringDay === false ? 'No game on this scoring day' : player.injuryStatus || 'No reported restriction' : 'Availability unverified'} · {dateText(player.kickoffAt)}</p>
                        {player.slotType === 'WAIVER' && <p className="pr-accent">{player.waiverVerified
                          ? player.jointPlanOnly ? 'Available only as part of the verified move plan below.' : player.dropPlayerName ? `Verified option before lock: add this player and drop ${player.dropPlayerName}.` : 'Verified immediate pickup before this lock; no drop required.'
                          : 'Pickup availability needs verification for this lock.'}</p>}
                      </li>)}
                    </ul>
                    {evidence.snapshot.movePlans?.map((plan, i) => <div key={i} className="pr-well mt-3 rounded-lg p-3">
                      <p className="pr-accent text-xs font-bold">Verified move plan · {dateText(plan.checkedAt)}</p>
                      <ol className="pr-text2 mt-2 list-decimal space-y-2 pl-5 text-xs leading-5">
                        {plan.steps.map((step, j) => <li key={j}>{step.kind === 'activate' ? `Activate ${step.playerName} from ${step.fromSlot}.`
                          : `Add ${step.playerName}${step.dropPlayerName ? ` and drop ${step.dropPlayerName}` : ''}.`}</li>)}
                        <li>Save the complete active starting lineup.</li>
                      </ol>
                    </div>)}
                    <p className="pr-muted mt-2 text-xs leading-5">Recorded move options passed the league’s checks before lock. Evidence collection does not move players. Unverified cases keep protections for commissioner review.</p>
                  </details>}
                  {LIVE.includes(claim.status) && (
                    <div className="pr-well mt-3 rounded-xl p-3">
                      <p className="pr-text text-xs font-bold">Was the losing lineup legal?</p>
                      <p className="pr-muted mt-1 text-xs leading-5">Judge only what was true before the lineup lock. If {nameOf(loser)} couldn’t fill every starting spot with active players or free agents, keep its locks. When in doubt, keep them.</p>
                      <textarea aria-label="Lock-time lineup and replacement evidence" maxLength={1000} placeholder="Which spot was empty, and which replacement was available before lock (or why none was)?" value={lineupReason[claim.id] ?? ''} onChange={(e) => setLineupReason({ ...lineupReason, [claim.id]: e.target.value })} className="pr-field mt-2 min-h-[80px] w-full rounded-lg px-3 py-2 text-sm" />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button disabled={busy || (lineupReason[claim.id] ?? '').trim().length < 10} onClick={() => mutate(commissionerUrl(claim.id), { action: 'lineup_ruling', decision: 'excused', reason: lineupReason[claim.id] })} className="pr-btn-good min-h-[44px] rounded-lg px-3 text-xs font-bold disabled:opacity-45">Keep protections</button>
                        <button disabled={busy || (lineupReason[claim.id] ?? '').trim().length < 10} onClick={() => mutate(commissionerUrl(claim.id), { action: 'lineup_ruling', decision: 'forfeit', reason: lineupReason[claim.id] })} className="pr-btn-bad min-h-[44px] rounded-lg px-3 text-xs font-bold disabled:opacity-45">Forfeit protections</button>
                      </div>
                    </div>
                  )}
                  {['awaiting_selection', 'selection_expired'].includes(claim.status) && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                      <select aria-label="Commissioner player selection" value={chosen[claim.id] ?? ''} onChange={(e) => setChosen({ ...chosen, [claim.id]: e.target.value })} className="pr-field min-h-[44px] rounded-lg px-3 text-sm">
                        <option value="">Pick for the winner</option>
                        {claimable.map((player) => <option key={player.id} value={player.playerId}>{player.playerName} · {player.position}</option>)}
                      </select>
                      <button disabled={busy || !chosen[claim.id]} onClick={() => mutate(commissionerUrl(claim.id), { action: 'select', playerId: chosen[claim.id] })} className="pr-btn min-h-[44px] rounded-lg px-4 text-xs font-bold disabled:opacity-45">Start response window</button>
                    </div>
                  )}
                  {overdue && (
                    <button disabled={busy} onClick={() => mutate(commissionerUrl(claim.id), { action: 'retry' }, true)} className="pr-btn mt-2 min-h-[44px] rounded-lg px-4 text-xs font-bold disabled:opacity-45">Retry overdue transfer</button>
                  )}
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <input aria-label="Reason for voiding claim" maxLength={500} placeholder="Reason to cancel this claim" value={reviewReason[claim.id] ?? ''} onChange={(e) => setReviewReason({ ...reviewReason, [claim.id]: e.target.value })} className="pr-field min-h-[44px] rounded-lg px-3 text-sm" />
                    <button disabled={busy || (reviewReason[claim.id] ?? '').trim().length < 5} onClick={() => mutate(commissionerUrl(claim.id), { action: 'void', reason: reviewReason[claim.id] })} className="pr-btn-bad min-h-[44px] rounded-lg px-4 text-xs font-bold disabled:opacity-45">Void claim</button>
                  </div>
                </details>
              )}
            </div>
          )
        })}
        {!activeClaims.length && <p className="pr-muted rounded-xl px-4 py-6 text-center text-sm" style={{ border: '1px dashed var(--pr-line2)' }}>No open claims. A claim appears here when a matchup ends.</p>}
      </div>
    </section>
  ) : null

  return (
    <div className="pr mx-auto w-full max-w-6xl pb-20">
      {/* One headline: the page header already names the league, so the banner says only what this screen is. */}
      <div className="pr-banner relative isolate overflow-hidden rounded-[24px]">
        <div className="relative flex min-h-[150px] flex-col justify-end gap-2 p-5 sm:min-h-[190px] sm:p-8">
          <p className="pr-banner-gold inline-flex items-center gap-2 text-xs font-bold"><Anchor size={14} aria-hidden /> Pirate League{data ? ` · Week ${data.week}` : ''}</p>
          <p className="pr-on-art max-w-xl text-sm leading-6 sm:text-base">Lock your best players before the first game. Win your matchup, then take one unlocked player from the team you beat.</p>
        </div>
      </div>

      {loading && <p className="pr-card pr-text2 mt-6 rounded-2xl p-6 text-sm">Loading the Pirate Deck…</p>}
      {error && <p role="alert" className="pr-alert mt-5 rounded-xl px-4 py-3 text-sm">{error}</p>}
      {message && <p role="status" className="pr-ok mt-5 rounded-xl px-4 py-3 text-sm">{message}</p>}
      {data && (
        <>
          {myRoster && data.league.rosterLimit > 0 && rosterOverflow > 0 && (
            <p role="status" className="pr-note mt-5 rounded-xl px-4 py-3 text-sm leading-6">
              Your crew has {myRoster.players.length} players in a {data.league.rosterLimit}-player roster after a steal. Free {rosterOverflow} {rosterOverflow === 1 ? 'spot' : 'spots'} before another acquisition{overflowGraceUntil ? ` and by ${dateText(overflowGraceUntil)}` : ''}. No player will be dropped automatically.
            </p>
          )}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Stat icon={<Shield size={18} />} label="Locked" value={`${selected.length} of ${data.rules.protectionLimit}`} detail={mySet?.status === 'void' ? 'Cancelled this week' : data.canEditProtections ? 'You can change these until games start' : 'Set for this week'} />
            <Stat icon={<Clock3 size={18} />} label="Locks close" value={dateText(data.lockAt)} detail={data.lockAt ? 'When the first game starts' : 'Waiting for the schedule'} />
            <Stat icon={<Trophy size={18} />} label="Open claims" value={String(activeClaims.length)} detail={`${data.rules.claimHours} hours to answer a claim`} />
          </div>

          <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,.88fr)]">
            {needsMe ? [claimBoard, protectionDeck] : [protectionDeck, claimBoard]}
          </div>

          {settledClaims.length > 0 && (
            <section data-testid="pirate-plunder" className="pr-card mt-6 rounded-[20px] p-5 sm:p-6">
              <div className="flex items-center gap-2"><Sparkles size={19} className="pr-gold" aria-hidden /><h3 className="pr-text text-xl font-black">Recent plunder</h3></div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {settledClaims.slice(0, 6).map((claim) => (
                  <div key={claim.id} className="pr-note rounded-xl p-4">
                    <p className="pr-gold text-xs font-bold">Week {claim.week}</p>
                    <p className="pr-text mt-1 text-sm font-semibold">{nameOf(byId.get(claim.winnerRosterId))} took {playerName(rosters, claim.playerId)} from {nameOf(byId.get(claim.loserRosterId))}</p>
                    {isCommissioner && claim.scoreCorrectionNeedsReversal && <div className="mt-3 space-y-2">
                      <p className="pr-bad text-xs font-semibold">The final score changed. Reverse this steal after checking both rosters.</p>
                      <input aria-label="Score correction reversal reason" maxLength={500} placeholder="Reason for reversal" value={reviewReason[claim.id] ?? ''} onChange={(e) => setReviewReason({ ...reviewReason, [claim.id]: e.target.value })} className="pr-field min-h-[44px] w-full rounded-lg px-3 text-sm" />
                      <button disabled={busy || (reviewReason[claim.id] ?? '').trim().length < 5} onClick={() => mutate(commissionerUrl(claim.id), { action: 'reverse', reason: reviewReason[claim.id] })} className="pr-btn-bad min-h-[44px] rounded-lg px-4 text-xs font-bold disabled:opacity-45">Reverse audited steal</button>
                    </div>}
                    <button onClick={() => {
                      setCelebration({ winner: nameOf(byId.get(claim.winnerRosterId)), loser: nameOf(byId.get(claim.loserRosterId)) })
                      setShowVideo(true)
                    }} className="pr-accent mt-3 min-h-[40px] text-xs font-bold underline underline-offset-4">Replay the steal</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {isCommissioner && (
            <section className="pr-card mt-6 rounded-[20px] p-5 sm:p-6">
              <h3 className="pr-text text-lg font-black">Commissioner</h3>
              <p className="pr-muted mt-1 text-sm">
                {data.rules.protectionLimit} locks per team · {data.rules.selectionHours} hours to pick · {data.rules.claimHours} hours to answer · steals {data.rules.playoffClaims ? 'continue' : 'stop'} in the playoffs.
              </p>
              {/* The one editor is Settings → Pirate rules (it had a second, differently-labelled copy here). */}
              <Link href={`/league/${encodeURIComponent(leagueId)}?tab=settings`} className="pr-link mt-3 inline-flex min-h-[40px] items-center text-sm">Change Pirate rules in League settings</Link>
              {voidedClaims.length > 0 && (
                <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--pr-line)' }}>
                  <p className="pr-muted text-xs font-bold">Cancelled claims</p>
                  {voidedClaims.slice(0, 5).map((claim) => <p key={claim.id} className="pr-text2 mt-2 text-xs">Week {claim.week}: {claim.resolutionNote || 'No reason recorded'}</p>)}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {showVideo && (
        <div role="dialog" aria-modal="true" aria-label="Pirate claim celebration" className="fixed inset-0 z-[120] flex items-center justify-center p-4 backdrop-blur-md" style={{ background: 'var(--pr-scrim)' }}>
          <div className="pr-banner relative w-full max-w-4xl overflow-hidden rounded-3xl">
            <video autoPlay muted playsInline poster="/images/league-types/pirate-hero.png" onEnded={() => setShowVideo(false)} className="aspect-video w-full object-cover">
              <source src="/media/league-intros/pirate-claim.mp4" type="video/mp4" />
            </video>
            <div className="absolute inset-x-0 bottom-0 px-6 pb-6 pt-12" style={{ background: 'linear-gradient(to top, var(--pr-scrim), transparent)' }}>
              <p className="pr-banner-gold text-xs font-bold">The booty changes hands</p>
              <p className="pr-on-art mt-1 text-2xl font-black sm:text-4xl">{celebration ? `${celebration.winner} claimed from ${celebration.loser}.` : 'A new player joins the crew.'}</p>
            </div>
            <button aria-label="Close celebration" onClick={() => setShowVideo(false)} className="pr-on-art absolute right-3 top-3 flex size-11 items-center justify-center rounded-full" style={{ background: 'var(--pr-scrim)' }}><X size={20} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="pr-card rounded-2xl px-4 py-4">
      <div className="pr-gold flex items-center gap-2">{icon}<span className="text-xs font-bold">{label}</span></div>
      <p className="pr-text mt-2 text-lg font-black">{value}</p>
      <p className="pr-muted mt-1 text-xs">{detail}</p>
    </div>
  )
}
