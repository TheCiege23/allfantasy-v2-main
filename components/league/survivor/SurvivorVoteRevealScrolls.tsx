'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './SurvivorVoteRevealScrolls.module.css'

export type RevealScroll = {
  order: number
  /** Ignored by the scroll; kept optional so older payloads still type-check. Never rendered. */
  targetUserId?: string | null
  targetName: string | null
  status: 'counts' | 'late_does_not_count' | 'forfeited_by_shot' | 'blocked_by_idol' | 'blocked_by_shot' | 'target_safe' | 'taken_by_vote_steal'
  /** Second ballot from a double/extra vote — shown as its own slip. */
  isExtraVote: boolean
}

export const REVEAL_READ_MS = 2500

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth',
  'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth']

/** "First vote", "Second vote", … "Last vote". */
export function voteOrdinal(index: number, total: number): string {
  if (total === 1) return 'Only vote'
  if (total > 1 && index === total - 1) return 'Last vote'
  return ORDINALS[index] ? `${ORDINALS[index]} vote` : `Vote ${index + 1}`
}

/** Handwritten tally marks, in groups of five; a dash for none. */
export function tallyMarks(n: number): string {
  if (n <= 0) return '–'
  const groups: string[] = []
  for (let left = n; left > 0; left -= 5) groups.push('|'.repeat(Math.min(5, left)))
  return groups.join(' ')
}

/** Stable "hand-written" wobble of about ±1.5°, so a slip does not jump between renders. */
function handRotation(index: number, name: string): number {
  let h = index * 131
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 9973
  return Math.round(((h % 31) / 10 - 1.5) * 10) / 10
}

function stampFor(status: RevealScroll['status']): string {
  switch (status) {
    case 'blocked_by_idol': return 'Does not count'
    case 'taken_by_vote_steal': return 'Taken · Does not count'
    case 'blocked_by_shot': return 'Shot in the Dark · Does not count'
    case 'forfeited_by_shot': return 'Forfeited · Does not count'
    case 'late_does_not_count': return 'Late · Does not count'
    case 'target_safe': return 'Safe · Does not count'
    default: return ''
  }
}

export interface TallyRow { name: string; count: number }

/** Live tally of the slips read so far: every name read, cancelled names at 0, in reading order. */
export function tallyOf(read: RevealScroll[]): TallyRow[] {
  const rows = new Map<string, number>()
  for (const vote of read) {
    if (!vote.targetName) continue
    rows.set(vote.targetName, (rows.get(vote.targetName) ?? 0) + (vote.status === 'counts' ? 1 : 0))
  }
  return [...rows].map(([name, count]) => ({ name, count }))
}

type Phase = 'sealed' | 'open'

/**
 * The Tribal Council results scroll. Callers pass only what the server has released (see
 * lib/survivor/survivorRevealGate.ts): `scrolls` are the steps out so far, and the verdict props are
 * null until the last step is out. Ballots are anonymous — the scroll never shows a voter.
 */
export function SurvivorVoteRevealScrolls({
  scrolls, totalSteps, eliminatedName, isTie, tiePhase,
  revealMode = 'one_at_a_time', nextStepAt = null, onRequestMore,
  autoPlay = true, isPublished = true, exileEnabled = false, exileStartingTokens = 0,
  week = null, tribeName = null,
}: {
  scrolls: RevealScroll[]
  /** Ballots in the full read (server). Defaults to the steps received. */
  totalSteps?: number | null
  eliminatedName: string | null
  isTie: boolean
  tiePhase: string | null
  revealMode?: 'one_at_a_time' | 'all_at_once'
  /** When the server releases its next step; the scroll asks for more then. */
  nextStepAt?: string | null
  /** Refetch the council; called while the reader is waiting on the server. */
  onRequestMore?: () => void
  /** false opens straight to the full read (host previews). */
  autoPlay?: boolean
  isPublished?: boolean
  exileEnabled?: boolean
  exileStartingTokens?: number
  week?: number | null
  tribeName?: string | null
}) {
  const total = Math.max(totalSteps ?? scrolls.length, scrolls.length)
  const [phase, setPhase] = useState<Phase>(autoPlay ? 'sealed' : 'open')
  const [shown, setShown] = useState(autoPlay ? 0 : scrolls.length)
  const actionRef = useRef<HTMLButtonElement>(null)
  const available = scrolls.length
  const reading = phase === 'open'
  const allRead = reading && shown >= total && available >= total
  const waitingOnServer = reading && revealMode === 'one_at_a_time' && shown >= available && available < total

  // Publishing an unpublished preview starts over at the seal. (Callers key the scroll by council id.)
  useEffect(() => { setPhase(autoPlay ? 'sealed' : 'open'); setShown(autoPlay ? 0 : scrolls.length) }, [autoPlay]) // eslint-disable-line react-hooks/exhaustive-deps

  // All at once: the whole released tally appears as soon as the scroll is open.
  useEffect(() => {
    if (reading && (revealMode === 'all_at_once' || !autoPlay)) setShown(available)
  }, [reading, revealMode, autoPlay, available])

  // One at a time: read the next released slip every 2.5s (a tap reads it sooner).
  useEffect(() => {
    if (!reading || revealMode !== 'one_at_a_time' || shown >= available) return
    const timer = window.setTimeout(() => setShown(n => Math.min(n + 1, available)), shown === 0 ? 1600 : REVEAL_READ_MS)
    return () => window.clearTimeout(timer)
  }, [reading, revealMode, shown, available])

  // Waiting on a step the server has not released yet: ask again when it is due.
  useEffect(() => {
    if (!waitingOnServer || !onRequestMore) return
    const due = nextStepAt ? new Date(nextStepAt).getTime() - Date.now() : REVEAL_READ_MS
    const timer = window.setTimeout(onRequestMore, Math.min(REVEAL_READ_MS * 2, Math.max(400, Number.isFinite(due) ? due + 150 : REVEAL_READ_MS)))
    return () => window.clearTimeout(timer)
  }, [waitingOnServer, onRequestMore, nextStepAt, available])

  const read = scrolls.slice(0, shown)
  const tally = useMemo(() => tallyOf(read), [read]) // eslint-disable-line react-hooks/exhaustive-deps
  const idolPlayer = read.find(vote => vote.status === 'blocked_by_idol')?.targetName ?? null

  const breakSeal = () => { setPhase('open'); setShown(revealMode === 'all_at_once' ? available : 0) }
  const readNext = () => setShown(n => Math.min(n + 1, available))
  const replay = () => { setShown(0); setPhase('sealed'); window.setTimeout(() => actionRef.current?.focus(), 0) }

  const nextLabel = waitingOnServer ? 'Waiting for the next vote…' : shown === 0 ? 'Read the first vote' : shown === total - 1 ? 'Read the last vote' : 'Read the next vote'
  const subtitle = [week != null ? `Week ${week}` : null, tribeName ? `Tribe ${tribeName.replace(/^tribe\s+/i, '')}` : null].filter(Boolean).join(' · ')

  const verdict = (() => {
    if (!allRead) return null
    if (isTie) {
      return <div className={styles.verdict}>
        <span className={styles.verdictStamp}>Tied</span>
        <p className={styles.note}>{tiePhase === 'commissioner_tiebreak_required' ? 'The vote is still tied. An independent commissioner decides.' : 'The vote is tied. Nobody leaves yet — a revote decides.'}</p>
      </div>
    }
    if (!eliminatedName) return total === 0 || isPublished ? <div className={styles.verdict}><p className={styles.note}>No manager was voted out.</p></div> : null
    const theirs = tally.find(row => row.name === eliminatedName)?.count ?? 0
    const nextBest = tally.filter(row => row.name !== eliminatedName).reduce((max, row) => Math.max(max, row.count), 0)
    return <div className={styles.verdict}>
      <span className={styles.verdictStamp}>Voted out</span>
      <span className={styles.out}>{eliminatedName}</span>
      <span className={styles.margin}>{theirs} {theirs === 1 ? 'vote' : 'votes'} to {nextBest}</span>
      {tiePhase === 'season_points_decided' && <span className={styles.margin}>Tie broken on season points</span>}
      {tiePhase === 'stones_decided' && <span className={styles.margin}>Tie broken by the stones</span>}
      {exileEnabled && <span className={styles.exile}>
        <img src="/survivor/exile/token-icon.svg" alt="" width={20} height={20} />
        Heads to Exile Island with {exileStartingTokens} {exileStartingTokens === 1 ? 'token' : 'tokens'}
      </span>}
    </div>
  })()

  return <section className={styles.root} aria-label="Tribal Council results">
    {phase === 'sealed' ? <div className={styles.sealed}>
      <img src="/survivor/exile/scroll-sealed.svg" alt="Sealed Tribal Council scroll" width={420} height={240} className={styles.sealedImg} />
      <span className={styles.sealedLabel}>The votes are in</span>
      <span className={styles.sealedNote}>Break the seal to read the votes{revealMode === 'one_at_a_time' ? ', one at a time' : ''}.</span>
    </div> : <div className={styles.sc}>
      <img className={styles.roll} src="/survivor/exile/scroll-roller.svg" alt="" width={640} height={44} />
      <div className={styles.body}>
        <div className={styles.paper}>
          <div className={`${styles.curl} ${styles.curlTop}`} />
          <div className={styles.head}>
            {subtitle && <span className={styles.sub}>{subtitle}</span>}
            <h2 className={styles.title}>Tribal Council</h2>
            <div className={`${styles.rule} ${styles.ruleShort}`} aria-hidden="true"><span>✦</span></div>
          </div>

          <ol className={styles.slips} aria-live="polite" aria-label="Votes read">
            {read.map((vote, i) => {
              const name = vote.targetName ?? 'No eligible target'
              const stamp = stampFor(vote.status)
              return <li key={`${vote.order}-${i}`} style={{ listStyle: 'none', transform: `rotate(${handRotation(i, name)}deg)` }}>
                <div className={`${styles.slip} ${stamp ? styles.void : ''}`}>
                  <span className={styles.ord}>{voteOrdinal(i, total)}{vote.isExtraVote && <span className={styles.extra}>Double vote</span>}</span>
                  <span className={styles.hand} style={{ fontSize: `${29 + ((i * 7 + name.length) % 5)}px` }}>{name}</span>
                  {stamp && <span className={styles.stamp}>{stamp}</span>}
                </div>
              </li>
            })}
            {shown === 0 && <li style={{ listStyle: 'none' }} className={styles.waiting}>I&apos;ll read the votes…</li>}
          </ol>

          {idolPlayer && <p className={styles.idol}>Immunity idol played by {idolPlayer}</p>}

          {tally.length > 0 && <>
            <div className={styles.rule}><span>Tally</span></div>
            <div className={styles.tally}>
              {tally.map(row => <div key={row.name} className={styles.tallyRow}>
                <span className={styles.tallyName}>{row.name}</span>
                <span className={styles.marks} aria-hidden="true">{tallyMarks(row.count)}</span>
                <span className={styles.tallyCount} aria-label={`${row.count} ${row.count === 1 ? 'vote' : 'votes'}`}>{row.count}</span>
              </div>)}
            </div>
          </>}

          {verdict}
          <div className={styles.seal}><img src="/survivor/exile/wax-seal-broken.svg" alt="Broken wax seal" width={64} height={78} /></div>
          <div className={`${styles.curl} ${styles.curlBottom}`} />
        </div>
      </div>
      <img className={styles.roll} src="/survivor/exile/scroll-roller.svg" alt="" width={640} height={44} />
    </div>}

    <div className={styles.actions}>
      {phase === 'sealed' && <button ref={actionRef} type="button" className={`${styles.btn} ${styles.btnGold}`} onClick={breakSeal}>Break the seal</button>}
      {reading && !allRead && revealMode === 'one_at_a_time' && <button type="button" className={`${styles.btn} ${styles.btnGold}`} onClick={readNext} disabled={shown >= available}>{nextLabel}</button>}
      {reading && <button type="button" className={styles.btn} onClick={replay}>Replay</button>}
    </div>
  </section>
}
export default SurvivorVoteRevealScrolls
