import { defineMessages } from '@/lib/i18n/messages'

/**
 * The multi-league format hubs' sentences with a value in them (`hubText` in
 * lib/core-app/formatHubCopy.ts — FormatHub, HubSwitcher and the connected-franchise scope bar).
 * Every string is the one the module produced before the move, byte for byte, in both languages — a
 * relocation, not a rewrite. The Spanish-only tables in that module (tab names by format, the themed
 * copy per format, the fixed interface strings keyed by their English) stay there: they translate
 * English the components hold, they are not en/es pairs.
 */
export const formatHubMessages = defineMessages({
  en: {
    connectBody: (tab: string, canCreate: boolean) =>
      `This hub gathers every ${tab} league you’re already in. To add one, import it from the platform it lives on${canCreate ? ', or start a new one on AllFantasy' : ''}. Nothing changes on the original platform.`,
    importFrom: (platforms: string) => `Import from ${platforms}`,
    appearsWhen: (tab: string) => `It appears here as soon as it is recognised as a ${tab} league.`,
    startOn: (tab: string) => `Start a ${tab} league on AllFantasy`,
    pickFormat: (tab: string) => `Pick the ${tab} format in league creation.`,
    atAGlance: (tab: string) => `${tab} at a glance`,
    across: (n: number) => `Across your ${n} ${n === 1 ? 'league' : 'leagues'}`,
    leaguesYouPlay: (tab: string) => `${tab} leagues you play in`,
    comparison: (tab: string) => `${tab} league comparison`,
    leagueTools: (name: string) => `${name} tools`,
    showing: (shown: number, total: number) => `Showing ${shown} of ${total}. Every league is in `,
    fillsIn: (tab: string) =>
      `This hub fills in by itself the moment one of your leagues is a ${tab} league — imported or created.`,
    scopeAria: (franchise: string) => `${franchise} tool scope`,
    askAllPrefill: (franchise: string, decision: string) =>
      `Use every selected roster in ${franchise} to help with this ${decision} decision.`,
  },
  es: {
    connectBody: (tab, canCreate) =>
      `Este centro reúne cada liga ${tab} en la que ya estás. Para agregar una, impórtala desde la plataforma donde está${canCreate ? ', o crea una nueva en AllFantasy' : ''}. Nada cambia en la plataforma original.`,
    importFrom: (platforms) => `Importar desde ${platforms}`,
    appearsWhen: (tab) => `Aparece aquí en cuanto se reconoce como una liga ${tab}.`,
    startOn: (tab) => `Crear una liga ${tab} en AllFantasy`,
    pickFormat: (tab) => `Elige el formato ${tab} al crear la liga.`,
    atAGlance: (tab) => `${tab} de un vistazo`,
    across: (n) => `En tus ${n} ${n === 1 ? 'liga' : 'ligas'}`,
    leaguesYouPlay: (tab) => `Ligas ${tab} en las que juegas`,
    comparison: (tab) => `Comparación de ligas ${tab}`,
    leagueTools: (name) => `Herramientas de ${name}`,
    showing: (shown, total) => `Se muestran ${shown} de ${total}. Todas las ligas están en `,
    fillsIn: (tab) => `Este centro se completa solo en cuanto una de tus ligas sea una liga ${tab}, importada o creada.`,
    scopeAria: (franchise) => `Alcance de la herramienta: ${franchise}`,
    askAllPrefill: (franchise, decision) =>
      `Usa cada plantilla seleccionada de ${franchise} para ayudarme con esta decisión (${decision}).`,
  },
})
