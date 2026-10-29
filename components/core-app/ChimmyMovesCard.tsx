'use client'

import Link from 'next/link'

import type { ChimmyMove, ChimmyMoves } from '@/lib/core-app/chimmyMoves'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { chimmyMovesCardMessages } from '@/lib/core-app/messages/chimmyMovesCard'
import { COMMS_OPEN_EVENT, type CommsOpenDetail } from './comms/commsEvents'

function askChimmy(prefill: string, leagueId?: string) {
  const detail: CommsOpenDetail = { tab: 'chimmy', prefill, ...(leagueId ? { leagueId } : {}) }
  window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail }))
}

/**
 * Chimmy's one-tap moves — league-first, above the matchup and the league home.
 *
 * Each row has one primary tap (to the exact lineup row that fixes it) and one Chimmy tap (a
 * question in the composer, unsent). See lib/core-app/chimmyMoves.ts for what counts as a move.
 */
/** A move in the reader's view: Spanish rebuilt from its parts, or the composer's English as written. */
type MoveText = { title: string; detail: string; actionLabel: string; ask: string; about: string }

const REASON_ES = { inactive: 'inactivo', bye: 'descansa', 'no-game': 'no tiene partido esta semana' } as const

function moveTextEs(move: ChimmyMove, leagueName: string): MoveText | null {
  const p = move.parts
  if (!p) return null
  const actionLabel = move.tone === 'bad' ? 'Corregir alineación' : 'Revisar'
  if (p.verb === 'fill') {
    return {
      title: `Completa tu puesto libre de ${p.slotLabel}`,
      detail: 'Puesto titular vacío: anota cero',
      actionLabel,
      ask: `Mi puesto de ${p.slotLabel} en ${leagueName} está vacío. ¿A quién alineo ahí?`,
      about: `tu puesto libre de ${p.slotLabel}`,
    }
  }
  const reason = p.reason.kind === 'status' ? coreUiCopy(p.reason.label, 'es').toLowerCase() : REASON_ES[p.reason.kind]
  const detail = [reason.charAt(0).toUpperCase() + reason.slice(1), p.where, p.lock ? coreUiCopy(p.lock, 'es') : null]
    .filter(Boolean)
    .join(' — ')
  return {
    title: `${p.verb === 'bench' ? 'Sienta a' : 'Revisa a'} ${p.name}`,
    detail,
    actionLabel,
    ask:
      move.tone === 'bad'
        ? `${p.name} (${reason}). ¿A quién debería alinear en su lugar en ${leagueName}?`
        : `${p.name} (${reason}). ¿Debería alinearlo en ${leagueName}, y quién es mi mejor suplente?`,
    about: p.name,
  }
}

export function ChimmyMovesCard({ data, leagueName }: { data: ChimmyMoves; leagueName: string }) {
  const { language } = useOptionalLanguage()
  const m = useMessages(chimmyMovesCardMessages)
  /* Spanish rebuilds a move from its parts; every other language keeps the composer's English. */
  const textOf = (move: ChimmyMove): MoveText =>
    (language === 'es' ? moveTextEs(move, leagueName) : null) ?? {
      title: move.title,
      detail: move.detail,
      actionLabel: move.actionLabel,
      ask: move.ask,
      about: move.title.replace(/^(Bench|Check) /, ''),
    }
  return (
    <section className="af-frame af-cmv" aria-label={m.sectionLabel}>
      <header className="af-cmv-head">
        <span className="af-cmv-mark" aria-hidden>
          ✦
        </span>
        <h2 className="af-cmv-title">{m.title}</h2>
        {data.moves.length > 0 ? (
          <span className="af-cmv-count af-num">{data.moves.length}</span>
        ) : null}
      </header>

      {data.moves.length > 0 ? (
        <ul className="af-cmv-list">
          {data.moves.map((move) => {
            const t = textOf(move)
            return (
              <li key={move.key} className="af-cmv-row" data-tone={move.tone}>
                <div className="af-cmv-text">
                  <span className="af-cmv-move">{t.title}</span>
                  <span className="af-cmv-detail">{t.detail}</span>
                </div>
                <div className="af-cmv-actions">
                  <Link href={move.href} className="af-btn af-cmv-do">
                    {t.actionLabel}
                  </Link>
                  <button
                    type="button"
                    className="af-cmv-ask"
                    aria-label={m.askAbout(t.about)}
                    onClick={() => askChimmy(t.ask, data.leagueId)}
                  >
                    ✦
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="af-cmv-empty">
          {/*
            ⚠ "ALL CLEAR" ONLY WHEN WE READ A LINEUP. With no starters read (a league whose ids the
            triage cannot join yet) silence is not health, so the copy says nothing about the lineup.
          */}
          <p className="af-cmv-detail">
            {data.startersRead > 0 ? m.allClear(leagueName) : m.canCheck(leagueName)}
          </p>
          <button
            type="button"
            className="af-btn af-cmv-do"
            onClick={() => askChimmy(m.checkAsk(leagueName, data.checkAsk), data.leagueId)}
          >
            {m.startSitCheck}
          </button>
        </div>
      )}
    </section>
  )
}
