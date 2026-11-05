import { defineMessages } from '@/lib/i18n/messages'

/**
 * Draft room redesign — the mode banner (offline / auto-pick / mock), the auction "on the block"
 * panel and the phone clock bar (components/app/draft-room/DraftModeBanner.tsx,
 * AuctionSpotlightPanel.tsx, DraftRoomPageClient's mobile sticky bar).
 * Spanish is complete: `__tests__/core-app/message-catalogs-complete.test.ts` fails on a missing key.
 */
export const draftRoomRedesignMessages = defineMessages({
  en: {
    // Mode banner.
    modeOfflineLabel: 'Offline draft',
    modeOfflineCommissioner:
      'You are logging picks from an in-person draft. Selecting a player submits it for the team on the clock.',
    modeOfflineMember: 'The commissioner records each pick as it happens in the room. The board updates for everyone.',
    modeAutopickLabel: 'Auto-pick is on',
    modeAutopickBody: 'AllFantasy makes your pick as soon as you are on the clock, starting with your queue. Turn it off to pick yourself.',
    modeMockLabel: 'Mock draft',
    modeMockBody: 'Practice draft. Nothing here counts toward any league.',

    // Auction: header stats.
    auctionAria: 'Auction',
    statBudget: 'Your budget',
    statBudgetValue: (left: number, total: number): string => `$${left} of $${total}`,
    statMaxBid: 'Max bid',
    statNominate: 'You nominate',
    nominateNow: 'Now',
    nominateIn: (turns: number): string => (turns === 1 ? 'Next' : `In ${turns} turns`),
    nominateNever: '—',
    nominatorLabel: 'Nominating',
    nominationOrderAria: 'Nomination order',

    // Auction: on the block.
    onTheBlock: 'On the block',
    currentBid: 'Current bid',
    noBidsYet: 'No bids yet',
    highBidder: (name: string): string => `High bidder: ${name}`,
    minNextBid: (amount: number): string => `Min next bid $${amount}`,
    bidCaps: 'Bid',
    customBid: 'Custom',
    bidAmountAria: 'Bid amount',
    bid: 'Bid',
    bidding: '…',
    sellOrPass: 'Sell / Pass',
    resolve: 'Resolve',
    paused: 'Paused',
    secondsLeft: (seconds: number): string => `${seconds}s`,
    maxBidNote: (max: number, spots: number, minBid: number): string =>
      spots === 1
        ? `You can bid up to $${max} with 1 roster spot left.`
        : `You can bid up to $${max} and still fill your other ${spots - 1} open roster spots at $${minBid} each.`,
    yourTurnNominate: 'Your turn to nominate. Pick a player from the list and choose Nominate.',
    waitingFor: (name: string): string => `Waiting for ${name} to nominate.`,
    waitingForUnknown: 'Waiting for the next nomination.',
    nominationWindow: (seconds: number): string => `Nomination window: ${seconds}s`,

    // Auction: lower panels.
    recentlyWon: 'Recently won',
    budgets: 'Budgets',
    budgetCols: 'Left · max · spots',
    spotsLeft: (spots: number): string => (spots === 1 ? '1 spot' : `${spots} spots`),
    you: 'You',

    // Phone clock bar.
    clockBarAria: 'Pick on the clock',
    clockBarDraftRoom: 'Draft room',
    clockBarYouOnClock: 'You are on the clock',
    clockBarPicksUntil: (picks: number): string => (picks === 1 ? '1 pick until your turn' : `${picks} picks until your turn`),
    clockBarSearch: 'Search',
    clockBarQueue: 'Queue',
    clockBarRoster: 'Roster',
    clockBarChat: 'Chat',
    clockBarHelper: 'AI helper',
    mockPickLabel: (pick: number): string => `Pick #${pick}`,
    mockSecondsLeft: (seconds: number): string => `${seconds}s left`,
    mockStatusPaused: 'Paused',
    mockStatusComplete: 'Draft complete',
  },
  es: {
    modeOfflineLabel: 'Draft presencial',
    modeOfflineCommissioner:
      'Estás registrando las selecciones de un draft presencial. Al elegir un jugador, se envía para el equipo que está en el reloj.',
    modeOfflineMember: 'El comisionado registra cada selección a medida que ocurre en la sala. El tablero se actualiza para todos.',
    modeAutopickLabel: 'El auto-pick está activado',
    modeAutopickBody: 'AllFantasy hace tu selección en cuanto estás en el reloj, empezando por tu cola. Desactívalo para elegir tú.',
    modeMockLabel: 'Mock draft',
    modeMockBody: 'Draft de práctica. Nada de esto cuenta para ninguna liga.',

    auctionAria: 'Subasta',
    statBudget: 'Tu presupuesto',
    statBudgetValue: (left: number, total: number): string => `$${left} de $${total}`,
    statMaxBid: 'Puja máxima',
    statNominate: 'Tu nominación',
    nominateNow: 'Ahora',
    nominateIn: (turns: number): string => (turns === 1 ? 'Siguiente' : `En ${turns} turnos`),
    nominateNever: '—',
    nominatorLabel: 'Nomina',
    nominationOrderAria: 'Orden de nominación',

    onTheBlock: 'En subasta',
    currentBid: 'Puja actual',
    noBidsYet: 'Aún no hay pujas',
    highBidder: (name: string): string => `Puja más alta: ${name}`,
    minNextBid: (amount: number): string => `Puja mínima siguiente $${amount}`,
    bidCaps: 'Pujar',
    customBid: 'Otra',
    bidAmountAria: 'Monto de la puja',
    bid: 'Pujar',
    bidding: '…',
    sellOrPass: 'Vender / Pasar',
    resolve: 'Resolver',
    paused: 'En pausa',
    secondsLeft: (seconds: number): string => `${seconds} s`,
    maxBidNote: (max: number, spots: number, minBid: number): string =>
      spots === 1
        ? `Puedes pujar hasta $${max} con 1 lugar libre en tu roster.`
        : `Puedes pujar hasta $${max} y aún llenar tus otros ${spots - 1} lugares libres del roster a $${minBid} cada uno.`,
    yourTurnNominate: 'Te toca nominar. Elige un jugador de la lista y pulsa Nominar.',
    waitingFor: (name: string): string => `Esperando a que ${name} nomine.`,
    waitingForUnknown: 'Esperando la siguiente nominación.',
    nominationWindow: (seconds: number): string => `Tiempo para nominar: ${seconds} s`,

    recentlyWon: 'Ganados recientemente',
    budgets: 'Presupuestos',
    budgetCols: 'Restante · máx. · lugares',
    spotsLeft: (spots: number): string => (spots === 1 ? '1 lugar' : `${spots} lugares`),
    you: 'Tú',

    clockBarAria: 'Selección en el reloj',
    clockBarDraftRoom: 'Sala del draft',
    clockBarYouOnClock: 'Estás en el reloj',
    clockBarPicksUntil: (picks: number): string => (picks === 1 ? 'Falta 1 selección para tu turno' : `Faltan ${picks} selecciones para tu turno`),
    clockBarSearch: 'Buscar',
    clockBarQueue: 'Cola',
    clockBarRoster: 'Roster',
    clockBarChat: 'Chat',
    clockBarHelper: 'Asistente de IA',
    mockPickLabel: (pick: number): string => `Selección n.º ${pick}`,
    mockSecondsLeft: (seconds: number): string => `Quedan ${seconds} s`,
    mockStatusPaused: 'En pausa',
    mockStatusComplete: 'Draft terminado',
  },
})
