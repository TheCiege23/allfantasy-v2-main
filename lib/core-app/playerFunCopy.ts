import type { ExposureTier, Form } from './playerFun'

/**
 * Words for the Finder's fun layer (playerFun.ts, weeklyMvp.ts) and the trending "add him" prompt
 * (2026-10-08). Pure, client-safe; English and Spanish.
 */

export type PlayerFunCopy = {
  exposure: (pct: number, tier: ExposureTier) => string
  exposureTitle: (leagues: number, of: number, pct: number) => string
  form: (call: Form['call']) => string | null
  formTitle: (recent: number, season: number) => string
  flipsTitle: string
  flipsSub: string
  flipIn: (league: string) => string
  flipStarting: string
  flipBench: string
  flipPickA: (name: string) => string
  flipAgree: string
  flipDisagree: string
  flipLean: (name: string, margin: string) => string
  flipEven: string
  flipSetLineup: (platform: string) => string
  flipAgain: string
  mvpKicker: (week: number) => string
  mvpPoints: (pts: string, leagues: number) => string
  mvpBeat: (name: string, by: string) => string
  mvpShare: string
  mvpShared: string
  mvpCopied: string
  mvpShareText: (week: number, name: string, pts: string, leagues: number) => string
  trendFree: (n: number) => string
  trendFreeLabel: (name: string, n: number) => string
}

const TIER_EN: Record<ExposureTier, string> = { core: 'Core piece', big: 'Big bet', piece: 'Solid stake', sprinkle: 'Sprinkle' }
const TIER_ES: Record<ExposureTier, string> = { core: 'Pieza clave', big: 'Gran apuesta', piece: 'Buena parte', sprinkle: 'Pizca' }

const leaguesEn = (n: number) => (n === 1 ? 'league' : 'leagues')
const leaguesEs = (n: number) => (n === 1 ? 'liga' : 'ligas')

const EN: PlayerFunCopy = {
  exposure: (pct, tier) => `${pct}% exposure · ${TIER_EN[tier]}`,
  exposureTitle: (n, of, pct) => `You roster him in ${n} of your ${of} ${leaguesEn(of)} — ${pct}% of your fantasy life rides on him.`,
  form: (c) => (c === 'hot' ? '🔥 Hot' : c === 'cold' ? '🧊 Cold' : null),
  formTitle: (r, s) => `Last 3 games: ${r} pts a game · season: ${s}`,
  flipsTitle: 'Coin flips',
  flipsSub: 'Close calls in your lineups — tap who you would start, then see our lean.',
  flipIn: (l) => `In ${l}`,
  flipStarting: 'starting',
  flipBench: 'bench',
  flipPickA: (n) => `Start ${n}`,
  flipAgree: 'Great minds ✅',
  flipDisagree: 'Bold call 👀',
  flipLean: (n, m) => `We lean ${n} by ${m} pts.`,
  flipEven: 'Dead even on our numbers.',
  flipSetLineup: (p) => `Set lineup in ${p}`,
  flipAgain: 'Change pick',
  mvpKicker: (w) => `Your Week ${w} MVP`,
  mvpPoints: (p, n) => `${p} pts for you across ${n} ${leaguesEn(n)}`,
  mvpBeat: (n, by) => `${by} pts clear of ${n}`,
  mvpShare: 'Share',
  mvpShared: 'Shared',
  mvpCopied: 'Copied — paste it anywhere',
  mvpShareText: (w, name, p, n) => `🏆 My Week ${w} fantasy MVP: ${name} — ${p} pts across ${n} ${leaguesEn(n)}. Tracked on AllFantasy.`,
  trendFree: (n) => `Free in ${n} of yours · add`,
  trendFreeLabel: (name, n) => `${name} is free in ${n} of your ${leaguesEn(n)} — see where to add him`,
}

const ES: PlayerFunCopy = {
  exposure: (pct, tier) => `${pct}% de exposición · ${TIER_ES[tier]}`,
  exposureTitle: (n, of, pct) => `Lo tienes en ${n} de tus ${of} ${leaguesEs(of)}: el ${pct}% de tu fantasy depende de él.`,
  form: (c) => (c === 'hot' ? '🔥 En racha' : c === 'cold' ? '🧊 Frío' : null),
  formTitle: (r, s) => `Últimos 3 partidos: ${r} pts por partido · temporada: ${s}`,
  flipsTitle: 'A cara o cruz',
  flipsSub: 'Decisiones ajustadas en tus alineaciones: toca a quién alinearías y mira nuestra opinión.',
  flipIn: (l) => `En ${l}`,
  flipStarting: 'titular',
  flipBench: 'banca',
  flipPickA: (n) => `Alinear a ${n}`,
  flipAgree: 'Pensamos igual ✅',
  flipDisagree: 'Apuesta valiente 👀',
  flipLean: (n, m) => `Nos inclinamos por ${n} por ${m} pts.`,
  flipEven: 'Empate total según nuestros números.',
  flipSetLineup: (p) => `Ajustar alineación en ${p}`,
  flipAgain: 'Cambiar elección',
  mvpKicker: (w) => `Tu MVP de la semana ${w}`,
  mvpPoints: (p, n) => `${p} pts para ti en ${n} ${leaguesEs(n)}`,
  mvpBeat: (n, by) => `${by} pts por delante de ${n}`,
  mvpShare: 'Compartir',
  mvpShared: 'Compartido',
  mvpCopied: 'Copiado: pégalo donde quieras',
  mvpShareText: (w, name, p, n) => `🏆 Mi MVP de fantasy de la semana ${w}: ${name}, ${p} pts en ${n} ${leaguesEs(n)}. Seguido en AllFantasy.`,
  trendFree: (n) => `Libre en ${n} de las tuyas · fichar`,
  trendFreeLabel: (name, n) => `${name} está libre en ${n} de tus ${leaguesEs(n)}: mira dónde ficharlo`,
}

export function playerFunCopy(language: string): PlayerFunCopy {
  return language === 'es' ? ES : EN
}
