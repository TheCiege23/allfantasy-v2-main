import { defineMessages } from '@/lib/i18n/messages'

/**
 * The home's own panels (components/core-app/home/HomePanels.tsx): the filtered-home note, the empty
 * scope, the read failure and the customize link. Every string is the one the panels printed before
 * the move, byte for byte, in both languages — this is a relocation, not a rewrite. (The empty
 * scope's English quotes were JSX `&ldquo;`/`&rdquo;`; they are the same rendered characters here.)
 */
export const homePanelsMessages = defineMessages({
  en: {
    showAllLeagues: 'Show all leagues',
    showing: 'Showing ',
    scopeCount: (count: number, total: number) =>
      ` — ${count} of ${total} ${total === 1 ? 'league' : 'leagues'}. Everything below covers only these.`,
    noLeaguesInView: 'No leagues in this view',
    noneMatch: (label: string) => `None of your leagues match “${label}”`,
    favHint: ' — star a league in the league picker at the top to add it here',
    yourLeagues: 'Your leagues',
    readFailure: 'We could not read your leagues just now. This is a read failure on our side, not a sign that you have none.',
    sectionsHidden: (n: number) => `${n} ${n === 1 ? 'section' : 'sections'} hidden · Choose what shows here →`,
    tooMuch: 'Too much? Choose what shows here →',
  },
  es: {
    showAllLeagues: 'Mostrar todas las ligas',
    showing: 'Mostrando ',
    scopeCount: (count, total) => `: ${count} de ${total} ${total === 1 ? 'liga' : 'ligas'}. Todo lo de abajo cubre solo estas.`,
    noLeaguesInView: 'No hay ligas en esta vista',
    noneMatch: (label) => `Ninguna de tus ligas coincide con «${label}»`,
    favHint: ': marca una liga con una estrella en el selector de ligas de arriba para añadirla aquí',
    yourLeagues: 'Tus ligas',
    readFailure: 'No pudimos leer tus ligas en este momento. Es un fallo de lectura de nuestra parte, no una señal de que no tengas ninguna.',
    sectionsHidden: (n) => `${n} ${n === 1 ? 'sección oculta' : 'secciones ocultas'} · Elegir qué se muestra aquí →`,
    tooMuch: '¿Demasiado? Elige qué se muestra aquí →',
  },
})
