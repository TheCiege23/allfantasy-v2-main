import { defineMessages } from '@/lib/i18n/messages'

/**
 * The My team guide (components/core-app/screens/MyTeam.tsx, lib/core-app/myTeamGuide.ts).
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): a waiver
 * claim is «reclamo», the pool is «agentes libres», and no Spanish value says «waiver».
 */
export const myTeamGuideMessages = defineMessages({
  en: {
    eyebrow: (league: string) => `My team · ${league}`,
    headAuto: 'Best Ball sets your lineup for you',
    headFix: (n: number) => `Fix ${n} ${n === 1 ? 'starter' : 'starters'} before kickoff`,
    headQuestionable: (n: number) => `Your lineup is set · ${n} ${n === 1 ? 'starter is' : 'starters are'} questionable`,
    headBetter: (gain: string) => `Your lineup is set · your best lineup adds +${gain}`,
    headSet: 'Your lineup is set',
    headUnknown: 'Your team this week',
    intro: (platform: string) =>
      `Check your lineup before kickoff, see what to change, and how you stack up this week. Lineup changes are made on ${platform}.`,
    introAuto: 'See who’s healthy, who’s on bye, and how deep your roster is. Best Ball picks your scoring lineup each week.',
    chipCheck: 'Starters to check',
    chipKickoff: 'Next kickoff',
    chipProjected: 'Projected, you vs them',
    whatToDo: 'What to do',
    why: 'Why it matters',
    decisionTeach:
      'A starter who’s out or on bye scores zero, and a questionable one might. Line up a backup before his game locks — after that the lineup can’t change.',
    askChimmy: 'Ask Chimmy about my lineup',
    chimmyPrompt: (league: string) => `Look at my lineup in ${league}. Who should I start this week, and who needs a backup?`,
    everySeat: (n: number) => `Every seat change (${n})`,
    byesNames: (n: number) => `${n} off`,
  },
  es: {
    eyebrow: (league: string) => `Mi equipo · ${league}`,
    headAuto: 'Best Ball arma tu alineación por ti',
    headFix: (n: number) => `Corrige ${n} ${n === 1 ? 'titular' : 'titulares'} antes del inicio`,
    headQuestionable: (n: number) => `Tu alineación está lista · ${n} ${n === 1 ? 'titular en duda' : 'titulares en duda'}`,
    headBetter: (gain: string) => `Tu alineación está lista · tu mejor alineación suma +${gain}`,
    headSet: 'Tu alineación está lista',
    headUnknown: 'Tu equipo esta semana',
    intro: (platform: string) =>
      `Revisa tu alineación antes del inicio, mira qué cambiar y cómo te comparas esta semana. Los cambios de alineación se hacen en ${platform}.`,
    introAuto: 'Mira quién está sano, quién descansa y qué tan profunda es tu plantilla. Best Ball elige tu alineación cada semana.',
    chipCheck: 'Titulares por revisar',
    chipKickoff: 'Próximo inicio',
    chipProjected: 'Proyección, tú contra ellos',
    whatToDo: 'Qué hacer',
    why: 'Por qué importa',
    decisionTeach:
      'Un titular descartado o en descanso suma cero, y uno en duda podría hacerlo. Ten un suplente listo antes de que su partido se bloquee; después la alineación ya no cambia.',
    askChimmy: 'Pregunta a Chimmy por mi alineación',
    chimmyPrompt: (league: string) => `Mira mi alineación en ${league}. ¿A quién debo alinear esta semana y quién necesita suplente?`,
    everySeat: (n: number) => `Todos los cambios de puesto (${n})`,
    byesNames: (n: number) => `${n} descansan`,
  },
})
