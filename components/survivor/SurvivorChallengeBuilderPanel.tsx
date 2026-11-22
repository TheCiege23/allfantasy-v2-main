'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { defineMessages } from '@/lib/i18n/messages'
import {
  CHALLENGE_BUILDER_KINDS,
  CHALLENGE_PLAYER_STATS,
  CHALLENGE_PRIZE_TYPES,
  challengeInputKind,
  challengeSettlementSource,
  challengeStatsForSport,
  playerStatSupported,
  utcToEasternWallTime,
  validateChallengeDraft,
  type SurvivorPrizePhase,
  type SurvivorPrizePhaseRules,
  type ChallengeBuilderConfig,
  type ChallengeBuilderKind,
  type ChallengePrizeReward,
  type ChallengePrizeType,
} from '@/lib/survivor/survivorChallengeBuilderModel'
import { SURVIVOR_REWARD_ADVANTAGE_POWERS } from '@/lib/survivor/survivorRewardModel'
import { formatLocalTime } from './SurvivorChallengeBoardCard'

/**
 * Commissioner Hub → Mini Games: the challenge builder. Create, edit, open, lock, settle (preview,
 * then confirm), reverse and cancel commissioner challenges. Every field is validated with the same
 * function the server uses (`validateChallengeDraft`), and the server checks it again.
 */
export const challengeBuilderMessages = defineMessages({
  en: {
    heading: 'Challenge builder',
    sub: 'Write your own weekly challenges. Game and player challenges settle themselves from stored results; you can always settle by hand.',
    newChallenge: 'New challenge',
    title: 'Title', question: 'Question or instructions', kind: 'Type', scope: 'Who answers',
    individual: 'Each manager', tribe: 'One answer per tribe',
    week: 'Week', opens: 'Opens (Eastern time)', locks: 'Locks (Eastern time)',
    options: 'Answer options (one per line)', game: 'Game', pickGame: 'Pick a stored game',
    player: 'Player', searchPlayer: 'Search rostered players', stat: 'Stat', statWeek: 'Stat week', line: 'Line',
    prizes: 'Prizes', place: (n: number): string => `Place ${n}`, addPlace: 'Add a place', addReward: 'Add a reward', remove: 'Remove',
    amount: 'Amount', points: 'Points', basis: 'Split', perMember: 'Per member', total: 'Total', what: 'Steal what', power: 'Advantage', samePos: 'Same position only',
    defer: 'Pay out after (weeks)', penalty: 'Miss penalty', none: 'None', penPoints: 'Points', penFaab: 'FAAB',
    wager: 'Wager', wagerCur: 'Stake in', min: 'Min', max: 'Max', winX: 'Win ×', lossX: 'Loss ×',
    unique: 'No two entries may give the same answer', sealed: 'Sealed: hide answers until the result', allOver: 'Everyone over',
    allOverClosest: 'Closest overall wins', allOverNone: 'No winner',
    save: 'Save challenge', saving: 'Saving…', cancelEdit: 'Close', edit: 'Edit', openNow: 'Open now', lockNow: 'Lock now', cancel: 'Cancel challenge',
    settle: 'Settle', preview: 'Preview result', confirm: 'Confirm and pay', reverse: 'Reverse result', voidIt: 'Void it (no winners)',
    trueAnswer: 'True answer', trueValue: 'True value', fromData: 'From stored results',
    answers: (n: number): string => `${n} answer${n === 1 ? '' : 's'}`,
    status: (k: string): string => ({ scheduled: 'Scheduled', open: 'Open', locked: 'Locked', settling: 'Settling', complete: 'Settled', cancelled: 'Cancelled' } as Record<string, string>)[k] ?? k,
    kinds: (k: string): string => ({
      game_total_closest: 'Game total — closest guess', closest_without_going_over: 'Closest without going over', pick_winner: 'Pick the winner',
      game_total_over_under: 'Game total over/under', player_stat_over_under: 'Player stat over/under', anytime_td: 'Anytime scorer (TD · goal · home run)',
      custom_choice: 'Your own multiple choice', custom_number: 'Your own number (closest)',
      first_td_scorer: 'First TD scorer', last_score_type: 'Last score type', position_leader: 'Position leader (top scorer at a position)',
      sweep: 'Sweep (every prop must hit)', puzzle: 'Puzzle (first or fastest correct answer)',
    } as Record<string, string>)[k] ?? k,
    prizeTypes: (k: string): string => ({
      score_bonus: 'Points', faab_grant: 'FAAB', faab_transfer: 'FAAB from the other tribes', tribemate_points: 'Points on a tribemate',
      free_trade_token: 'Free trade', steal_blocker: 'Steal blocker', steal: 'Steal', advantage: 'Advantage', immunity: 'Immunity',
    } as Record<string, string>)[k] ?? k,
    manualOnly: 'Settle this one by hand.', pending: (why: string): string => `Not final in our data yet (${why}). You can settle by hand.`,
    payouts: 'Payouts', nobody: 'Nobody is paid.', failed: 'That did not go through.',
    settles: (how: string): string => ({
      game: 'Settles itself from the stored final score.', player_stat: 'Settles itself from the stored player stats.',
      position_leader: 'Settles itself from the stored weekly fantasy points.', exact_answer: 'Settles itself at the lock by exact match with your answer.',
      manual: 'Settled by the commissioner: nothing we store answers this one, so you settle it by hand.',
    } as Record<string, string>)[how] ?? how,
    statManual: (stat: string): string => `${stat} (settled by the commissioner for this sport)`,
    position: 'Position', positionPlayers: 'Players at that position (2 to 8)', addPlayer: 'Add player',
    props: 'Props (all must hit)', prop: (n: number): string => `Prop ${n}`, propQuestion: 'Question', propOptions: 'Options (one per line)', addProp: 'Add a prop',
    tiered: 'Tiered prizes: place 2 pays one miss, place 3 two misses…',
    puzzleAnswer: 'The answer (hidden from managers until the result)', puzzleMode: 'Who wins', puzzleFirst: 'First correct answer', puzzleFastest: 'Fastest correct answers (up to 5 places)',
    puzzleSettle: 'Settle', puzzleExact: 'By exact match at the lock', puzzleManual: 'By hand',
    optionalGame: 'Game (optional)', noGame: 'No game',
  },
  es: {
    heading: 'Creador de retos',
    sub: 'Escribe tus propios retos semanales. Los de partidos y jugadores se resuelven solos con los resultados guardados; siempre puedes resolverlos a mano.',
    newChallenge: 'Nuevo reto',
    title: 'Título', question: 'Pregunta o instrucciones', kind: 'Tipo', scope: 'Quién responde',
    individual: 'Cada mánager', tribe: 'Una respuesta por tribu',
    week: 'Semana', opens: 'Abre (hora del Este)', locks: 'Cierra (hora del Este)',
    options: 'Opciones de respuesta (una por línea)', game: 'Partido', pickGame: 'Elige un partido guardado',
    player: 'Jugador', searchPlayer: 'Busca jugadores en plantillas', stat: 'Estadística', statWeek: 'Semana de la estadística', line: 'Línea',
    prizes: 'Premios', place: (n: number): string => `Puesto ${n}`, addPlace: 'Añadir puesto', addReward: 'Añadir recompensa', remove: 'Quitar',
    amount: 'Cantidad', points: 'Puntos', basis: 'Reparto', perMember: 'Por miembro', total: 'Total', what: 'Qué robar', power: 'Ventaja', samePos: 'Solo misma posición',
    defer: 'Pagar después de (semanas)', penalty: 'Penalización por fallo', none: 'Ninguna', penPoints: 'Puntos', penFaab: 'FAAB',
    wager: 'Apuesta', wagerCur: 'Apostar en', min: 'Mín.', max: 'Máx.', winX: 'Ganar ×', lossX: 'Perder ×',
    unique: 'Dos entradas no pueden dar la misma respuesta', sealed: 'Sellado: ocultar respuestas hasta el resultado', allOver: 'Si todos se pasan',
    allOverClosest: 'Gana el más cercano', allOverNone: 'Sin ganador',
    save: 'Guardar reto', saving: 'Guardando…', cancelEdit: 'Cerrar', edit: 'Editar', openNow: 'Abrir ya', lockNow: 'Cerrar ya', cancel: 'Cancelar reto',
    settle: 'Resolver', preview: 'Ver resultado', confirm: 'Confirmar y pagar', reverse: 'Anular resultado', voidIt: 'Anularlo (sin ganadores)',
    trueAnswer: 'Respuesta correcta', trueValue: 'Valor real', fromData: 'Con los resultados guardados',
    answers: (n: number): string => `${n} respuesta${n === 1 ? '' : 's'}`,
    status: (k: string): string => ({ scheduled: 'Programado', open: 'Abierto', locked: 'Cerrado', settling: 'Resolviendo', complete: 'Resuelto', cancelled: 'Cancelado' } as Record<string, string>)[k] ?? k,
    kinds: (k: string): string => ({
      game_total_closest: 'Total del partido — el más cercano', closest_without_going_over: 'El más cercano sin pasarse', pick_winner: 'Elige al ganador',
      game_total_over_under: 'Total del partido más/menos', player_stat_over_under: 'Estadística de jugador más/menos', anytime_td: 'Anotador en cualquier momento (TD · gol · jonrón)',
      custom_choice: 'Tu propia opción múltiple', custom_number: 'Tu propio número (el más cercano)',
      first_td_scorer: 'Primer anotador de touchdown', last_score_type: 'Tipo de la última anotación', position_leader: 'Líder de posición (máximo anotador de una posición)',
      sweep: 'Pleno (hay que acertar todas)', puzzle: 'Acertijo (primera o más rápida respuesta correcta)',
    } as Record<string, string>)[k] ?? k,
    prizeTypes: (k: string): string => ({
      score_bonus: 'Puntos', faab_grant: 'FAAB', faab_transfer: 'FAAB de las otras tribus', tribemate_points: 'Puntos para un compañero',
      free_trade_token: 'Intercambio libre', steal_blocker: 'Bloqueador de robos', steal: 'Robo', advantage: 'Ventaja', immunity: 'Inmunidad',
    } as Record<string, string>)[k] ?? k,
    manualOnly: 'Resuelve este a mano.', pending: (why: string): string => `Aún no es definitivo en nuestros datos (${why}). Puedes resolverlo a mano.`,
    payouts: 'Pagos', nobody: 'No se paga a nadie.', failed: 'No se pudo completar.',
    settles: (how: string): string => ({
      game: 'Se resuelve solo con el marcador final guardado.', player_stat: 'Se resuelve solo con las estadísticas guardadas del jugador.',
      position_leader: 'Se resuelve solo con los puntos de fantasía semanales guardados.', exact_answer: 'Se resuelve solo al cierre, por coincidencia exacta con tu respuesta.',
      manual: 'Lo resuelve el comisionado: nada de lo que guardamos responde a esto, así que lo resuelves a mano.',
    } as Record<string, string>)[how] ?? how,
    statManual: (stat: string): string => `${stat} (lo resuelve el comisionado en este deporte)`,
    position: 'Posición', positionPlayers: 'Jugadores de esa posición (de 2 a 8)', addPlayer: 'Añadir jugador',
    props: 'Apuestas (hay que acertar todas)', prop: (n: number): string => `Apuesta ${n}`, propQuestion: 'Pregunta', propOptions: 'Opciones (una por línea)', addProp: 'Añadir apuesta',
    tiered: 'Premios por niveles: el puesto 2 paga un fallo, el 3 dos fallos…',
    puzzleAnswer: 'La respuesta (oculta a los mánagers hasta el resultado)', puzzleMode: 'Quién gana', puzzleFirst: 'La primera respuesta correcta', puzzleFastest: 'Las respuestas correctas más rápidas (hasta 5 puestos)',
    puzzleSettle: 'Resolver', puzzleExact: 'Por coincidencia exacta al cierre', puzzleManual: 'A mano',
    optionalGame: 'Partido (opcional)', noGame: 'Sin partido',
  },
})

type Meta = { currentWeek: number; season: number; sport: string; merged: boolean; lang: 'en' | 'es'; faabWeeklyCap: number; prizePhase?: SurvivorPrizePhase; prizePhaseRules?: SurvivorPrizePhaseRules }
type Row = { id: string; week: number; title: string; status: string; config: ChallengeBuilderConfig; answers: number; entrants: { id: string; name: string; answer: string }[]; resultSummary: string | null; autoSource: string }
type Game = { sport: string; homeAbbr: string; awayAbbr: string; homeLabel: string; awayLabel: string; kickoff: string }
type Player = { playerId: string; playerName: string; position: string; team: string | null; sport: string }
type Preview = { truthLabel: string | null; voided: boolean; places: { place: number; names: string[] }[]; payouts: { name: string; text: string; reason: string }[] }

type Draft = {
  title: string; question: string; kind: ChallengeBuilderKind; scope: 'individual' | 'tribe'; week: number
  opensAt: string; locksAt: string; optionsText: string; game: Game | null
  player: { playerId: string; playerName: string; sport: string } | null; stat: string; statWeek: number; line: string
  prizes: { place: number; rewards: ChallengePrizeReward[] }[]; deferWeeks: number
  penalty: 'none' | 'score_penalty' | 'faab_penalty'; penaltyAmount: string
  wagerOn: boolean; wagerCurrency: 'points' | 'faab'; wagerMin: string; wagerMax: string; winX: string; lossX: string
  uniqueAnswers: boolean; sealed: boolean; allOverRule: 'closest_overall' | 'no_winner'
  // The original league's kinds.
  position: string; positionPlayers: { playerId: string; label: string }[]
  props: { question: string; optionsText: string }[]; sweepTiered: boolean
  puzzleAnswer: string; puzzleMode: 'first_correct' | 'fastest'; puzzleSettle: 'exact' | 'manual'
}

const NUMBER_KINDS = new Set(['game_total_closest', 'closest_without_going_over', 'custom_number'])

function defaultReward(type: ChallengePrizeType): ChallengePrizeReward {
  switch (type) {
    case 'score_bonus': return { type, points: 10 }
    case 'faab_grant': return { type, amount: 10 }
    case 'faab_transfer': return { type, amount: 10, basis: 'per_member' }
    case 'tribemate_points': return { type, points: 20 }
    case 'free_trade_token': return { type, samePositionOnly: true }
    case 'steal_blocker': return { type }
    case 'steal': return { type, what: 'faab', amount: 10 }
    case 'advantage': return { type, powerType: 'extra_vote' }
    case 'immunity': return { type }
  }
}

function blankDraft(meta: Meta): Draft {
  const lock = new Date(Date.now() + 2 * 86_400_000)
  return {
    title: '', question: '', kind: 'game_total_closest', scope: 'individual', week: meta.currentWeek,
    opensAt: utcToEasternWallTime(new Date()), locksAt: utcToEasternWallTime(lock), optionsText: '', game: null,
    player: null, stat: 'fantasy_points', statWeek: meta.currentWeek, line: '',
    prizes: [{ place: 1, rewards: [defaultReward('faab_grant')] }], deferWeeks: 0,
    penalty: 'none', penaltyAmount: '10', wagerOn: false, wagerCurrency: 'points', wagerMin: '5', wagerMax: '50', winX: '1', lossX: '1',
    uniqueAnswers: false, sealed: false, allOverRule: 'closest_overall',
    position: meta.sport === 'NFL' ? 'QB' : '', positionPlayers: [],
    props: [{ question: '', optionsText: '' }, { question: '', optionsText: '' }], sweepTiered: false,
    puzzleAnswer: '', puzzleMode: 'first_correct', puzzleSettle: 'exact',
  }
}

function draftFromConfig(row: Row, meta: Meta): Draft {
  const c = row.config
  return {
    ...blankDraft(meta), title: row.title, question: c.question, kind: c.kind, scope: c.scope, week: row.week,
    opensAt: utcToEasternWallTime(c.opensAt), locksAt: utcToEasternWallTime(c.locksAt),
    optionsText: c.kind === 'custom_choice' || c.kind === 'first_td_scorer' ? c.options.map((o) => o.label).join('\n') : '', game: c.game,
    position: c.position?.position ?? '', positionPlayers: c.kind === 'position_leader' ? c.options.flatMap((o) => (o.playerId ? [{ playerId: o.playerId, label: o.label }] : [])) : [],
    props: c.props?.length ? c.props.map((p) => ({ question: p.question, optionsText: p.options.map((o) => o.label).join('\n') })) : [{ question: '', optionsText: '' }, { question: '', optionsText: '' }],
    sweepTiered: c.sweepTiered === true,
    puzzleAnswer: c.puzzle?.answer ?? '', puzzleMode: c.puzzle?.mode ?? 'first_correct', puzzleSettle: c.puzzle?.settle ?? 'exact',
    player: c.player ? { playerId: c.player.playerId, playerName: c.player.playerName, sport: c.player.sport } : null,
    stat: c.player?.stat ?? 'fantasy_points', statWeek: c.player?.statWeek ?? row.week, line: c.line == null ? '' : String(c.line),
    prizes: c.prizes, deferWeeks: c.deferWeeks,
    penalty: c.missPenalty?.type ?? 'none', penaltyAmount: c.missPenalty ? String(c.missPenalty.type === 'score_penalty' ? c.missPenalty.points : c.missPenalty.amount) : '10',
    wagerOn: Boolean(c.wager), wagerCurrency: c.wager?.currency ?? 'points', wagerMin: String(c.wager?.min ?? 5), wagerMax: String(c.wager?.max ?? 50),
    winX: String(c.wager?.winMultiplier ?? 1), lossX: String(c.wager?.lossFraction ?? 1),
    uniqueAnswers: c.uniqueAnswers, sealed: c.sealed, allOverRule: c.allOverRule,
  }
}

/** The draft in the shape the server validates. */
export function draftToInput(d: Draft, meta: Meta): Record<string, unknown> {
  const n = (s: string) => (s.trim() === '' ? NaN : Number(s))
  return {
    title: d.title, question: d.question, kind: d.kind, scope: d.scope, week: d.week, opensAt: d.opensAt, locksAt: d.locksAt,
    options: d.optionsText.split('\n').map((l) => l.trim()).filter(Boolean),
    game: d.game,
    player: d.player ? { ...d.player, season: meta.season, statWeek: d.statWeek, stat: d.stat } : null,
    line: d.line === '' ? null : n(d.line),
    prizes: d.prizes, deferWeeks: d.deferWeeks,
    missPenalty: d.penalty === 'none' ? null : d.penalty === 'score_penalty' ? { type: 'score_penalty', points: n(d.penaltyAmount) } : { type: 'faab_penalty', amount: n(d.penaltyAmount) },
    wager: d.wagerOn ? { currency: d.wagerCurrency, min: n(d.wagerMin), max: n(d.wagerMax), winMultiplier: n(d.winX), lossFraction: n(d.lossX) } : null,
    uniqueAnswers: d.uniqueAnswers, sealed: d.sealed, allOverRule: d.allOverRule,
    ...(d.kind === 'position_leader' ? {
      options: d.positionPlayers.map((p) => ({ playerId: p.playerId, label: p.label })),
      position: { sport: meta.sport, season: meta.season, statWeek: d.statWeek, position: d.position },
    } : {}),
    ...(d.kind === 'sweep' ? { props: d.props.map((p) => ({ question: p.question, options: p.optionsText.split('\n').map((l) => l.trim()).filter(Boolean) })), sweepTiered: d.sweepTiered } : {}),
    ...(d.kind === 'puzzle' ? { puzzle: { answer: d.puzzleAnswer, mode: d.puzzleMode, settle: d.puzzleSettle } } : {}),
  }
}

const inputCls = 'w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white'

function RewardEditor({ r, onChange, onRemove }: { r: ChallengePrizeReward; onChange: (next: ChallengePrizeReward) => void; onRemove: () => void }) {
  const m = useMessages(challengeBuilderMessages)
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 p-2">
      <select aria-label={m.prizes} value={r.type} onChange={(e) => onChange(defaultReward(e.target.value as ChallengePrizeType))} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white">
        {CHALLENGE_PRIZE_TYPES.map((t) => <option key={t} value={t}>{m.prizeTypes(t)}</option>)}
      </select>
      {'points' in r ? <input aria-label={m.points} type="number" min={0.5} step={0.5} value={r.points} onChange={(e) => onChange({ ...r, points: Number(e.target.value) } as ChallengePrizeReward)} className="w-20 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white" /> : null}
      {'amount' in r ? <input aria-label={m.amount} type="number" min={1} step={1} value={r.amount} onChange={(e) => onChange({ ...r, amount: Number(e.target.value) } as ChallengePrizeReward)} className="w-20 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white" /> : null}
      {r.type === 'faab_transfer' ? <select aria-label={m.basis} value={r.basis} onChange={(e) => onChange({ ...r, basis: e.target.value as 'per_member' | 'total' })} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white"><option value="per_member">{m.perMember}</option><option value="total">{m.total}</option></select> : null}
      {r.type === 'steal' ? <select aria-label={m.what} value={r.what} onChange={(e) => onChange({ ...r, what: e.target.value as 'faab' | 'points' })} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white"><option value="faab">FAAB</option><option value="points">{m.points}</option></select> : null}
      {r.type === 'advantage' ? <select aria-label={m.power} value={r.powerType} onChange={(e) => onChange({ ...r, powerType: e.target.value as typeof r.powerType })} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white">{SURVIVOR_REWARD_ADVANTAGE_POWERS.map((p) => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}</select> : null}
      {r.type === 'free_trade_token' ? <label className="text-xs text-white/70"><input type="checkbox" checked={r.samePositionOnly} onChange={(e) => onChange({ ...r, samePositionOnly: e.target.checked })} /> {m.samePos}</label> : null}
      <button type="button" onClick={onRemove} className="text-xs text-red-300">{m.remove}</button>
    </div>
  )
}

function ChallengeForm({ leagueId, meta, initial, editingId, onSaved, onClose }: { leagueId: string; meta: Meta; initial: Draft; editingId: string | null; onSaved: () => void; onClose: () => void }) {
  const m = useMessages(challengeBuilderMessages)
  const [d, setD] = useState<Draft>(initial)
  const [games, setGames] = useState<Game[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((cur) => ({ ...cur, [k]: v }))
  const optionalGame = d.kind === 'closest_without_going_over' || d.kind === 'first_td_scorer' || d.kind === 'last_score_type'
  const needsGame = d.kind === 'game_total_closest' || d.kind === 'pick_winner' || d.kind === 'game_total_over_under' || optionalGame
  const needsPlayer = d.kind === 'player_stat_over_under' || d.kind === 'anytime_td' || d.kind === 'position_leader'
  const playerSport = d.player?.sport ?? meta.sport
  // The sport's own stored stats first; the football list stays pickable, marked "settled by the commissioner".
  const statChoices = [...new Set([...challengeStatsForSport(playerSport), ...CHALLENGE_PLAYER_STATS])]
  useEffect(() => {
    if (!needsGame) return
    void fetch(`/api/survivor/commissioner?leagueId=${encodeURIComponent(leagueId)}&type=challenge_games&week=${d.week}`).then((r) => (r.ok ? r.json() : null)).then((j) => setGames(Array.isArray(j?.games) ? j.games : [])).catch(() => setGames([]))
  }, [leagueId, d.week, needsGame])
  useEffect(() => {
    if (!needsPlayer) return
    const t = setTimeout(() => {
      void fetch(`/api/survivor/commissioner?leagueId=${encodeURIComponent(leagueId)}&type=challenge_players&q=${encodeURIComponent(q)}`).then((r) => (r.ok ? r.json() : null)).then((j) => setPlayers(Array.isArray(j?.players) ? j.players : [])).catch(() => setPlayers([]))
    }, 250)
    return () => clearTimeout(t)
  }, [leagueId, q, needsPlayer])
  const input = useMemo(() => draftToInput(d, meta), [d, meta])
  const check = useMemo(() => validateChallengeDraft(input, { now: new Date(), currentWeek: Math.min(meta.currentWeek, d.week), merged: meta.merged, lang: meta.lang, faabWeeklyCap: meta.faabWeeklyCap, otherFaabThisWeek: 0, prizePhase: meta.prizePhase, prizePhaseRules: meta.prizePhaseRules }), [input, meta, d.week])
  // How this challenge will settle (sport-aware), said plainly before it is saved.
  const settlement = check.ok ? challengeSettlementSource(check.draft.config) : null
  async function save() {
    setBusy(true)
    setServerError(null)
    const res = await fetch('/api/survivor/commissioner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ leagueId, action: editingId ? 'challenge_update' : 'challenge_create', challengeId: editingId, challenge: input }) }).catch(() => null)
    const j = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    if (!res?.ok) setServerError(typeof j.error === 'string' ? j.error : m.failed)
    else onSaved()
  }
  const isNumber = NUMBER_KINDS.has(d.kind)
  return (
    <div className="space-y-3 rounded-xl border border-emerald-500/25 bg-black/20 p-3" data-testid="challenge-builder-form">
      <label className="block text-xs text-white/70">{m.title}<input className={inputCls} maxLength={120} value={d.title} onChange={(e) => set('title', e.target.value)} /></label>
      <label className="block text-xs text-white/70">{m.question}<textarea className={inputCls} rows={3} maxLength={1000} value={d.question} onChange={(e) => set('question', e.target.value)} /></label>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block text-xs text-white/70">{m.kind}
          <select className={inputCls} value={d.kind} onChange={(e) => set('kind', e.target.value as ChallengeBuilderKind)}>{CHALLENGE_BUILDER_KINDS.map((k) => <option key={k} value={k}>{m.kinds(k)}</option>)}</select>
        </label>
        <label className="block text-xs text-white/70">{m.scope}
          <select className={inputCls} value={d.scope} onChange={(e) => set('scope', e.target.value as 'individual' | 'tribe')}><option value="individual">{m.individual}</option>{!meta.merged ? <option value="tribe">{m.tribe}</option> : null}</select>
        </label>
        <label className="block text-xs text-white/70">{m.week}<input className={inputCls} type="number" min={meta.currentWeek} value={d.week} onChange={(e) => set('week', Number(e.target.value))} disabled={Boolean(editingId)} /></label>
        <label className="block text-xs text-white/70">{m.opens}<input className={inputCls} type="datetime-local" value={d.opensAt} onChange={(e) => set('opensAt', e.target.value)} /></label>
        <label className="block text-xs text-white/70">{m.locks}<input className={inputCls} type="datetime-local" value={d.locksAt} onChange={(e) => set('locksAt', e.target.value)} /></label>
      </div>
      {needsGame ? (
        <label className="block text-xs text-white/70">{optionalGame ? m.optionalGame : m.game}
          <select className={inputCls} value={d.game ? `${d.game.awayAbbr}@${d.game.homeAbbr}@${d.game.kickoff}` : ''} onChange={(e) => set('game', games.find((g) => `${g.awayAbbr}@${g.homeAbbr}@${g.kickoff}` === e.target.value) ?? null)}>
            <option value="">{optionalGame ? m.noGame : m.pickGame}</option>
            {[...(d.game && !games.some((g) => g.kickoff === d.game!.kickoff && g.homeAbbr === d.game!.homeAbbr) ? [d.game] : []), ...games].map((g) => <option key={`${g.awayAbbr}@${g.homeAbbr}@${g.kickoff}`} value={`${g.awayAbbr}@${g.homeAbbr}@${g.kickoff}`}>{g.awayLabel} @ {g.homeLabel} · {formatLocalTime(g.kickoff)}</option>)}
          </select>
        </label>
      ) : null}
      {needsPlayer ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block text-xs text-white/70">{m.searchPlayer}<input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {d.kind === 'position_leader' ? (
            <label className="block text-xs text-white/70">{m.position}<input className={inputCls} maxLength={4} value={d.position} onChange={(e) => set('position', e.target.value.toUpperCase())} data-testid="builder-position" /></label>
          ) : null}
          <label className="block text-xs text-white/70">{d.kind === 'position_leader' ? m.addPlayer : m.player}
            <select className={inputCls} value={d.kind === 'position_leader' ? '' : d.player?.playerId ?? ''} data-testid="builder-player" onChange={(e) => {
              const p = players.find((x) => x.playerId === e.target.value)
              if (d.kind === 'position_leader') {
                if (p && d.positionPlayers.length < 8 && !d.positionPlayers.some((x) => x.playerId === p.playerId)) set('positionPlayers', [...d.positionPlayers, { playerId: p.playerId, label: p.playerName }])
                return
              }
              set('player', p ? { playerId: p.playerId, playerName: p.playerName, sport: p.sport } : null)
            }}>
              <option value="">—</option>
              {[...(d.kind !== 'position_leader' && d.player && !players.some((p) => p.playerId === d.player!.playerId) ? [{ ...d.player, position: '', team: null }] : []), ...players]
                .filter((p) => d.kind !== 'position_leader' || !d.position || !p.position || p.position.toUpperCase().split(/[\/,\s]+/).includes(d.position))
                .map((p) => <option key={p.playerId} value={p.playerId}>{p.playerName}{p.position ? ` · ${p.position}` : ''}{p.team ? ` · ${p.team}` : ''}</option>)}
            </select>
          </label>
          {d.kind === 'player_stat_over_under' ? <label className="block text-xs text-white/70">{m.stat}<select className={inputCls} value={d.stat} onChange={(e) => set('stat', e.target.value)} data-testid="builder-stat">{statChoices.map((s) => <option key={s} value={s}>{playerStatSupported(playerSport, s) ? s.replace(/_/g, ' ') : m.statManual(s.replace(/_/g, ' '))}</option>)}</select></label> : null}
          <label className="block text-xs text-white/70">{m.statWeek}<input className={inputCls} type="number" min={0} value={d.statWeek} onChange={(e) => set('statWeek', Number(e.target.value))} /></label>
        </div>
      ) : null}
      {d.kind === 'game_total_over_under' || d.kind === 'player_stat_over_under' ? <label className="block text-xs text-white/70">{m.line}<input className={inputCls} type="number" step={0.5} value={d.line} onChange={(e) => set('line', e.target.value)} /></label> : null}
      {d.kind === 'position_leader' && d.positionPlayers.length ? (
        <div className="text-xs text-white/70" data-testid="builder-position-players">
          <p>{m.positionPlayers}</p>
          <ul className="mt-1 flex flex-wrap gap-2">{d.positionPlayers.map((p) => <li key={p.playerId} className="rounded border border-white/15 px-2 py-0.5">{p.label} <button type="button" className="text-red-300" onClick={() => set('positionPlayers', d.positionPlayers.filter((x) => x.playerId !== p.playerId))}>{m.remove}</button></li>)}</ul>
        </div>
      ) : null}
      {d.kind === 'custom_choice' || d.kind === 'first_td_scorer' ? <label className="block text-xs text-white/70">{m.options}<textarea className={inputCls} rows={4} value={d.optionsText} onChange={(e) => set('optionsText', e.target.value)} /></label> : null}
      {d.kind === 'sweep' ? (
        <fieldset className="space-y-2" data-testid="builder-sweep">
          <legend className="text-xs font-semibold text-white">{m.props}</legend>
          {d.props.map((p, i) => (
            <div key={i} className="space-y-1 rounded-lg border border-white/10 p-2">
              <p className="text-xs text-white/60">{m.prop(i + 1)}</p>
              <label className="block text-xs text-white/70">{m.propQuestion}<input className={inputCls} maxLength={300} value={p.question} onChange={(e) => set('props', d.props.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} /></label>
              <label className="block text-xs text-white/70">{m.propOptions}<textarea className={inputCls} rows={2} value={p.optionsText} onChange={(e) => set('props', d.props.map((x, j) => (j === i ? { ...x, optionsText: e.target.value } : x)))} /></label>
              {d.props.length > 2 ? <button type="button" className="text-xs text-red-300" onClick={() => set('props', d.props.filter((_, j) => j !== i))}>{m.remove}</button> : null}
            </div>
          ))}
          {d.props.length < 8 ? <button type="button" className="text-xs text-emerald-300" onClick={() => set('props', [...d.props, { question: '', optionsText: '' }])}>{m.addProp}</button> : null}
          <label className="block text-xs text-white/70"><input type="checkbox" checked={d.sweepTiered} onChange={(e) => set('sweepTiered', e.target.checked)} /> {m.tiered}</label>
        </fieldset>
      ) : null}
      {d.kind === 'puzzle' ? (
        <div className="grid gap-2 sm:grid-cols-3" data-testid="builder-puzzle">
          <label className="block text-xs text-white/70">{m.puzzleAnswer}<input className={inputCls} maxLength={200} value={d.puzzleAnswer} onChange={(e) => set('puzzleAnswer', e.target.value)} /></label>
          <label className="block text-xs text-white/70">{m.puzzleMode}<select className={inputCls} value={d.puzzleMode} onChange={(e) => set('puzzleMode', e.target.value as Draft['puzzleMode'])}><option value="first_correct">{m.puzzleFirst}</option><option value="fastest">{m.puzzleFastest}</option></select></label>
          <label className="block text-xs text-white/70">{m.puzzleSettle}<select className={inputCls} value={d.puzzleSettle} onChange={(e) => set('puzzleSettle', e.target.value as Draft['puzzleSettle'])}><option value="exact">{m.puzzleExact}</option><option value="manual">{m.puzzleManual}</option></select></label>
        </div>
      ) : null}
      {d.kind === 'closest_without_going_over' ? <label className="block text-xs text-white/70">{m.allOver}<select className={inputCls} value={d.allOverRule} onChange={(e) => set('allOverRule', e.target.value as Draft['allOverRule'])}><option value="closest_overall">{m.allOverClosest}</option><option value="no_winner">{m.allOverNone}</option></select></label> : null}

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-white">{m.prizes}</legend>
        {d.prizes.map((p, pi) => (
          <div key={p.place} className="space-y-1">
            <p className="text-xs text-white/60">{m.place(p.place)}</p>
            {p.rewards.map((r, ri) => (
              <RewardEditor key={ri} r={r}
                onChange={(next) => set('prizes', d.prizes.map((x, i) => (i === pi ? { ...x, rewards: x.rewards.map((y, j) => (j === ri ? next : y)) } : x)))}
                onRemove={() => set('prizes', d.prizes.map((x, i) => (i === pi ? { ...x, rewards: x.rewards.filter((_, j) => j !== ri) } : x)).filter((x) => x.rewards.length))} />
            ))}
            {p.rewards.length < 4 ? <button type="button" className="text-xs text-emerald-300" onClick={() => set('prizes', d.prizes.map((x, i) => (i === pi ? { ...x, rewards: [...x.rewards, defaultReward('score_bonus')] } : x)))}>{m.addReward}</button> : null}
          </div>
        ))}
        {(isNumber || (d.kind === 'sweep' && d.sweepTiered) || (d.kind === 'puzzle' && d.puzzleMode === 'fastest')) && d.prizes.length < 5 ? <button type="button" className="text-xs text-emerald-300" onClick={() => set('prizes', [...d.prizes, { place: d.prizes.length + 1, rewards: [defaultReward('score_bonus')] }])}>{m.addPlace}</button> : null}
        <label className="block text-xs text-white/70">{m.defer}<input className={inputCls} type="number" min={0} max={4} value={d.deferWeeks} onChange={(e) => set('deferWeeks', Number(e.target.value))} /></label>
      </fieldset>

      {!isNumber && d.kind !== 'puzzle' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs text-white/70">{m.penalty}
            <select className={inputCls} value={d.penalty} onChange={(e) => set('penalty', e.target.value as Draft['penalty'])}><option value="none">{m.none}</option><option value="score_penalty">{m.penPoints}</option><option value="faab_penalty">{m.penFaab}</option></select>
          </label>
          {d.penalty !== 'none' ? <label className="block text-xs text-white/70">{m.amount}<input className={inputCls} type="number" min={1} value={d.penaltyAmount} onChange={(e) => set('penaltyAmount', e.target.value)} /></label> : null}
          <label className="text-xs text-white/70"><input type="checkbox" checked={d.wagerOn} onChange={(e) => set('wagerOn', e.target.checked)} /> {m.wager}</label>
          {d.wagerOn ? (
            <div className="flex flex-wrap gap-2 text-xs text-white/70">
              <label>{m.wagerCur}<select className={inputCls} value={d.wagerCurrency} onChange={(e) => set('wagerCurrency', e.target.value as 'points' | 'faab')}><option value="points">{m.points}</option><option value="faab">FAAB</option></select></label>
              <label>{m.min}<input className={inputCls} type="number" value={d.wagerMin} onChange={(e) => set('wagerMin', e.target.value)} /></label>
              <label>{m.max}<input className={inputCls} type="number" value={d.wagerMax} onChange={(e) => set('wagerMax', e.target.value)} /></label>
              <label>{m.winX}<input className={inputCls} type="number" step={0.5} value={d.winX} onChange={(e) => set('winX', e.target.value)} /></label>
              <label>{m.lossX}<input className={inputCls} type="number" step={0.5} value={d.lossX} onChange={(e) => set('lossX', e.target.value)} /></label>
            </div>
          ) : null}
        </div>
      ) : null}
      <label className="block text-xs text-white/70"><input type="checkbox" checked={d.uniqueAnswers} onChange={(e) => set('uniqueAnswers', e.target.checked)} /> {m.unique}</label>
      <label className="block text-xs text-white/70"><input type="checkbox" checked={d.sealed} onChange={(e) => set('sealed', e.target.checked)} /> {m.sealed}</label>
      {settlement ? <p className="text-xs text-white/60" data-testid="challenge-builder-settles">{m.settles(settlement)}</p> : null}
      {!check.ok ? <p role="status" className="text-xs text-amber-200" data-testid="challenge-builder-error">{check.error.message}</p> : null}
      {serverError ? <p role="alert" className="text-xs text-red-300">{serverError}</p> : null}
      <div className="flex gap-2">
        <button type="button" disabled={!check.ok || busy} onClick={() => void save()} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-40">{busy ? m.saving : m.save}</button>
        <button type="button" onClick={onClose} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/80">{m.cancelEdit}</button>
      </div>
    </div>
  )
}

function SettlePanel({ leagueId, row, onDone }: { leagueId: string; row: Row; onDone: () => void }) {
  const m = useMessages(challengeBuilderMessages)
  const [mode, setMode] = useState<'data' | 'manual' | 'void'>(row.autoSource === 'manual' ? 'manual' : 'data')
  const [truth, setTruth] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picks, setPicks] = useState<Record<string, string>>({})
  const inputKind = challengeInputKind(row.config.kind)
  const manual = mode === 'data' ? null : mode === 'void' ? { void: true }
    : inputKind === 'number' ? { truth: { value: Number(truth) } }
      : inputKind === 'text' ? { truth: { text: truth } }
        : inputKind === 'sweep' ? { truth: { picks } }
          : { truth: { optionId: truth } }
  async function post(action: 'challenge_settle_preview' | 'challenge_settle') {
    setError(null)
    const res = await fetch('/api/survivor/commissioner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ leagueId, action, challengeId: row.id, manual, confirm: action === 'challenge_settle' }) }).catch(() => null)
    const j = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) { setError(typeof j.error === 'string' ? j.error : m.failed); return }
    if (action === 'challenge_settle_preview') { setPreview(j.preview ?? null); setPending(j.pending ?? null) } else onDone()
  }
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-amber-400/25 p-2" data-testid="challenge-settle-panel">
      <div className="flex flex-wrap gap-2 text-xs">
        {row.autoSource !== 'manual' ? <button type="button" aria-pressed={mode === 'data'} onClick={() => { setMode('data'); setPreview(null) }} className="rounded border border-white/15 px-2 py-1 text-white/80">{m.fromData}</button> : null}
        <button type="button" aria-pressed={mode === 'manual'} onClick={() => { setMode('manual'); setPreview(null) }} className="rounded border border-white/15 px-2 py-1 text-white/80">{NUMBER_KINDS.has(row.config.kind) ? m.trueValue : m.trueAnswer}</button>
        <button type="button" aria-pressed={mode === 'void'} onClick={() => { setMode('void'); setPreview(null) }} className="rounded border border-white/15 px-2 py-1 text-white/80">{m.voidIt}</button>
      </div>
      {mode === 'manual' ? (inputKind === 'number'
        ? <input aria-label={m.trueValue} type="number" className={inputCls} value={truth} onChange={(e) => setTruth(e.target.value)} />
        : inputKind === 'text'
          ? <input aria-label={m.trueAnswer} className={inputCls} maxLength={200} value={truth} onChange={(e) => setTruth(e.target.value)} />
          : inputKind === 'sweep'
            ? <div className="space-y-1">{(row.config.props ?? []).map((p) => (
              <label key={p.id} className="block text-xs text-white/70">{p.question}
                <select aria-label={p.question} className={inputCls} value={picks[p.id] ?? ''} onChange={(e) => setPicks((cur) => ({ ...cur, [p.id]: e.target.value }))}><option value="">—</option>{p.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
              </label>
            ))}</div>
            : <select aria-label={m.trueAnswer} className={inputCls} value={truth} onChange={(e) => setTruth(e.target.value)}><option value="">—</option>{row.config.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>) : null}
      <button type="button" onClick={() => void post('challenge_settle_preview')} className="rounded-lg border border-amber-300/40 px-3 py-1 text-sm text-amber-100">{m.preview}</button>
      {pending ? <p className="text-xs text-white/60">{pending === 'manual_only' ? m.manualOnly : m.pending(pending)}</p> : null}
      {preview && !pending ? (
        <div className="text-xs text-white/80" data-testid="challenge-settle-preview">
          {preview.truthLabel ? <p>{m.trueAnswer}: <b>{preview.truthLabel}</b></p> : null}
          {preview.places.map((p) => <p key={p.place}>{m.place(p.place)}: {p.names.join(', ')}</p>)}
          <p className="mt-1 font-semibold">{m.payouts}</p>
          {preview.payouts.length ? <ul>{preview.payouts.map((p, i) => <li key={i}>{p.name}: {p.text}</li>)}</ul> : <p>{m.nobody}</p>}
          <button type="button" onClick={() => void post('challenge_settle')} className="mt-2 rounded-lg bg-amber-400 px-3 py-1 text-sm font-semibold text-black">{m.confirm}</button>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : null}
    </div>
  )
}

export function SurvivorChallengeBuilderPanel({ leagueId }: { leagueId: string }) {
  const m = useMessages(challengeBuilderMessages)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null)
  const [settling, setSettling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    const res = await fetch(`/api/survivor/commissioner?leagueId=${encodeURIComponent(leagueId)}&type=challenges`, { cache: 'no-store' }).catch(() => null)
    const j = res?.ok ? await res.json().catch(() => null) : null
    setRows(Array.isArray(j?.challenges) ? j.challenges : [])
    setMeta(j?.meta ?? null)
  }, [leagueId])
  useEffect(() => { void load() }, [load])
  async function act(action: string, challengeId: string) {
    setError(null)
    const res = await fetch('/api/survivor/commissioner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ leagueId, action, challengeId }) }).catch(() => null)
    if (!res?.ok) { const j = res ? await res.json().catch(() => ({})) : {}; setError(typeof j.error === 'string' ? j.error : m.failed) }
    await load()
  }
  return (
    <div className="space-y-3" data-testid="survivor-challenge-builder">
      <div>
        <h3 className="text-sm font-semibold text-white">{m.heading}</h3>
        <p className="text-xs text-white/55">{m.sub}</p>
      </div>
      {meta && !editing ? <button type="button" onClick={() => setEditing({ id: null, draft: blankDraft(meta) })} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-black">{m.newChallenge}</button> : null}
      {meta && editing ? <ChallengeForm leagueId={leagueId} meta={meta} initial={editing.draft} editingId={editing.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} /> : null}
      {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : null}
      <ul className="space-y-2">
        {(rows ?? []).map((row) => (
          <li key={row.id} className="rounded-xl border border-white/10 bg-black/20 p-3" data-testid={`builder-row-${row.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-white">W{row.week} · {row.title}</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">{m.status(row.status)}</span>
              <span className="text-[11px] text-white/50">{m.kinds(row.config.kind)} · {m.answers(row.answers)} · {formatLocalTime(row.config.locksAt)}</span>
            </div>
            {row.status !== 'complete' && row.status !== 'cancelled' ? <p className="mt-1 text-[11px] text-white/45" data-testid={`builder-row-settles-${row.id}`}>{m.settles(row.autoSource)}</p> : null}
            {row.resultSummary ? <p className="mt-1 text-xs text-white/70">{row.resultSummary}</p> : null}
            {row.entrants.length ? <details className="mt-1 text-xs text-white/60"><summary>{m.answers(row.entrants.length)}</summary><ul>{row.entrants.map((e) => <li key={e.id}>{e.name}: {e.answer}</li>)}</ul></details> : null}
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {(row.status === 'scheduled' || row.status === 'open') && meta ? <button type="button" onClick={() => setEditing({ id: row.id, draft: draftFromConfig(row, meta) })} className="rounded border border-white/15 px-2 py-1 text-white/80">{m.edit}</button> : null}
              {row.status === 'scheduled' ? <button type="button" onClick={() => void act('challenge_open', row.id)} className="rounded border border-white/15 px-2 py-1 text-white/80">{m.openNow}</button> : null}
              {row.status === 'open' ? <button type="button" onClick={() => void act('challenge_lock', row.id)} className="rounded border border-white/15 px-2 py-1 text-white/80">{m.lockNow}</button> : null}
              {row.status === 'locked' ? <button type="button" onClick={() => setSettling(settling === row.id ? null : row.id)} className="rounded border border-amber-300/40 px-2 py-1 text-amber-100">{m.settle}</button> : null}
              {row.status === 'complete' ? <button type="button" onClick={() => { if (window.confirm(m.reverse)) void act('challenge_reverse', row.id) }} className="rounded border border-red-300/40 px-2 py-1 text-red-200">{m.reverse}</button> : null}
              {row.status !== 'complete' && row.status !== 'cancelled' && row.status !== 'settling' ? <button type="button" onClick={() => { if (window.confirm(m.cancel)) void act('challenge_cancel', row.id) }} className="rounded border border-white/15 px-2 py-1 text-white/60">{m.cancel}</button> : null}
            </div>
            {settling === row.id && row.status === 'locked' ? <SettlePanel leagueId={leagueId} row={row} onDone={() => { setSettling(null); void load() }} /> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
