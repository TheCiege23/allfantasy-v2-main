import { defineMessages } from '@/lib/i18n/messages'
import { ordinalEn } from '@/lib/core-app/standingsGuide'

/**
 * One league's Draft HQ guide (components/core-app/screens/DraftHq.tsx, DraftArchive.tsx as Draft HQ,
 * lib/core-app/draftHqLeagueGuide.ts).
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): «draft»,
 * «selección», «ronda»; no Spanish value says «waiver».
 */
const awayEn = (n: number | null) => (n != null && n > 0 ? ` (${n} ${n === 1 ? 'pick' : 'picks'} away)` : '')
const awayEs = (n: number | null) => (n != null && n > 0 ? ` (faltan ${n})` : '')

export const draftHqLeagueGuideMessages = defineMessages({
  en: {
    eyebrow: (league: string) => `Draft HQ · ${league}`,
    headNone: 'Draft HQ',
    headYourPick: (label: string | null) => (label ? `You’re on the clock — pick ${label}` : 'You’re on the clock'),
    headPaused: (yours: boolean, next: string | null) =>
      yours ? 'Paused — it’s your pick when it resumes' : next ? `Paused · your next pick is ${next}` : 'This draft is paused',
    headLive: (pick: number | null, total: number | null, next: string | null, away: number | null) =>
      `${pick != null ? `Pick ${pick}${total != null ? ` of ${total}` : ''}` : 'Drafting now'} · ${next ? `your next pick is ${next}${awayEn(away)}` : 'you have no picks left'}`,
    headBefore: (slot: number | null, teams: number | null) =>
      slot != null ? `Not started · you pick ${ordinalEn(slot)}${teams != null ? ` of ${teams}` : ''}` : 'Not started yet',
    headDone: (drafted: number | null) =>
      drafted != null && drafted > 0 ? `Draft done · you drafted ${drafted} ${drafted === 1 ? 'player' : 'players'}` : 'This draft is done',
    introBefore: 'Your home for this league’s draft: when you pick, your queue and your prep. The board goes live here when the draft starts.',
    introLive: 'The draft is on. Join the draft room to make your picks — the board is below, then your picks and queue.',
    introPaused: 'The draft is paused. When it resumes, join the draft room to pick — your picks and queue are below.',
    introDone: 'The draft is over. Here’s what you drafted, how every team graded and the full board.',
    seeBoard: 'See the board',
    seeFullBoard: 'See the full board',
    picksSummary: (n: number, labels: string[]) =>
      `${n} ${n === 1 ? 'pick' : 'picks'} · ${labels.slice(0, 6).join(', ')}${n > 6 ? ` +${n - 6} more` : ''}`,
    showEveryPick: 'Show every pick',
    later: 'Grades, the full board and your results show here once the draft is done.',
    prepTools: 'Prep tools — ADP, mock drafts and outlook',
    impDrafting: (platform: string, picks: number) => `Drafting on ${platform} · ${picks} ${picks === 1 ? 'pick' : 'picks'} made`,
    impDone: (platform: string, picks: number, season: number | null) =>
      `${season != null ? `${season} draft` : 'Draft'} done on ${platform} · ${picks} ${picks === 1 ? 'pick' : 'picks'}`,
    impBefore: (platform: string) => `Not started on ${platform}`,
    impOther: (status: string) => `Draft status: ${status}`,
    /** When the page could not name the platform the draft runs on. */
    impPlatformFallback: 'the platform',
    impIntro: (platform: string) =>
      `This draft runs on ${platform} — make your picks there. Here is our record of it: every pick, who made it, and how it compares.`,
  },
  es: {
    eyebrow: (league) => `Centro del draft · ${league}`,
    headNone: 'Centro del draft',
    headYourPick: (label) => (label ? `Te toca elegir — selección ${label}` : 'Te toca elegir'),
    headPaused: (yours, next) =>
      yours ? 'En pausa — al reanudarse te toca a ti' : next ? `En pausa · tu próxima selección es la ${next}` : 'Este draft está en pausa',
    headLive: (pick, total, next, away) =>
      `${pick != null ? `Selección ${pick}${total != null ? ` de ${total}` : ''}` : 'Draft en curso'} · ${next ? `tu próxima es la ${next}${awayEs(away)}` : 'ya no te quedan selecciones'}`,
    headBefore: (slot, teams) =>
      slot != null ? `Sin empezar · eliges ${slot}.º${teams != null ? ` de ${teams}` : ''}` : 'Aún no ha empezado',
    headDone: (drafted) =>
      drafted != null && drafted > 0 ? `Draft terminado · elegiste ${drafted} ${drafted === 1 ? 'jugador' : 'jugadores'}` : 'Este draft ha terminado',
    introBefore: 'Tu centro para el draft de esta liga: cuándo eliges, tu cola y tu preparación. El tablero se activa aquí cuando empieza el draft.',
    introLive: 'El draft está en marcha. Entra a la sala del draft para elegir: abajo está el tablero, y después tus selecciones y tu cola.',
    introPaused: 'El draft está en pausa. Cuando se reanude, entra a la sala del draft para elegir: tus selecciones y tu cola están abajo.',
    introDone: 'El draft terminó. Aquí ves lo que elegiste, la nota de cada equipo y el tablero completo.',
    seeBoard: 'Ver el tablero',
    seeFullBoard: 'Ver el tablero completo',
    picksSummary: (n, labels) =>
      `${n} ${n === 1 ? 'selección' : 'selecciones'} · ${labels.slice(0, 6).join(', ')}${n > 6 ? ` y ${n - 6} más` : ''}`,
    showEveryPick: 'Ver todas las selecciones',
    later: 'Las notas, el tablero completo y tus resultados aparecen aquí cuando termine el draft.',
    prepTools: 'Herramientas de preparación: ADP, drafts de prueba y perspectiva',
    impDrafting: (platform, picks) => `Draft en curso en ${platform} · ${picks} ${picks === 1 ? 'selección hecha' : 'selecciones hechas'}`,
    impDone: (platform, picks, season) =>
      `${season != null ? `Draft ${season}` : 'Draft'} terminado en ${platform} · ${picks} ${picks === 1 ? 'selección' : 'selecciones'}`,
    impBefore: (platform) => `Sin empezar en ${platform}`,
    impOther: (status) => `Estado del draft: ${status}`,
    impPlatformFallback: 'la plataforma',
    impIntro: (platform) =>
      `Este draft se juega en ${platform}: haz tus selecciones allí. Aquí está nuestro registro: cada selección, quién la hizo y cómo se compara.`,
  },
})
