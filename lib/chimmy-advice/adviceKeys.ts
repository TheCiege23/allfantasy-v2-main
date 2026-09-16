/**
 * One piece of Chimmy advice's identity, spelled the same everywhere: the Receipts card's ids, the
 * drawer's "Did it / Not doing it" buttons, and the outcome loop. It is `chimmy_advice`'s natural
 * key (its unique index), so asking the same question twice is one piece of advice in all three.
 *
 * Pure and dependency-free so a client component can build and compare keys too.
 */

export const startSitAdviceKey = (leagueId: string, season: number, week: number, recKey: string, altKey: string) =>
  `${leagueId}:${season}:${week}:${recKey}:${altKey}`

export const addAdviceKey = (leagueId: string, season: number, week: number, recKey: string) =>
  `${leagueId}:${season}:${week}:add:${recKey}`

/** The longest key accepted back from a client — a League id, a season, a week and two player ids. */
export const MAX_ADVICE_KEY_LENGTH = 200
