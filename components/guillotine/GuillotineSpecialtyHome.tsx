'use client'

/**
 * The chop moment and the "what do I need" block of a Guilly league's Chop page, in the specialty-league design
 * (design-refs/native-league-handoff/specialty-leagues/guillotine/GuillotineChop). Presentation only — every
 * number is the engine's, as served by /api/leagues/[leagueId]/guillotine/summary (`home`).
 */

import { useState, type CSSProperties } from 'react'
import { ChopExplainerBlock } from '@/components/scenario-explainer/WhatDoINeed'
import Link from 'next/link'
import {
  SpecialtyReplayButton,
  SpecialtyShell,
  SpecialtyTag,
  specialtyAsset,
  specialtyAvatarColor,
  specialtyInitials,
  spStyles as sp,
  usePrefersReducedMotion,
} from '@/components/league/specialty/SpecialtyShell'
import type { GuillotineHomeExtras } from '@/lib/league-specialty/guillotineHome'
import gl from './guillotine-specialty.module.css'

const asset = (f: string) => specialtyAsset('guillotine', f)
const fmt = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '—')

function Avatar({ id, name, size = 34 }: { id: string; name: string; size?: number }) {
  return (
    <span
      className={`${sp.av} ${gl.avDim}`}
      style={{ background: specialtyAvatarColor(id), width: size, height: size, fontSize: size > 40 ? 15 : 11.5 }}
      aria-hidden
    >
      {specialtyInitials(name)}
    </span>
  )
}

/**
 * What the Chop page draws under its list (components/guillotine/GuillotineHome.tsx): "what do I need to avoid
 * the chop" once there are scores to model, and the latest chop's moment. Both sit in the specialty shell, whose
 * tokens the chop moment reads.
 *
 * This file used to be the whole hub: a hero, a second chop line, a "your survival" card, a tiebreak card, a
 * feed and a phone-only copy of all of it. The Chop page is one list now (owner's decision, 2026-11-25), drawn by
 * GuillySurvivalBoard, so those are gone rather than kept beside it.
 */
export function GuillotineChopExtras({ leagueId, home }: { leagueId: string; home: GuillotineHomeExtras | null | undefined }) {
  return (
    <SpecialtyShell format="guillotine" className={gl.home} testId="guillotine-chop-extras">
      {/* What do I need to avoid the chop — lib/scenario-explainer. Hidden until there are chop scores to model. */}
      <ChopExplainerBlock leagueId={leagueId} />
      {home?.lastChop ? <GuillotineChopMoment leagueId={leagueId} lastChop={home.lastChop} aliveCount={home.aliveCount} waiverLabel={home.waiverLabel} /> : null}
    </SpecialtyShell>
  )
}

const BLADE_SVG = (
  <svg viewBox="0 0 200 110" aria-hidden>
    <rect x="2" y="0" width="196" height="18" rx="3" fill="#3a1e12" stroke="#000" strokeWidth="3" />
    <path d="M14,18 L186,18 L186,60 L14,104 Z" fill="#cfd5de" stroke="#000" strokeWidth="4" strokeLinejoin="round" />
    <path d="M20,98 L180,58" stroke="#fff" strokeWidth="3" />
    <path d="M100,0 V-200" stroke="#c9a46a" strokeWidth="4" />
  </svg>
)

/**
 * Signature moment: the bottom three of the latest chopped week. "Drop the blade" drops the steel
 * over the lowest team (0.5s), draws the slash and pops the Chopped stamp; the released roster then
 * slides in with Bid buttons that stay disabled until each player's FAAB window opens. Replay resets.
 * Reduced motion: opens already chopped, with no movement.
 */
export function GuillotineChopMoment({
  leagueId,
  lastChop,
  aliveCount,
  waiverLabel,
  now = Date.now(),
}: {
  leagueId: string
  lastChop: NonNullable<GuillotineHomeExtras['lastChop']>
  aliveCount: number
  waiverLabel?: string | null
  now?: number
}) {
  const reduced = usePrefersReducedMotion()
  const [dropped, setDropped] = useState(false)
  const done = dropped || reduced
  const chopped = new Set(lastChop.choppedRosterIds)
  const cut = lastChop.bottom.find((b) => chopped.has(b.rosterId)) ?? lastChop.bottom[lastChop.bottom.length - 1] ?? null
  const cutName = cut?.name ?? 'The lowest score'
  const waivers = `/league/${encodeURIComponent(leagueId)}?view=players`

  return (
    <section
      id="guillotine-chop"
      className={`${sp.card} ${sp.pad} ${sp.stayDark} ${done ? gl.chopped : ''}`}
      style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(224,64,46,.14), transparent 60%), #0b0d14', gap: 16 }}
      data-testid="guillotine-chop-moment"
      data-state={done ? 'chopped' : 'armed'}
      aria-labelledby="guillotine-chop-title"
    >
      <div className={sp.momentHead}>
        <h2 id="guillotine-chop-title" className={sp.h1} style={{ fontSize: 22 }}>
          The chop · week {lastChop.week}
        </h2>
        {done ? (
          <SpecialtyReplayButton onReplay={() => setDropped(false)} />
        ) : (
          <button type="button" className={`${sp.btn} ${sp.btnP}`} onClick={() => setDropped(true)} data-testid="guillotine-drop-blade">
            Drop the blade
          </button>
        )}
      </div>
      <span className={sp.lbl}>Bottom three · week {lastChop.week} final</span>
      <div className={gl.stage}>
        {lastChop.bottom.map((b) => {
          const isTarget = cut?.rosterId === b.rosterId
          const sub = isTarget
            ? done
              ? 'Chopped · roster released'
              : 'Lowest score'
            : cut
              ? `Survived by ${fmt(b.points - cut.points)}`
              : 'Survived'
          return (
            <div key={b.rosterId} className={`${gl.card} ${isTarget ? gl.target : ''}`}>
              {isTarget ? (
                <>
                  <div className={gl.blade}>{BLADE_SVG}</div>
                  <span className={gl.slash} aria-hidden />
                </>
              ) : null}
              <Avatar id={b.rosterId} name={b.name} size={56} />
              <span className={gl.cardName}>{b.name}</span>
              <span className={`${sp.num} ${gl.cardPts}`} style={{ color: isTarget ? '#ff9a8a' : '#e8eaf2' }}>
                {fmt(b.points)}
              </span>
              <span className={sp.t3} style={{ fontSize: 12 }}>{sub}</span>
              {isTarget && done ? (
                <div className={gl.stampWrap}>
                  <span className={gl.stamp}>Chopped</span>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <p className={sp.t2} style={{ margin: 0, fontSize: 13 }} aria-live="polite">
        {done
          ? `${cutName} is out${cut ? ` with ${fmt(cut.points)}` : ''}. ${aliveCount} teams remain. Their roster is on waivers.`
          : 'Scores are final. The lowest score is chopped when the blade drops.'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset('icon-zone.svg')} alt="" aria-hidden style={{ width: 28, height: 28 }} />
          <span className={sp.lbl}>
            {done ? `Released to waivers · ${lastChop.releases.length}` : 'Roster to be released'}
          </span>
        </div>
        {lastChop.releases.length === 0 ? (
          <p className={sp.empty}>The released players show here once the roster is processed.</p>
        ) : (
          <ul className={gl.list}>
            {lastChop.releases.map((p, i) => {
              const opens = p.availableAt ? new Date(p.availableAt).getTime() : NaN
              const open = done && p.status !== 'claimed' && (!Number.isFinite(opens) || opens <= now)
              return (
                <li
                  key={p.playerId}
                  className={gl.released}
                  style={{ animationDelay: done && !reduced ? `${(0.9 + i * 0.12).toFixed(2)}s` : '0s', opacity: done ? undefined : 0.45 } as CSSProperties}
                >
                  <SpecialtyTag tone="muted" style={{ width: 44 }}>{p.position || '—'}</SpecialtyTag>
                  <span style={{ flex: 1, fontWeight: 600, minWidth: 0 }}>{p.playerName}</span>
                  {p.team ? <span className={`${sp.t3} ${sp.num}`} style={{ fontSize: 12 }}>{p.team}</span> : null}
                  {open ? (
                    <Link className={`${sp.btn} ${gl.bid}`} href={waivers} aria-label={`Bid on ${p.playerName}`}>
                      Bid
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className={`${sp.btn} ${gl.bid}`}
                      disabled
                      aria-label={`Bid on ${p.playerName} (opens when the FAAB window opens)`}
                    >
                      {p.status === 'claimed' ? 'Claimed' : 'Bid'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {waiverLabel ? (
          <div className={sp.card2} style={{ padding: 14, fontSize: 12.5, color: '#a3a9c2' }}>
            Bids on released players run with the league&rsquo;s next waiver process ({waiverLabel}).
          </div>
        ) : null}
      </div>
    </section>
  )
}
