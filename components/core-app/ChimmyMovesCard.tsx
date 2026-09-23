'use client'

import Link from 'next/link'

import type { ChimmyMoves } from '@/lib/core-app/chimmyMoves'
import { COMMS_OPEN_EVENT, type CommsOpenDetail } from './comms/commsEvents'

function askChimmy(prefill: string) {
  const detail: CommsOpenDetail = { tab: 'chimmy', prefill }
  window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail }))
}

/**
 * Chimmy's one-tap moves — league-first, above the matchup and the league home.
 *
 * Each row has one primary tap (to the exact lineup row that fixes it) and one Chimmy tap (a
 * question in the composer, unsent). See lib/core-app/chimmyMoves.ts for what counts as a move.
 */
export function ChimmyMovesCard({ data, leagueName }: { data: ChimmyMoves; leagueName: string }) {
  return (
    <section className="af-frame af-cmv" aria-label="Chimmy's moves">
      <header className="af-cmv-head">
        <span className="af-cmv-mark" aria-hidden>
          ✦
        </span>
        <h2 className="af-cmv-title">Chimmy&rsquo;s moves</h2>
        {data.moves.length > 0 ? (
          <span className="af-cmv-count af-num">{data.moves.length}</span>
        ) : null}
      </header>

      {data.moves.length > 0 ? (
        <ul className="af-cmv-list">
          {data.moves.map((move) => (
            <li key={move.key} className="af-cmv-row" data-tone={move.tone}>
              <div className="af-cmv-text">
                <span className="af-cmv-move">{move.title}</span>
                <span className="af-cmv-detail">{move.detail}</span>
              </div>
              <div className="af-cmv-actions">
                <Link href={move.href} className="af-btn af-cmv-do">
                  {move.actionLabel}
                </Link>
                <button
                  type="button"
                  className="af-cmv-ask"
                  aria-label={`Ask Chimmy about ${move.title.replace(/^(Bench|Check) /, '')}`}
                  onClick={() => askChimmy(move.ask)}
                >
                  ✦
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="af-cmv-empty">
          {/*
            ⚠ "ALL CLEAR" ONLY WHEN WE READ A LINEUP. With no starters read (a league whose ids the
            triage cannot join yet) silence is not health, so the copy says nothing about the lineup.
          */}
          <p className="af-cmv-detail">
            {data.startersRead > 0
              ? `No injured or idle starters in ${leagueName}.`
              : `Chimmy can check your ${leagueName} lineup for you.`}
          </p>
          <button type="button" className="af-btn af-cmv-do" onClick={() => askChimmy(data.checkAsk)}>
            Start/sit check
          </button>
        </div>
      )}
    </section>
  )
}
