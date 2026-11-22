import { defineMessages } from '@/lib/i18n/messages'

/**
 * Chrome for the per-screen guide strip (components/core-app/ScreenGuide.tsx) and the
 * "How AllFantasy works" sheet (components/core-app/HowItWorks.tsx). The per-page text itself is in
 * lib/core-app/screenGuides.ts. Spanish follows the app's wording rulings — see that file's header.
 */
export const screenGuideMessages = defineMessages({
  en: {
    whatsThis: 'What’s this page?',
    youCan: 'You can',
    startHere: 'Start here:',
    gotIt: 'Got it',
    showGuide: 'Show what this page does',
    hideGuide: 'Hide',
    everyPage: 'How every page works',
    howItWorks: 'How it works',
    howItWorksAria: 'How AllFantasy works — every page explained',
    sheetTitle: 'How AllFantasy works',
    sheetIntro: 'AllFantasy reads your leagues and tells you what to do next. Here is every page, in plain words.',
    close: 'Close',
    startTitle: 'Getting started',
    step1: 'Import your leagues. AllFantasy reads them and never changes anything on your platform.',
    step2: 'Pick one league in the switcher at the top — or “All leagues” to see everything together.',
    step3: 'Each week, open Your week and do today’s step. Ask Chimmy whenever you are unsure.',
    importAction: 'Import a league',
    groupWeek: 'Every week',
    groupWeekSub: 'The pages you use to set lineups and win this week.',
    groupLeague: 'Inside one league',
    groupLeagueSub: 'Everything about the league you have selected.',
    groupAll: 'Across all your leagues',
    groupAllSub: 'Pages that look at every league at once.',
    open: 'Open',
    pickLeagueFirst: 'Pick a league first',
    chimmyTitle: 'Ask Chimmy',
    chimmyBody: 'Chimmy is on every page. Inside a league it knows that league’s rules, rosters and schedule; on Home it compares all your leagues.',
    helpLine: 'Still stuck? Message us from the Help page and a person will reply.',
    helpAction: 'Get help',
  },
  es: {
    whatsThis: '¿Qué es esta página?',
    youCan: 'Puedes',
    startHere: 'Empieza aquí:',
    gotIt: 'Entendido',
    showGuide: 'Mostrar qué hace esta página',
    hideGuide: 'Ocultar',
    everyPage: 'Cómo funciona cada página',
    howItWorks: 'Cómo funciona',
    howItWorksAria: 'Cómo funciona AllFantasy: cada página explicada',
    sheetTitle: 'Cómo funciona AllFantasy',
    sheetIntro: 'AllFantasy lee tus ligas y te dice qué hacer después. Aquí está cada página, en palabras simples.',
    close: 'Cerrar',
    startTitle: 'Para empezar',
    step1: 'Importa tus ligas. AllFantasy las lee y nunca cambia nada en tu plataforma.',
    step2: 'Elige una liga en el selector de arriba, o «Todas las ligas» para verlas juntas.',
    step3: 'Cada semana abre Tu semana y haz el paso de hoy. Pregúntale a Chimmy si tienes dudas.',
    importAction: 'Importar una liga',
    groupWeek: 'Cada semana',
    groupWeekSub: 'Las páginas para armar tu alineación y ganar esta semana.',
    groupLeague: 'Dentro de una liga',
    groupLeagueSub: 'Todo sobre la liga que tienes seleccionada.',
    groupAll: 'En todas tus ligas',
    groupAllSub: 'Páginas que miran todas tus ligas a la vez.',
    open: 'Abrir',
    pickLeagueFirst: 'Primero elige una liga',
    chimmyTitle: 'Pregúntale a Chimmy',
    chimmyBody: 'Chimmy está en cada página. Dentro de una liga conoce sus reglas, plantillas y calendario; en Inicio compara todas tus ligas.',
    helpLine: '¿Sigues con dudas? Escríbenos desde la página de Ayuda y te responderá una persona.',
    helpAction: 'Obtener ayuda',
  },
})

/** The window event that opens the sheet from anywhere in the shell (the strip's "How every page works"). */
export const OPEN_HOW_IT_WORKS_EVENT = 'af:open-how-it-works'
