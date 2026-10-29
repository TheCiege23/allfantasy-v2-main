'use client'

import { useState } from 'react'
import {
  SpecialtyCard,
  SpecialtyReplayButton,
  SpecialtyTag,
  spStyles,
  specialtyAvatarColor,
  specialtyInitials,
} from '@/components/league/specialty/SpecialtyShell'
import type { ZombieBoardEntry, ZombieSummary } from '@/components/zombie/types'
import { zombieChipStatus } from '@/components/zombie/ZombieStatusChip'
import { infectionHeadline } from '@/lib/zombie/zombieHomeView'
import z from './zombie-specialty.module.css'

/*
 * Infection night (handoff zombie/ZombieInfection, the signature moment): your result for the selected
 * week and the infection log. A turned result runs the 0.9s green hue turn; Replay re-runs it for QA, and
 * reduced motion shows the end state at once.
 *
 * What it does NOT offer, on purpose: the handoff's "Use my serum / Keep it, turn" choice. The engine
 * spends serums before lineup lock (a shield) or in sets to revive a Zombie — there is no serum decision
 * at the infection run, so a button here would promise a rule that does not exist.
 */

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : (Math.round(n * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function ZombieInfectionNight({ summary, onBack }: { summary: ZombieSummary; onBack: () => void }) {
  const [run, setRun] = useState(0)
  const names = summary.rosterDisplayNames ?? {}
  const nameOf = (id: string | null | undefined) => (id ? names[id] ?? 'A team' : 'Someone you cannot see')
  const revived = new Set(summary.revivedRosterIds ?? [])
  const myChip = summary.myRosterId && summary.myStatus ? zombieChipStatus(summary.myStatus, revived.has(summary.myRosterId)) : null
  const moment = summary.turnMoment && summary.turnMoment.week === summary.week ? summary.turnMoment : null
  const m = summary.myMatchup
  const myScore = moment?.myScore ?? m?.myScore ?? null
  const oppScore = moment?.opponentScore ?? m?.opponentScore ?? null
  const won = myScore != null && oppScore != null ? myScore > oppScore : null
  const head = infectionHeadline({ momentKind: moment?.kind ?? null, myStatus: myChip, won })
  const final = m?.final ?? moment != null
  const board = summary.weeklyBoard ?? []
  const infections = board.filter((e): e is Extract<ZombieBoardEntry, { kind: 'infection' }> => e.kind === 'infection')
  const blowouts = board.filter((e): e is Extract<ZombieBoardEntry, { kind: 'bashing' | 'mauling' }> => e.kind !== 'infection')
  const zombiesTotal = summary.statuses.filter((s) => zombieChipStatus(s.status) === 'zombie').length
  const opponentName = moment?.opponentName ?? m?.opponentName ?? null
  const myName = summary.myRosterId ? names[summary.myRosterId] ?? 'You' : 'You'
  const ring = head.tone === 'turned' ? '#ff7a5c' : head.tone === 'revived' ? '#ffd66b' : head.tone === 'feeding' ? '#8be03a' : '#4a6fb0'

  const line =
    !final
      ? "Results aren't final yet. Infections run once the week's games and stat corrections are done."
      : head.tone === 'turned'
        ? `${opponentName ?? 'Your opponent'} beat you${myScore != null && oppScore != null ? ` by ${fmt(oppScore - myScore)}` : ''}. You're a Zombie now — beat a Survivor and they turn too.`
        : head.tone === 'revived'
          ? 'Your serums worked. You play on as a Survivor.'
          : head.tone === 'feeding'
            ? won
              ? 'You won. Any Survivor you beat turns.'
              : 'You lost this one. The horde plays on.'
            : won === false
              ? 'You lost, but not to the horde — no infection.'
              : 'You held them off.'

  return (
    <div className={spStyles.page} style={{ padding: 0 }} data-testid="zombie-infection-night">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button type="button" className={spStyles.btn} onClick={onBack} aria-label="Back to the Zombie home" style={{ width: 44, padding: 0 }}>
          ‹
        </button>
        <div style={{ minWidth: 0 }}>
          <h2 className={spStyles.h1}>Infection night · week {summary.week}</h2>
          <p className={spStyles.t2} style={{ margin: 0 }}>
            {summary.league?.name ?? 'Your league'} · {final ? 'results are final' : 'not final yet'}
          </p>
        </div>
      </div>

      <div className={z.night}>
        <section className={z.result} aria-live="polite">
          <span className={spStyles.lbl} style={{ color: 'var(--acc2)' }}>
            Your result
          </span>
          {myScore != null && oppScore != null ? (
            <div className={z.scores}>
              <b className={won ? z.win : undefined}>{fmt(myScore)}</b>
              <span>to</span>
              <b className={won === false ? z.win : undefined}>{fmt(oppScore)}</b>
            </div>
          ) : null}
          <span
            key={run}
            className={`${z.avatar} ${head.tone === 'turned' ? z.turning : ''}`}
            style={{ ['--ring' as string]: ring }}
            aria-hidden
          >
            {specialtyInitials(myName)}
          </span>
          <p className={`${z.head} ${head.tone === 'turned' ? z.headTurned : head.tone === 'revived' ? z.headRevived : ''}`}>{head.head}</p>
          <p className={spStyles.t2} style={{ margin: 0, maxWidth: 460, fontSize: 15 }}>
            {line}
          </p>
          <div className={spStyles.actions}>
            <SpecialtyReplayButton onReplay={() => setRun((n) => n + 1)} />
          </div>
        </section>

        <div className={z.log}>
          <SpecialtyCard
            label={`Week ${summary.week} infections`}
            icon="/specialty/zombie/icon-infect.svg"
            aside={
              <span className={spStyles.num} style={{ color: 'var(--acc2)', fontSize: 13 }}>
                {infections.length} turned · {zombiesTotal} Zombies total
              </span>
            }
          >
            <ul className={z.logList}>
              {summary.myRosterId && m ? (
                <li className={`${z.logRow} ${z.logRowMine}`}>
                  <span className={spStyles.av} style={{ background: '#22314f' }} aria-hidden>
                    {specialtyInitials(myName)}
                  </span>
                  <strong>You</strong>
                  <SpecialtyTag tone={head.tone === 'turned' ? 'zone' : head.tone === 'feeding' ? 'acc' : 'safe'}>
                    {head.tone === 'turned' ? 'Bitten' : head.tone === 'feeding' ? (myChip === 'whisperer' ? 'Whisperer' : 'Zombie') : head.tone === 'revived' ? 'Revived' : 'Survivor'}
                  </SpecialtyTag>
                  <span className={z.logScore}>
                    {fmt(myScore)} – {fmt(oppScore)}
                  </span>
                  <span className={z.logBy}>vs {opponentName ?? 'your opponent'}</span>
                </li>
              ) : null}
              {infections
                .filter((e) => e.victimRosterId !== summary.myRosterId)
                .map((e) => (
                  <li key={`i-${e.victimRosterId}`} className={z.logRow}>
                    <span className={spStyles.av} style={{ background: specialtyAvatarColor(e.victimRosterId) }} aria-hidden>
                      {specialtyInitials(nameOf(e.victimRosterId))}
                    </span>
                    <strong>{nameOf(e.victimRosterId)}</strong>
                    <SpecialtyTag tone="acc">Zombie</SpecialtyTag>
                    {e.winnerScore != null && e.loserScore != null ? (
                      <span className={z.logScore}>
                        {fmt(e.loserScore)} – {fmt(e.winnerScore)}
                      </span>
                    ) : null}
                    <span className={z.logBy}>{e.infectorRosterId ? `by ${nameOf(e.infectorRosterId)}` : 'by the infection'}</span>
                  </li>
                ))}
              {blowouts.map((e, i) => (
                <li key={`b-${i}`} className={z.logRow}>
                  <span className={spStyles.av} style={{ background: specialtyAvatarColor(e.winnerRosterId) }} aria-hidden>
                    {specialtyInitials(nameOf(e.winnerRosterId))}
                  </span>
                  <strong>{nameOf(e.winnerRosterId)}</strong>
                  <SpecialtyTag tone={e.kind === 'mauling' ? 'zone' : 'gold'}>{e.kind === 'mauling' ? 'Mauling' : 'Bashing'}</SpecialtyTag>
                  <span className={z.logScore}>by {fmt(e.margin)}</span>
                  <span className={z.logBy}>over {nameOf(e.loserRosterId)}</span>
                </li>
              ))}
            </ul>
            {infections.length === 0 && blowouts.length === 0 ? (
              <p className={spStyles.empty}>Nobody turned this week{final ? '' : ' yet'}.</p>
            ) : null}
          </SpecialtyCard>
        </div>
      </div>
    </div>
  )
}
