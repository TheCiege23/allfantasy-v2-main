'use client'

import { useState } from 'react'
import { SurvivorIdolPlay } from '@/components/survivor/SurvivorIdolPlay'
import { idolDefinition } from '@/lib/survivor/survivorIdolCatalog'
import { SurvivorVoteWindowCard } from './SurvivorVoteWindowCard'
import { type PlayableIdol } from './SurvivorIdolPlayPanel'
import { SurvivorVoteRevealScrolls, type RevealScroll } from './SurvivorVoteRevealScrolls'

export type TribalCouncilView = {
  active: boolean
  councilId: string | null
  status: string | null
  phase: string | null
  week: number | null
  attendingTribeId: string | null
  votingDeadline: string | null
  isRevealed: boolean
  you: {
    isEligibleVoter: boolean
    hasVoted: boolean
    yourVoteTargetUserId: string | null
    yourVoteTargetName: string | null
    voteLocked: boolean
    voteLate: boolean
    voteDoesNotCount: boolean
    eligibleTargets: Array<{ userId: string; displayName: string }>
    playableIdols: PlayableIdol[]
    additionalVotes?: Array<{ idolId: string; targetName: string | null; locked: boolean }>
    isSafeFromVote: boolean
  }
  host: { eligibleVoterCount: number; submittedCount: number; missingVoteCount: number } | null
  reveal: { revealSequence: RevealScroll[]; countsByTargetName: Record<string, number>; eliminatedName: string | null; isTie: boolean; tiePhase: string | null } | null
}

type Access = {
  canPerformAdminAction?: boolean
  isCommissionerParticipating?: boolean
  isParticipant?: boolean
}

/**
 * Survivor Elimination Council — vote window, private ballot, idol plays, TV-style reveal, and
 * commissioner open/close/tally/reveal/resolve controls. Every active button calls a real route;
 * unsupported powers are disabled with truthful copy. Mobile-safe (single column).
 */
export function SurvivorTribalCouncilPanel({
  leagueId,
  council,
  access,
  tribes,
  onRefresh,
}: {
  leagueId: string
  council: TribalCouncilView
  access: Access
  tribes: Array<{ id: string; name: string }>
  onRefresh: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [voteTarget, setVoteTarget] = useState('')
  const [additionalTarget, setAdditionalTarget] = useState('')
  const [selectedIdol, setSelectedIdol] = useState<PlayableIdol | null>(null)
  const [attendingTribeId, setAttendingTribeId] = useState('')

  const windowOpen = council.status === 'voting_open' && !council.isRevealed

  async function post(action: string, body: Record<string, unknown> = {}) {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/survivor/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? json.code ?? `${action} failed`)
      setNote(json.message ?? `${action}: ok`)
      onRefresh()
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }


  return (
    <section className="space-y-3 border-t border-neutral-800 pt-4">
      <h3 className="text-sm font-semibold text-white">Elimination Council</h3>

      {access.isCommissionerParticipating ? (
        <div className="rounded border border-amber-500/30 bg-amber-950/30 p-2 text-[11px] text-amber-100">
          You are a playing commissioner — you cannot see other players&apos; private votes or the tally before the reveal.
        </div>
      ) : null}

      {!council.active || !council.councilId ? (
        <p className="text-xs text-neutral-400">No Elimination Council is currently open.</p>
      ) : (
        <>
          <SurvivorVoteWindowCard
            status={council.status}
            phase={council.phase}
            week={council.week}
            votingDeadline={council.votingDeadline}
            isRevealed={council.isRevealed}
          />

          {council.you.isSafeFromVote ? (
            <div className="rounded border border-emerald-600/40 bg-emerald-950/30 p-2 text-[11px] text-emerald-200">
              You played Council Pass — you are safe from being voted out at this council.
            </div>
          ) : null}

          {/* Private vote form */}
          {council.you.isEligibleVoter && !council.isRevealed ? (
            <div className="space-y-2 rounded border border-neutral-800 bg-neutral-950 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">Your private vote</div>
              {council.you.hasVoted ? (
                <div className="text-xs text-neutral-300">
                  You voted: <span className="font-semibold text-white">{council.you.yourVoteTargetName ?? '—'}</span>
                  {council.you.voteDoesNotCount ? ' · Does Not Count (late)' : council.you.voteLocked ? ' · Locked' : ''}
                </div>
              ) : null}
              {windowOpen && (!council.you.voteLocked || council.you.voteDoesNotCount) ? (
                <div className="flex flex-wrap gap-2">
                  <select
                    value={voteTarget}
                    onChange={(e) => setVoteTarget(e.target.value)}
                    className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-2 text-sm"
                  >
                    <option value="">Choose who to vote out…</option>
                    {council.you.eligibleTargets.map((t) => (
                      <option key={t.userId} value={t.userId}>
                        {t.displayName}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy || !voteTarget}
                    onClick={() => post('submit-vote', { message: `@Chimmy vote <@${voteTarget}>` })}
                    className="rounded bg-orange-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {council.you.hasVoted ? 'Send changed vote to @Chimmy' : 'Send vote to @Chimmy'}
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-neutral-500">
                  {council.isRevealed ? 'Votes are revealed.' : windowOpen ? 'Your vote is locked.' : 'The vote window is closed.'}
                </p>
              )}
            </div>
          ) : null}

          {(council.you.additionalVotes ?? []).map(ballot => <div key={ballot.idolId} className="rounded border border-amber-700/40 p-3 text-sm">
            <p>Your additional private vote: {ballot.targetName ?? 'Not cast yet'}{ballot.locked ? ' - Locked' : ''}</p>
            {windowOpen && !ballot.locked && <><label htmlFor={`additional-${ballot.idolId}`}>Choose your additional vote target</label><select id={`additional-${ballot.idolId}`} value={additionalTarget} onChange={event => setAdditionalTarget(event.target.value)} className="m-2 rounded bg-neutral-900 p-2"><option value="">Choose a manager</option>{council.you.eligibleTargets.map(target => <option key={target.userId} value={target.userId}>{target.displayName}</option>)}</select><button type="button" disabled={busy || !additionalTarget} onClick={() => post('submit-vote', { message: `@Chimmy extra vote <@${additionalTarget}>` })} className="rounded bg-orange-600 p-2 disabled:opacity-50">Send additional vote to @Chimmy</button></>}
          </div>)}
          <nav aria-label="Your held council idols" className="flex flex-wrap gap-2">{council.you.playableIdols.filter(idol => !idol.alreadyPlayed).map(idol => <button key={idol.idolId} type="button" aria-pressed={selectedIdol?.idolId === idol.idolId} onClick={() => setSelectedIdol(idol)} className="rounded border border-amber-400/50 p-2 text-sm">{idolDefinition(idol.powerType).name}</button>)}</nav>
          {selectedIdol && <SurvivorIdolPlay key={selectedIdol.idolId} leagueId={leagueId} idolId={selectedIdol.idolId} powerType={selectedIdol.powerType} onFinished={onRefresh} />}

          {/* Host operational missing-vote count */}
          {council.host ? (
            <div className="rounded border border-neutral-800 bg-neutral-950 p-2 text-[11px] text-neutral-400">
              Operational: {council.host.submittedCount}/{council.host.eligibleVoterCount} ballots in ·{' '}
              {council.host.missingVoteCount} missing. (Ballot contents stay private until reveal.)
            </div>
          ) : null}

          {!council.isRevealed && council.status !== 'voting_open' && <div className="text-center"><img src="/survivor/exile/scroll-sealed.svg" alt="Results sealed until the Torch Ceremony" width={180} height={120} className="mx-auto" /><p className="text-xs text-neutral-400">Results remain sealed until the Torch Ceremony is published.</p></div>}
          {/* Reveal */}
          {council.reveal ? (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">The votes</div>
              <SurvivorVoteRevealScrolls
                scrolls={council.reveal.revealSequence}
                eliminatedName={council.reveal.eliminatedName}
                isTie={council.reveal.isTie}
                tiePhase={council.reveal.tiePhase}
                autoPlay={council.isRevealed}
                isPublished={council.isRevealed}
              />
            </div>
          ) : null}
        </>
      )}

      {/* Commissioner / host controls */}
      {access.canPerformAdminAction && !access.isCommissionerParticipating ? (
        <div className="space-y-2 rounded border border-neutral-800 bg-neutral-950 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">Commissioner controls</div>
          {!council.active || !council.councilId ? (
            <div className="flex flex-wrap gap-2">
              <select value={attendingTribeId} onChange={(e) => setAttendingTribeId(e.target.value)} className="rounded border border-neutral-700 bg-neutral-900 px-2 py-2 text-sm">
                <option value="">Pre-merge: attending tribe…</option>
                {tribes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button type="button" disabled={busy} onClick={() => post('open-tribal', attendingTribeId ? { attendingTribeId } : {})} className="rounded bg-orange-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                Open Elimination Council
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || council.status !== 'voting_open'} onClick={() => post('close-vote-window')} className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 disabled:opacity-50">
                Close window
              </button>
              <button type="button" disabled={busy || council.status === 'voting_open' || council.isRevealed} onClick={() => post('tally-votes')} className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 disabled:opacity-50">
                Tally
              </button>
              <button type="button" disabled={busy || council.isRevealed || council.status === 'voting_open'} onClick={() => post('reveal-votes')} className="rounded bg-orange-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                Reveal
              </button>
              <button type="button" disabled={busy || !council.isRevealed} onClick={() => post('resolve-elimination')} className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 disabled:opacity-50">
                Resolve elimination
              </button>
              <button type="button" disabled={busy || council.isRevealed} onClick={() => post('cancel-tribal')} className="rounded border border-red-800/50 bg-red-950/30 px-3 py-2 text-sm text-red-200 disabled:opacity-50">
                Cancel
              </button>
            </div>
          )}
        </div>
      ) : null}

      {note ? <p className="text-xs text-neutral-400">{note}</p> : null}
    </section>
  )
}

export default SurvivorTribalCouncilPanel
