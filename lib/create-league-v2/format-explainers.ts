/**
 * How each league format works, in a few plain sentences.
 *
 * Shown under the format tiles on the create wizard's Basics step, at the moment of choosing.
 * Settings-level help (keeper cost, median game, …) lives in the wizard's own `HELP` map; the
 * phase-by-phase "What's next?" guidance after creation is `lib/league/whats-next/`.
 */

export type FormatExplainer = {
  summary: string
  howItWorks: string[]
}

export const FORMAT_EXPLAINERS: Record<string, FormatExplainer> = {
  redraft: {
    summary: 'A fresh draft every season. The simplest way to play.',
    howItWorks: ['Everyone drafts a new team each year.', 'Weekly head-to-head matchups, then playoffs.'],
  },
  dynasty: {
    summary: 'Keep your whole roster forever and build for the long term.',
    howItWorks: ['One startup draft, then a rookie draft every year.', 'Draft picks can be traded for future seasons.'],
  },
  keeper: {
    summary: 'A normal season where each team keeps a few players for next year.',
    howItWorks: ['Draft as usual.', 'Before next season, each team picks its keepers; keeping a player costs a draft pick.'],
  },
  best_ball: {
    summary: 'Draft once, then AF sets your best lineup every week automatically.',
    howItWorks: ['No weekly lineup decisions.', 'Depth matters: your best scorers at each position count.'],
  },
  guillotine: {
    summary: 'The lowest score each period is eliminated until one team survives.',
    howItWorks: [
      'Every team plays against the whole league, not one opponent.',
      'The lowest scorer is cut; their players go to free agency for FAAB bids.',
      'Trades are off. The last team standing wins.',
    ],
  },
  king_of_the_hill: {
    summary: 'Win the crown, then defend it against challengers.',
    howItWorks: ['One team holds the crown each period.', 'Challengers try to take it; the longest reign wins.'],
  },
  big_brother: {
    summary: 'A weekly social game: win Head of Household, nominate, vote, evict.',
    howItWorks: [
      'Each week a scoring competition crowns the Head of Household (HOH), who is safe and nominates two managers for eviction.',
      'A Power of Veto can save a nominee.',
      'The house votes to evict one nominee until a final jury picks the winner.',
    ],
  },
  survivor: {
    summary: 'Tribes compete, lose challenges, and vote managers off the island.',
    howItWorks: ['Managers are split into tribes.', 'The losing tribe goes to tribal council and votes one manager out.', 'Tribes merge late; a jury picks the winner.'],
  },
  tournament: {
    summary: 'A large field split into feeder leagues; winners advance to later rounds.',
    howItWorks: ['Participants are placed into leagues of equal size.', 'Top finishers advance each round until a champion is crowned.'],
  },
  salary_cap: {
    summary: 'Every player has a salary; build the best team under the cap.',
    howItWorks: ['Startup auction sets salaries.', 'Contracts and the cap carry across seasons.'],
  },
}

export function getFormatExplainer(leagueType: string | null | undefined): FormatExplainer | null {
  if (!leagueType) return null
  return FORMAT_EXPLAINERS[leagueType] ?? null
}
