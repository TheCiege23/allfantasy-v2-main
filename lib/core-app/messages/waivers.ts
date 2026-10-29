import { defineMessages } from '@/lib/i18n/messages'

/**
 * Waivers screen (components/core-app/screens/Waivers.tsx). Every string is the one the screen
 * printed before the move, byte for byte, in both languages — this is a relocation, not a rewrite.
 * Labels and loader reasons that arrive in English still go through `coreUiCopy`, as before.
 */
export const waiversMessages = defineMessages({
  en: {
    yourTime: ' your time',
    budgetRank: (rank: number, rosters: number) => `${rank} of ${rosters} by budget left`,
    ofRosters: (rosters: number) => `of ${rosters} rosters`,
    rosterLoad: (starters: number, bench: number, reserve: number) =>
      `${starters} starting · ${bench} bench${reserve > 0 ? ` · ${reserve} IR/taxi` : ''}`,
    claimOn: (platform: string) => `Claim on ${platform}`,
    claimsMadeOn: (platform: string) => `Claims are made on ${platform}. AllFantasy only reads your league.`,
    observedRuns: (runs: number) => `seen over this league's last ${runs} runs`,
    fromSleeperSettings: "from this league's Sleeper settings",
    pricedAgainst: 'Bids and targets are priced against ',
    differentLeague: 'The same player is worth a different amount in a different league.',
  },
  es: {
    yourTime: ' (tu hora)',
    budgetRank: (rank, rosters) => `${rank} de ${rosters} por presupuesto restante`,
    ofRosters: (rosters) => `de ${rosters} equipos`,
    rosterLoad: (starters, bench, reserve) =>
      `${starters} titulares · ${bench} suplentes${reserve > 0 ? ` · ${reserve} IR/taxi` : ''}`,
    claimOn: (platform) => `Reclamar en ${platform}`,
    claimsMadeOn: (platform) => `Los reclamos se hacen en ${platform}. AllFantasy solo lee tu liga.`,
    observedRuns: (runs) => `según las últimas ${runs} ejecuciones de esta liga`,
    fromSleeperSettings: 'según la configuración de Sleeper de esta liga',
    pricedAgainst: 'Las ofertas y recomendaciones se calculan para ',
    differentLeague: 'Un mismo jugador puede valer distinto en otra liga.',
  },
})
