import { defineMessages } from '@/lib/i18n/messages'

/**
 * The /core welcome guide (components/core-app/CoreWelcomeTour.tsx): its four steps — connect,
 * choose, ask, play — the progress label and the navigation buttons. Keys are prefixed by step.
 * Every string is the one the component wrote before the move, byte for byte, in both languages —
 * a relocation, not a rewrite.
 */
export const coreWelcomeTourMessages = defineMessages({
  en: {
    connectKicker: '1 · Connect',
    connectTitleReady: (leagueCount: number): string => `${leagueCount} ${leagueCount === 1 ? 'league ready' : 'leagues ready'}`,
    connectTitleEmpty: 'Bring your leagues together',
    connectBodyReady: 'Open Leagues to switch between them. AllFantasy shows your data without changing the original platform.',
    /** `platforms` is `availableImportPlatformsPhrase()`. */
    connectBodyEmpty: (platforms: string) => `Import from ${platforms}. AllFantasy reads the league and leaves the original platform unchanged.`,
    connectAction: 'Import a league',
    chooseKicker: '2 · Choose',
    chooseTitle: 'One league or all leagues',
    chooseBody: 'Choose a league and it stays selected as you move between tabs. You can also see all your leagues together.',
    askKicker: '3 · Ask',
    askTitle: 'Ask Chimmy about your league',
    askBody: 'Inside a league, Chimmy uses its rules, roster, schedule and moves. From Home, compare priorities across all your leagues.',
    playKicker: '4 · Play',
    playTitle: 'Run the week from one place',
    playBody: 'Sync changes, check your lineup and waivers, review trades, and use commissioner tools when you run the league.',
    playAction: 'Open the league hub',
    /** `step` is 1-based. */
    progress: (step: number, total: number) => `Step ${step} of ${total}`,
    dismiss: 'Dismiss welcome guide',
    back: 'Back',
    next: 'Next',
    start: 'Start using Core',
  },
  es: {
    connectKicker: '1 · Conecta',
    connectTitleReady: (leagueCount) => `${leagueCount} ${leagueCount === 1 ? 'liga lista' : 'ligas listas'}`,
    connectTitleEmpty: 'Reúne tus ligas',
    connectBodyReady: 'Abre Ligas para cambiar de liga. AllFantasy muestra tus datos sin modificar tu plataforma original.',
    connectBodyEmpty: (platforms) => `Importa desde ${platforms}. AllFantasy lee tu liga sin modificar la plataforma original.`,
    connectAction: 'Importar una liga',
    chooseKicker: '2 · Elige',
    chooseTitle: 'Una liga o todas',
    chooseBody: 'Elige una liga para mantenerla seleccionada al cambiar de sección. También puedes ver todas tus ligas juntas.',
    askKicker: '3 · Consulta',
    askTitle: 'Pregúntale a Chimmy',
    askBody: 'Dentro de una liga, Chimmy usa sus reglas, plantilla, calendario y movimientos. Desde Inicio compara tus ligas.',
    playKicker: '4 · Juega',
    playTitle: 'Organiza tu semana aquí',
    playBody: 'Sincroniza cambios, revisa tu alineación y agentes libres, analiza intercambios y usa las herramientas del comisionado.',
    playAction: 'Abrir centro de ligas',
    progress: (step, total) => `Paso ${step} de ${total}`,
    dismiss: 'Cerrar guía de bienvenida',
    back: 'Atrás',
    next: 'Siguiente',
    start: 'Empezar',
  },
})
