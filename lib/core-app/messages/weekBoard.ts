import { defineMessages } from '@/lib/i18n/messages'

/**
 * Your week board (components/core-app/boards/WeekBoard.tsx).
 * Every string is the one the component wrote before the move, byte for byte, in both languages — a
 * relocation, not a rewrite. Imports nothing at runtime; numbers arrive raw and are formatted here
 * exactly as the component formatted them (`toFixed(1)`), and a value the component ran through
 * coreUiCopy arrives already translated.
 */
export const weekBoardMessages = defineMessages({
  en: {
    // ── MatchRow ──
    winChance: (win: number) => `${win}% to win`,
    /** `resultLocalized` is `result` through coreUiCopy; English prints the raw word. */
    liveValueLabel: (p: { sign: string; abs: string; you: number; them: number; result: string | null; resultLocalized: string | null }) =>
      `${p.sign}${p.abs} on the scoreboard, ${p.you.toFixed(1)} to ${p.them.toFixed(1)}${p.result ? ` — you ${p.result}` : ' so far'}`,
    estimateValueLabel: (sign: string, abs: string, win: number) => `${sign}${abs} historical scoring estimate, ${win}% to win`,
    period: 'Period',
    playoffOddsSuffix: (pct: string, longShot: boolean) => ` · ${pct} playoff odds${longShot ? ' · long shot' : ''}`,
    lowestEliminated: ' · lowest score is eliminated',
    // ── WeekBoard ──
    blurb: 'Your priorities first, then close matchups within each league’s scoring. Every league stays available.',
    leadingLabel: 'Leading · first 5',
    leadingQuiet: 'No league is ahead on its available scoreboard or historical estimate.',
    trailingLabel: 'Trailing · first 5',
    trailingQuiet: 'No league is behind on its available data.',
    shownOf: (shown: number, total: number) => `${shown} of ${total}`,
    formPerWeek: (you: number, them: number) => ` · ${you.toFixed(1)} to ${them.toFixed(1)} per week`,
    formAria: (you: number, them: number, weeks: number) =>
      `You have averaged ${you.toFixed(1)} points a week to their ${them.toFixed(1)}, over ${weeks} scored ${weeks === 1 ? 'week' : 'weeks'} — form so far, not a projection`,
    formWeeksAbbrev: 'wk',
    sampleAria: (weeks: number, needed: number) => `${weeks} of ${needed} completed weeks needed to project this matchup`,
    // ── elimination rows ──
    elimSummary: (rank: number | null | undefined, fieldSize: number, cutLine: number | null | undefined) =>
      `${rank != null ? `${rank} of ${fieldSize}` : `${fieldSize} scored`}${cutLine != null ? ` · cut line ${cutLine.toFixed(1)}` : ''}`,
    elimAria: (p: { onTheBlock: boolean; yourScore: number | null | undefined; fieldSize: number; margin: number; cutLine: number | null | undefined }) =>
      p.onTheBlock
        ? `Your ${p.yourScore?.toFixed(1)} is the lowest score in a field of ${p.fieldSize} — you are the one eliminated as it stands`
        : `Your ${p.yourScore?.toFixed(1)} is ${p.margin.toFixed(1)} points clear of the cut line of ${p.cutLine?.toFixed(1)}`,
    // ── the notes ──
    fittedOn: (sample: string) => `Fitted on ${sample} roster-weeks.`,
    lowOddsNote: ' Low playoff odds never hide leagues or prove mathematical elimination. Point margins from different sports are not compared with each other.',
    unprojectedMore: (n: number) => `${n} more could not be projected either — too few completed weeks on one side or the other. `,
    withoutSchedule: (n: number) => `${n} carry no schedule for this week at all.`,
  },
  es: {
    winChance: (win) => `${win}% de ganar`,
    liveValueLabel: (p) =>
      `${p.sign}${p.abs} en el marcador, ${p.you.toFixed(1)} a ${p.them.toFixed(1)}${p.result ? ` — ${p.resultLocalized}` : ' hasta ahora'}`,
    estimateValueLabel: (sign, abs, win) => `${sign}${abs} de diferencia histórica estimada, ${win}% de ganar según el historial`,
    period: 'Período',
    playoffOddsSuffix: (pct, longShot) => ` · ${pct} de entrar en playoffs${longShot ? ' · pocas probabilidades' : ''}`,
    lowestEliminated: ' · se elimina la puntuación más baja',
    blurb: 'Tus prioridades primero; después, enfrentamientos ajustados dentro de la puntuación de cada liga. Todas las ligas siguen disponibles.',
    leadingLabel: 'Por delante · primeras 5',
    leadingQuiet: 'Ninguna liga está por delante en el marcador o la estimación histórica disponible.',
    trailingLabel: 'Por detrás · primeras 5',
    trailingQuiet: 'Ninguna liga está por detrás en sus datos disponibles.',
    shownOf: (shown, total) => `${shown} de ${total}`,
    formPerWeek: (you, them) => ` · ${you.toFixed(1)} a ${them.toFixed(1)} por semana`,
    formAria: (you, them, weeks) =>
      `Promedias ${you.toFixed(1)} puntos por semana frente a ${them.toFixed(1)} de tu rival, durante ${weeks} semanas puntuadas; es una tendencia, no una proyección`,
    formWeeksAbbrev: ' sem.',
    sampleAria: (weeks, needed) => `${weeks} de ${needed} semanas completas necesarias para pronosticar este enfrentamiento`,
    elimSummary: (rank, fieldSize, cutLine) =>
      `${rank != null ? `${rank}.º de ${fieldSize}` : `${fieldSize} con puntos`}${cutLine != null ? ` · corte ${cutLine.toFixed(1)}` : ''}`,
    elimAria: (p) =>
      p.onTheBlock
        ? `Tus ${p.yourScore?.toFixed(1)} puntos son la puntuación más baja entre ${p.fieldSize} equipos; por ahora quedas eliminado`
        : `Tus ${p.yourScore?.toFixed(1)} puntos están ${p.margin.toFixed(1)} por encima del corte de ${p.cutLine?.toFixed(1)}`,
    fittedOn: (sample) => `Modelo ajustado con ${sample} semanas de equipos.`,
    lowOddsNote: ' Las probabilidades bajas no ocultan ligas ni prueban una eliminación matemática. Los márgenes de deportes distintos no se comparan entre sí.',
    unprojectedMore: (n) => `${n} más no tienen pronóstico porque faltan semanas completas de uno o ambos equipos. `,
    withoutSchedule: (n) => `${n} no tienen calendario esta semana.`,
  },
})
