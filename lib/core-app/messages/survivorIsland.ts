import { defineMessages } from '@/lib/i18n/messages'

/** The Survivor island banner and tribe board in /core (components/core-app/survivor/). */
export const survivorIslandMessages = defineMessages({
  en: {
    survivor: 'Survivor',
    week: (n: number): string => `Week ${n}`,
    castaways: (left: number, total: number): string => `${left} of ${total} castaways left`,
    you: (tribe: string): string => `You: ${tribe}`,
    preDraftTitle: 'Your island is filling up',
    preDraftBody: 'Invite managers, set the draft time and get your queue ready. Tribes form after the draft.',
    campTitle: 'Life at camp',
    campBody: 'The tribe that scores less this week goes to Tribal Council and votes someone out.',
    councilMine: 'You’re going to Tribal Council',
    councilTribe: (tribe: string): string => `${tribe} goes to Tribal Council`,
    councilBody: 'Ballots are private and sealed until the read. Play an idol before the votes are read.',
    readingTitle: 'The votes are being read',
    readingBody: 'One ballot at a time. The tribe has almost spoken.',
    challengeTitle: (title: string | null): string => title || 'A challenge is open',
    challengeBody: 'Submit before it locks. The winners earn safety or an advantage.',
    mergedTitle: 'The tribes have merged',
    mergedBody: 'Immunity is individual now. Everyone voted out from here sits on the jury.',
    finaleTitle: 'Final Tribal Council',
    finaleBody: 'The jury is voting for the Sole Survivor.',
    crownedTitle: (name: string | null): string => (name ? `${name} is the Sole Survivor` : 'The Sole Survivor is crowned'),
    crownedBody: 'The season is over. Thanks for playing.',
    clockCouncil: 'Tribal Council in',
    clockChallenge: 'Challenge locks in',
    clockJury: 'Jury votes close in',
    myTeam: 'Your shelter',
    matchup: 'Immunity challenge',
    council: 'Tribal Council',
    island: 'Island hub',
    tribes: 'The island · tribes',
    tribe: 'tribe',
    merged: 'Merged tribe',
    attending: 'Lost immunity · votes this week',
    safe: 'Safe this week',
    points: (n: string): string => `${n} pts this week`,
    legendOut: 'Voted out',
    legendImmune: 'Immune',
    legendYou: 'You',
    loading: 'Loading the island…',
    readingEyebrow: 'Tribal Council · the vote',
    readingSub: (week: number, tribe: string | null): string => (tribe ? `Week ${week} · ${tribe}` : `Week ${week}`),
    readingProgress: (released: number, total: number): string => `${released} of ${total} votes read`,
    readingWaiting: 'The host is about to read the first vote…',
    readingVoteOf: (n: number, total: number): string => `Vote ${n} of ${total}`,
    readingNoTarget: 'No eligible name',
    readingExtraVote: 'Extra vote',
    readingStatus: (status: string): string => {
      switch (status) {
        case 'blocked_by_idol': return 'Blocked by an idol · this vote doesn’t count'
        case 'late_does_not_count': return 'Cast late · this vote doesn’t count'
        case 'taken_by_vote_steal': return 'Stolen vote · this vote doesn’t count'
        case 'blocked_by_shot': return 'Shot in the Dark · this vote doesn’t count'
        case 'forfeited_by_shot': return 'Forfeited for a Shot in the Dark · this vote doesn’t count'
        case 'target_safe': return 'Safe tonight · this vote doesn’t count'
        default: return ''
      }
    },
    readingTally: 'Tally',
    readingVotes: (n: number): string => (n === 1 ? '1 vote' : `${n} votes`),
    readingSpoken: 'The tribe has spoken',
    readingOut: (name: string): string => `${name} has been voted out`,
    readingMargin: (votes: number, next: number): string => `${votes} ${votes === 1 ? 'vote' : 'votes'} to ${next}`,
    readingTie: 'The vote is tied. Nobody leaves yet — the tie is broken next.',
    readingNone: 'Nobody was voted out.',
  },
  es: {
    survivor: 'Survivor',
    week: (n: number): string => `Semana ${n}`,
    castaways: (left: number, total: number): string => `Quedan ${left} de ${total} náufragos`,
    you: (tribe: string): string => `Tú: ${tribe}`,
    preDraftTitle: 'Tu isla se está llenando',
    preDraftBody: 'Invita a los mánagers, fija la hora del draft y prepara tu lista. Las tribus se forman después del draft.',
    campTitle: 'La vida en el campamento',
    campBody: 'La tribu que menos puntúe esta semana va al Consejo Tribal y expulsa a alguien.',
    councilMine: 'Vas al Consejo Tribal',
    councilTribe: (tribe: string): string => `${tribe} va al Consejo Tribal`,
    councilBody: 'Los votos son privados y quedan sellados hasta la lectura. Usa un ídolo antes de que se lean.',
    readingTitle: 'Se están leyendo los votos',
    readingBody: 'Un voto a la vez. La tribu casi ha hablado.',
    challengeTitle: (title: string | null): string => title || 'Hay una prueba abierta',
    challengeBody: 'Participa antes de que se cierre. Los ganadores consiguen inmunidad o una ventaja.',
    mergedTitle: 'Las tribus se han fusionado',
    mergedBody: 'La inmunidad ahora es individual. Todos los expulsados desde aquí forman el jurado.',
    finaleTitle: 'Consejo Tribal Final',
    finaleBody: 'El jurado está votando por el Único Superviviente.',
    crownedTitle: (name: string | null): string => (name ? `${name} es el Único Superviviente` : 'Ya hay Único Superviviente'),
    crownedBody: 'La temporada ha terminado. Gracias por jugar.',
    clockCouncil: 'Consejo Tribal en',
    clockChallenge: 'La prueba cierra en',
    clockJury: 'El jurado cierra en',
    myTeam: 'Tu refugio',
    matchup: 'Prueba de inmunidad',
    council: 'Consejo Tribal',
    island: 'Centro de la isla',
    tribes: 'La isla · tribus',
    tribe: 'tribu',
    merged: 'Tribu fusionada',
    attending: 'Perdió la inmunidad · vota esta semana',
    safe: 'A salvo esta semana',
    points: (n: string): string => `${n} pts esta semana`,
    legendOut: 'Expulsado',
    legendImmune: 'Inmune',
    legendYou: 'Tú',
    loading: 'Cargando la isla…',
    readingEyebrow: 'Consejo Tribal · la votación',
    readingSub: (week: number, tribe: string | null): string => (tribe ? `Semana ${week} · ${tribe}` : `Semana ${week}`),
    readingProgress: (released: number, total: number): string => `${released} de ${total} votos leídos`,
    readingWaiting: 'El presentador está por leer el primer voto…',
    readingVoteOf: (n: number, total: number): string => `Voto ${n} de ${total}`,
    readingNoTarget: 'Sin nombre válido',
    readingExtraVote: 'Voto extra',
    readingStatus: (status: string): string => {
      switch (status) {
        case 'blocked_by_idol': return 'Bloqueado por un ídolo · este voto no cuenta'
        case 'late_does_not_count': return 'Emitido tarde · este voto no cuenta'
        case 'taken_by_vote_steal': return 'Voto robado · este voto no cuenta'
        case 'blocked_by_shot': return 'Disparo en la oscuridad · este voto no cuenta'
        case 'forfeited_by_shot': return 'Cedido por un disparo en la oscuridad · este voto no cuenta'
        case 'target_safe': return 'A salvo esta noche · este voto no cuenta'
        default: return ''
      }
    },
    readingTally: 'Recuento',
    readingVotes: (n: number): string => (n === 1 ? '1 voto' : `${n} votos`),
    readingSpoken: 'La tribu ha hablado',
    readingOut: (name: string): string => `${name} ha sido expulsado`,
    readingMargin: (votes: number, next: number): string => `${votes} ${votes === 1 ? 'voto' : 'votos'} a ${next}`,
    readingTie: 'La votación está empatada. Nadie se va todavía: el empate se rompe a continuación.',
    readingNone: 'Nadie fue expulsado.',
  },
})
