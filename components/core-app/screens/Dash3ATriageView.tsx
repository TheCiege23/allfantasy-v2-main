'use client'

import Link from 'next/link'
import { useEffect, type ReactNode } from 'react'
import { ClubLogo } from '@/components/core-app/ClubLogo'
import { FallbackImg } from '@/components/core-app/FallbackImg'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { slotText } from '@/lib/core-app/playerMovesCopy'
import { coverSlotLabel } from '@/lib/core-app/lineupCover'
import { BEST_ADD_AUTO_LIMIT, TriageFreeAgentCta } from '@/components/core-app/screens/TriageBestAdd'
import { platformLabel } from '@/lib/core-app/platformLinks'
import { sendProductAnalyticsBeacon } from '@/lib/analytics/client'
import { ageText } from '@/lib/core-app/shellCopy'
import type { TriageSlot } from '@/components/core-app/screens/Dash3ATriage'

/**
 * The words of Dash3ATriage, in the reader's language (2026-10-04).
 *
 * The strip is a SERVER component: it keeps the decision slice (starters who may not play), the cap,
 * every href, and each row's minutes to kickoff against the server's `now`. This says it. The injury
 * designation goes through `coreUiCopy`, the report age through shellCopy's `ageText`, the slot chip
 * through `slotText` — the same translators the rest of /core uses. The feed's own description is the
 * provider's sentence and stays as written, as it does on every surface that shows it.
 */
export type TriageViewLeague = {
  id: string
  name: string
  platform: string
  href: string
  slot: TriageSlot | null
  /** Bench players who can take his slot here — names only, only where he starts. */
  bench: string[]
  /** A flex/superflex two-step instead (see lib/core-app/lineupCover.ts); absent when none. */
  cover?: { move: string; toSlot: string; fromSlot: string; fill: string | null; gain?: number | null } | null
  /** Where the move is made — the platform's lineup screen; absent when no verified link exists. */
  fixHref?: string | null
}

/**
 * "swap in Allgeier · or move Pollard to RB, start Washington at FLEX". One sentence per league,
 * the simple move first; null when there is nothing to offer.
 */
export function coverText(l: Pick<TriageViewLeague, 'bench' | 'cover'>, es: boolean, questionable = false): string | null {
  const parts: string[] = []
  if (l.bench.length > 0) {
    // A game-time call keeps the pivot ready rather than ordering the swap.
    if (questionable) parts.push(es ? `relevo seguro: ${l.bench.join(' o ')}` : `safe pivot: ${l.bench.join(' or ')}`)
    else parts.push(es ? `pon a ${l.bench.join(' o ')}` : `swap in ${l.bench.join(' or ')}`)
  }
  const c = l.cover
  if (c) {
    const to = coverSlotLabel(c.toSlot)
    const from = coverSlotLabel(c.fromSlot)
    const chain = c.fill
      ? es
        ? `mueve a ${c.move} a ${to} y pon a ${c.fill} en ${from}`
        : `move ${c.move} to ${to}, start ${c.fill} at ${from}`
      : es
        ? `mueve a ${c.move} a ${to} y añade un agente libre en ${from}`
        : `move ${c.move} to ${to}, then add a free agent at ${from}`
    const gain = c.fill && c.gain != null && c.gain > 0 ? ` (+${c.gain.toFixed(1)} pts)` : ''
    parts.push(`${parts.length > 0 ? (es ? `o ${chain}` : `or ${chain}`) : chain}${gain}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/** One best ball position worth a glance (lib/core-app/bestBallDepth.ts, built in dash34). */
export type TriageViewDepthAlert = {
  leagueId: string
  leagueName: string
  platform: string
  href: string
  waiversHref: string | null
  position: string
  rostered: number
  healthy: number
  out: number
  questionable: number
  needed: number
  tone: 'bad' | 'warn'
  flagged: Array<{ name: string; status: string }>
}

export type TriageViewRow = {
  key: string
  name: string
  initials: string
  /** Sleeper id, for the on-demand best free agent; null when we hold none. */
  sleeperId?: string | null
  imageUrl: string | null
  playerHref: string
  position: string | null
  team: string | null
  sport: string | null
  status: string
  tone: 'bad' | 'warn'
  exposure: string
  exposureCount: number
  exposureTotal: number
  startingIn: number
  benchIn: number
  irIn: number
  taxiIn: number
  /** Rostered in a best ball league — the platform sets that lineup. */
  bestBallIn?: number
  value: { overallRank: number | null; positionRank: number | null } | null
  reportedAgo: string | null
  /** Minutes from the server's `now` to his club's next kickoff; null when none is held. */
  kickoffMins: number | null
  description: string | null
  /** The first six leagues; `leagueCount` says how many there are. */
  leagues: TriageViewLeague[]
  leagueCount: number
  /** "Find free agents in …" — one per league where he STARTS. */
  freeAgentLinks: Array<{ id: string; name: string; href: string }>
}

const SLOT_LABEL: Record<TriageSlot, string> = { starter: 'STARTER', bench: 'bench', ir: 'IR', taxi: 'taxi' }

function slotLabel(slot: TriageSlot, es: boolean): string {
  if (!es) return SLOT_LABEL[slot]
  if (slot === 'starter') return slotText('STARTER', 'es')
  if (slot === 'bench') return slotText('BENCH', 'es').toLowerCase()
  return SLOT_LABEL[slot]
}

function kickoffLabel(mins: number | null, es: boolean): string | null {
  if (mins == null) return null
  if (mins <= 0) return es ? 'partido en curso' : 'kickoff underway'
  if (mins < 60) return es ? `inicio en ${mins} min` : `kickoff in ${mins}m`
  if (mins < 48 * 60) return es ? `inicio en ${Math.round(mins / 60)} h` : `kickoff in ${Math.round(mins / 60)}h`
  return es ? `inicio en ${Math.round(mins / (60 * 24))} d` : `kickoff in ${Math.round(mins / (60 * 24))}d`
}

/**
 * "4 lineups to fix · 3 with bench cover · 1 needs a pickup" — the ruled-out rows' leagues, counted
 * once each, so the whole job across leagues reads in one line before the rows.
 */
export function fixAllSummary(rows: TriageViewRow[], es: boolean): string | null {
  let toFix = 0
  let covered = 0
  for (const p of rows) {
    if (p.tone !== 'bad') continue
    for (const l of p.leagues) {
      if (l.slot !== 'starter') continue
      toFix++
      if (l.bench.length > 0 || (l.cover && l.cover.fill)) covered++
    }
  }
  if (toFix === 0) return null
  const pickup = toFix - covered
  const parts = [
    es ? `${toFix} ${toFix === 1 ? 'alineación por corregir' : 'alineaciones por corregir'}` : `${toFix} ${toFix === 1 ? 'lineup' : 'lineups'} to fix`,
    covered > 0 ? (es ? `${covered} con relevo en tu banca` : `${covered} with bench cover`) : null,
    pickup > 0 ? (es ? `${pickup} ${pickup === 1 ? 'necesita' : 'necesitan'} un agente libre` : `${pickup} ${pickup === 1 ? 'needs' : 'need'} a pickup`) : null,
  ]
  return parts.filter(Boolean).join(' · ')
}

/** "starting in 3, benched in 5, on IR in 1" — only the counts that are non-zero. */
function slotSummary(p: TriageViewRow, es: boolean): string {
  return [
    p.startingIn > 0 ? (es ? `titular en ${p.startingIn}` : `starting in ${p.startingIn}`) : null,
    p.benchIn > 0 ? (es ? `en la banca en ${p.benchIn}` : `benched in ${p.benchIn}`) : null,
    p.irIn > 0 ? (es ? `en IR en ${p.irIn}` : `on IR in ${p.irIn}`) : null,
    p.taxiIn > 0 ? (es ? `en el taxi en ${p.taxiIn}` : `on taxi in ${p.taxiIn}`) : null,
    (p.bestBallIn ?? 0) > 0 ? (es ? `best ball en ${p.bestBallIn}` : `best ball in ${p.bestBallIn}`) : null,
  ]
    .filter(Boolean)
    .join(', ')
}

/** "1 healthy of 3 · 1 out · 1 questionable" — the room in one line. */
function depthLine(a: TriageViewDepthAlert, es: boolean): string {
  return [
    es ? `${a.healthy} sano${a.healthy === 1 ? '' : 's'} de ${a.rostered}` : `${a.healthy} healthy of ${a.rostered}`,
    a.out > 0 ? (es ? `${a.out} fuera` : `${a.out} out`) : null,
    a.questionable > 0 ? (es ? `${a.questionable} en duda` : `${a.questionable} questionable`) : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function DepthChecks({ alerts, es, language }: { alerts: TriageViewDepthAlert[]; es: boolean; language: string }) {
  return (
    <div className="af-depth">
      <h3 className="af-depth-title">{es ? 'Profundidad en best ball' : 'Best ball depth check'}</h3>
      <p className="af-depth-sub">
        {es
          ? 'Best ball arma tu alineación solo; esto marca posiciones donde casi no quedan sanos.'
          : 'Best ball sets your lineup for you — these are the spots running out of healthy bodies.'}
      </p>
      <ul className="af-depth-list">
        {alerts.map((a) => (
          <li key={`${a.leagueId}:${a.position}`} className="af-depth-card" data-tone={a.tone}>
            <span className="af-depth-pos" data-tone={a.tone} aria-hidden>
              {a.position}
            </span>
            <div className="af-depth-main">
              <div className="af-depth-line1">
                <Link href={a.href} className="af-depth-league">
                  <span className="af-triage-league-platform">{a.platform.toUpperCase()}</span>
                  {a.leagueName}
                </Link>
              </div>
              <div className="af-depth-count af-num">{depthLine(a, es)}</div>
              <div className="af-depth-names">
                {a.flagged.map((f) => (
                  <span key={f.name} className="af-depth-name">
                    {f.name} <em>{coreUiCopy(f.status, language)}</em>
                  </span>
                ))}
              </div>
            </div>
            {a.waiversHref ? (
              <Link className="af-depth-cta" href={a.waiversHref}>
                {es ? `Buscar ${a.position}` : `Find a ${a.position}`}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Dash3ATriageView({
  rows,
  overflow,
  valueBasis,
  freshness,
  depthAlerts = [],
}: {
  rows: TriageViewRow[]
  overflow: number
  depthAlerts?: TriageViewDepthAlert[]
  /** Present only when a row carries a price — see the band. */
  valueBasis: { format: string; qbFormat: string } | null
  freshness: ReactNode
}) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const hasStarters = rows.length > 0
  /*
   * Which league chips get an on-demand "top add" — the first few where he STARTS, NFL only (the
   * board's ids are Sleeper ids), in the order the card shows them. Capped: see TriageBestAdd.
   */
  const bestAddKeys = new Set<string>()
  for (const p of rows) {
    if (p.tone !== 'bad' || String(p.sport ?? '').toUpperCase() !== 'NFL' || !p.sleeperId) continue
    for (const l of p.leagues) {
      if (bestAddKeys.size >= BEST_ADD_AUTO_LIMIT) break
      if (l.slot === 'starter') bestAddKeys.add(`${p.key}|${l.id}`)
    }
  }
  const summaryLine = fixAllSummary(rows, es)
  // One "shown" event per mount — the denominator for how often a suggestion is acted on.
  useEffect(() => {
    if (!hasStarters) return
    sendProductAnalyticsBeacon('product.triage.shown', {
      rows: rows.length,
      questionable: rows.filter((r) => r.tone === 'warn').length,
      leagues: rows.reduce((n, r) => n + r.leagues.filter((l) => l.slot === 'starter').length, 0),
      withChain: rows.reduce((n, r) => n + r.leagues.filter((l) => l.cover).length, 0),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const title = hasStarters
    ? es ? 'Titulares en duda' : 'Starters in doubt'
    : es ? 'Revisa tu plantilla' : 'Roster check'

  return (
    <section id="af-home-triage" className="af-core af-triage" aria-label={title}>
      <div className="af-triage-head">
        <h2 className="af-triage-title">{title}</h2>
        <TopicTip topic="startersInDoubt" />
        {hasStarters ? (
          <span className="af-triage-sub">
            {es ? 'puede que no jueguen esta semana · los más valiosos primero' : 'may not play this week · most valuable first'}
          </span>
        ) : null}
        {summaryLine ? <span className="af-triage-summary">{summaryLine}</span> : null}
      </div>
      {hasStarters ? (
      <ul className="af-triage-list">
        {rows.map((p) => {
          const kickoff = kickoffLabel(p.kickoffMins, es)
          const summary = slotSummary(p, es)
          return (
            <li key={p.key} className="af-triage-row" data-tone={p.tone}>
              {p.imageUrl ? (
                <FallbackImg
                  className="af-triage-avatar"
                  src={p.imageUrl}
                  alt=""
                  loading="lazy"
                  fallback={
                    <span className="af-triage-avatar af-triage-avatar--initials" aria-hidden>
                      {p.initials}
                    </span>
                  }
                />
              ) : (
                <span className="af-triage-avatar af-triage-avatar--initials" aria-hidden>
                  {p.initials}
                </span>
              )}
              <div className="af-triage-main">
                <div className="af-triage-line1">
                  <Link className="af-triage-name" href={p.playerHref}>
                    {p.name}
                  </Link>
                  <span className="af-triage-meta">
                    {[p.position, p.team].filter(Boolean).join(' · ')}
                    {String(p.sport ?? '').toUpperCase() === 'NFL' ? (
                      <ClubLogo club={p.team} size={14} style={{ marginLeft: 6 }} />
                    ) : null}
                  </span>
                  <span className="af-triage-status" data-tone={p.tone}>
                    {coreUiCopy(p.status, language)}
                  </span>
                </div>
                <div className="af-triage-line2">
                  <span className="af-triage-exposure">
                    {/*
                      One sentence, not two overlapping ones. It read
                      "7 of 61 leagues · starter in 3 · bench in 3 · IR in 1",
                      which states the total and then its own parts as though
                      they were separate facts, and leaves the reader adding up
                      to check.
                    */}
                    {es ? `En ${p.exposureCount} de ${p.exposureTotal} ligas` : `In ${p.exposure} leagues`}
                    {summary ? `: ${summary}` : ''}
                  </span>
                  {p.value ? (
                    /*
                     * Rank leads because it is cross-positional and needs no
                     * scale to read; the raw price follows it. Absent renders
                     * nothing at all — a player we hold no price for must not
                     * look like a player priced at nothing.
                     */
                    <span className="af-triage-value af-num">
                      {/*
                        "#14 overall · RB4" made the reader guess what the
                        number ranked. Naming the thing costs three words.
                      */}
                      {es ? 'Valor de intercambio:' : 'Trade value:'}{' '}
                      {p.value.positionRank != null && p.position ? `${p.position}${p.value.positionRank}` : null}
                      {p.value.positionRank != null && p.value.overallRank != null ? ', ' : ''}
                      {p.value.overallRank != null ? `#${p.value.overallRank} ${coreUiCopy('overall', language)}` : null}
                    </span>
                  ) : null}
                  {p.reportedAgo ? (
                    <span className="af-triage-ago">
                      {es ? `reportado ${ageText(p.reportedAgo, 'es')}` : `reported ${p.reportedAgo}`}
                    </span>
                  ) : null}
                  {kickoff ? <span className="af-triage-kickoff">{kickoff}</span> : null}
                </div>
                {p.tone === 'warn' ? (
                  <p className="af-triage-note af-triage-note--gametime">
                    {es
                      ? 'Decisión de último momento: ten el relevo listo y cámbialo antes del inicio si lo descartan.'
                      : "Game-time call: keep the pivot ready and swap before kickoff if he's ruled out."}
                  </p>
                ) : null}
                {p.description ? (
                  /* The feed's own sentence. Never paraphrased into a timeline —
                     no injury table here holds an expected return. */
                  <p className="af-triage-note">{p.description}</p>
                ) : null}
                {p.leagues.length > 0 ? (
                  <div className="af-triage-leagues">
                    {p.leagues.map((l) => (
                      <Link key={l.id} href={l.href} className="af-triage-league" data-slot={l.slot ?? undefined}>
                        <span className="af-triage-league-platform">{l.platform.toUpperCase()}</span>
                        {l.name}
                        {/* Where he sits in THIS league — the difference between
                            "act here" and "no action needed". Absent when the
                            roster could not be read; never defaulted to bench. */}
                        {l.slot ? (
                          <span className="af-triage-slot" data-slot={l.slot} data-handled={p.tone === 'bad' && l.slot === 'bench' ? 'true' : undefined}>
                            {/* Ruled out and already benched here: handled, and it says so. */}
                            {p.tone === 'bad' && l.slot === 'bench' ? (es ? 'en la banca ✓' : 'benched ✓') : slotLabel(l.slot, es)}
                          </span>
                        ) : null}
                        {/*
                          Cover you already own, in this league. Free agents
                          need that league's whole player pool and a
                          rostered-elsewhere exclusion — a per-league scan that
                          must not run for 61 leagues on a render — so they
                          live behind the CTA below. An empty bench here is not
                          a gap in the data; it is the reason to go look.
                        */}
                        {l.slot === 'starter' && coverText(l, es, p.tone === 'warn') ? (
                          <span className="af-triage-bench">
                            {' '}
                            {coverText(l, es, p.tone === 'warn')}
                          </span>
                        ) : null}
                      </Link>
                    ))}
                    {p.leagueCount > p.leagues.length ? (
                      <span className="af-triage-league af-triage-league--more">
                        {es ? `+${p.leagueCount - p.leagues.length} más` : `+${p.leagueCount - p.leagues.length} more`}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="af-triage-actions">
                {/*
                  Where the move is made. Sleeper, ESPN and Yahoo accept no lineup write from us, so
                  this is a precise hand-off to their own lineup screen, never a pretend "apply".
                */}
                {p.leagues
                  .filter((l) => l.slot === 'starter' && l.fixHref)
                  .slice(0, 3)
                  .map((l) => (
                    <a
                      key={`fix-${l.id}`}
                      className="af-triage-cta af-triage-cta--fix"
                      href={l.fixHref!}
                      target={/^https?:/.test(l.fixHref!) ? '_blank' : undefined}
                      rel={/^https?:/.test(l.fixHref!) ? 'noopener noreferrer' : undefined}
                      onClick={() => sendProductAnalyticsBeacon('product.triage.fix_clicked', { platform: l.platform, questionable: p.tone === 'warn' })}
                    >
                      {es ? `Corregir alineación en ${platformLabel(l.platform)} · ${l.name}` : `Set lineup in ${platformLabel(l.platform)} · ${l.name}`}
                    </a>
                  ))}
                {p.tone === 'warn' ? null : p.freeAgentLinks.length > 0 ? (
                  p.freeAgentLinks.map((l) => (
                    <TriageFreeAgentCta
                      key={l.id}
                      leagueId={l.id}
                      leagueName={l.name}
                      baseHref={l.href}
                      injuredId={String(p.sport ?? '').toUpperCase() === 'NFL' ? p.sleeperId ?? null : null}
                      auto={bestAddKeys.has(`${p.key}|${l.id}`)}
                      es={es}
                    />
                  ))
                ) : (
                  <Link className="af-triage-cta" href="/core/players">
                    {es ? `Abrir ${coreUiCopy('Player Finder', 'es')}` : 'Open Player Finder'}
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      ) : null}
      {depthAlerts.length > 0 ? <DepthChecks alerts={depthAlerts} es={es} language={language} /> : null}
      {overflow > 0 ? (
        <Link className="af-triage-overflow" href="/my-players">
          {es
            ? `+${overflow} titulares señalados más: auditoría completa de exposición`
            : `+${overflow} more starters flagged — full exposure audit`}
        </Link>
      ) : null}
      {valueBasis ? (
        /*
         * Said once for the panel. The price is captured at 12 teams and full
         * PPR and varies only dynasty/redraft and 1QB/superflex — it is NOT
         * tuned to this account's TE-premium or superflex settings, and
         * pretending otherwise would be the quiet kind of lie this screen
         * exists to avoid.
         */
        <p className="af-triage-basis">
          {es ? (
            <>
              Valores de FantasyCalc ({valueBasis.format.toLowerCase()}, {valueBasis.qbFormat === 'ONE_QB' ? '1QB' : 'superflex'}, PPR
              de 12 equipos). No están ajustados a la configuración de tu liga, y son solo de la NFL.
            </>
          ) : (
            <>
              Values from FantasyCalc ({valueBasis.format.toLowerCase()},{' '}
              {valueBasis.qbFormat === 'ONE_QB' ? '1QB' : 'superflex'}, 12-team PPR). Not tuned to
              your league&rsquo;s settings, and NFL only.
            </>
          )}
        </p>
      ) : null}
      {freshness}
    </section>
  )
}

export default Dash3ATriageView
