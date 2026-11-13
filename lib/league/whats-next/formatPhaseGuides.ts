/**
 * The phase config behind the "What's next?" banner: every format, every phase it can be in, and what
 * to tell the manager who has to act, the commissioner, and everyone else.
 *
 * ⚠ PHASE IDS ARE THE FORMATS' OWN STORED VALUES WHEREVER ONE EXISTS. Big Brother's are
 * `BigBrotherWeekPhase` (lib/big-brother/types.ts) exactly, so a phase the engine adds and this file
 * does not know is caught by __tests__/league/whats-next.test.ts rather than silently showing nothing.
 * Formats with no stored phase enum (Survivor's game state as the summary exposes it, Guillotine,
 * Pirate, and the season lifecycle) use ids the adapter derives, listed here and nowhere else.
 *
 * ⚠ WHO ACTS IS READ FROM THE ENGINE, NOT GUESSED. Big Brother's HOH and veto competitions are run
 * by automation at their deadline (`auto_hoh`, `auto_veto` in BigBrotherAutomationService), so no
 * manager is asked to "go compete"; the HOH nominates, the veto holder decides, the house votes.
 *
 * Copy rules: plain English, no internal phase names, no promise the code does not keep. Templates
 * use `{name}`; resolveWhatsNext fills them and falls back to a neutral word for a missing value.
 */
import type { FormatGuide, PhaseGuide, WhatsNextFormatId } from './types'

// ── Big Brother ──────────────────────────────────────────────────────────────────────────────

const BIG_BROTHER: FormatGuide = {
  format: 'big_brother',
  label: 'Big Brother',
  phases: {
    PRE_SEASON: {
      title: "The house hasn't opened yet",
      actor: 'commissioner',
      actorMessage:
        'Week 1 starts once the draft is done. Start it from Big Brother command and the first Head of Household competition opens.',
      commissionerMessage:
        'Week 1 starts once the draft is done. Start it from Big Brother command and the first Head of Household competition opens.',
      memberMessage: 'Waiting on the commissioner to start Week 1. The first Head of Household competition opens then.',
      waitingOn: 'The commissioner',
      action: { tab: 'bb_command', label: 'Open Big Brother command' },
    },
    HOH_OPEN: {
      title: 'Week {week}: the Head of Household competition is on',
      actor: 'automatic',
      commissionerMessage:
        'The HOH is decided automatically when the competition closes. You can force the week forward from Big Brother command if you need to.',
      memberMessage: 'Nothing to do yet. The HOH is decided automatically when the competition closes.',
      commissionerAction: { tab: 'bb_command', label: 'Big Brother command' },
    },
    HOH_LOCKED: {
      title: 'HOH has been chosen: {hoh}',
      // Momentary: automation moves HOH_LOCKED straight to NOMINATION_OPEN. Nothing to click yet.
      actor: 'automatic',
      involvedMessage: "You won Head of Household. Nominations open next — you'll name {nomineeCount} houseguests for eviction.",
      commissionerMessage: 'Nominations open next. {hoh} will name {nomineeCount} houseguests for eviction.',
      memberMessage: 'Nominations open next. Nothing to do yet — {hoh} will name {nomineeCount} houseguests for eviction.',
    },
    NOMINATION_OPEN: {
      title: 'HOH has been chosen: {hoh}',
      actor: 'viewer_decides',
      actorMessage: 'Your turn: nominate {nomineeCount} houseguests for eviction.',
      commissionerMessage:
        'Waiting on {hoh} (HOH) to nominate {nomineeCount} houseguests. If the deadline passes, the league’s fallback rule nominates for them.',
      memberMessage: 'Waiting on {hoh} (HOH) to nominate {nomineeCount} houseguests. Nothing to do yet.',
      waitingOn: '{hoh} (HOH)',
      action: { tab: 'bb_hoh', label: 'Make nominations' },
    },
    NOMINATION_LOCKED: {
      title: 'Nominations are in: {nominees}',
      actor: 'automatic',
      commissionerMessage: 'The Power of Veto draw is next and runs automatically.',
      memberMessage: 'The Power of Veto draw is next. Nothing to do yet.',
      involvedMessage: "You're on the block. The veto draw is next — win the veto and you can save yourself.",
    },
    VETO_DRAW: {
      title: 'On the block: {nominees}',
      actor: 'automatic',
      commissionerMessage: 'The veto players are being drawn automatically.',
      memberMessage: 'The veto players are being drawn. Nothing to do yet.',
      involvedMessage: "You're on the block. The veto players are being drawn now.",
    },
    VETO_CHALLENGE_OPEN: {
      title: 'Power of Veto competition: {vetoPlayers}',
      actor: 'automatic',
      commissionerMessage:
        'The veto winner is decided automatically when the competition closes, or you can pick the winner yourself from Big Brother command.',
      memberMessage: 'The veto competition is running. Nothing to do yet — the winner is announced when it closes.',
      involvedMessage: "You're playing for the Power of Veto. The winner is decided when the competition closes.",
      commissionerAction: { tab: 'bb_command', label: 'Big Brother command' },
    },
    VETO_DECISION_OPEN: {
      title: '{vetoHolder} won the Power of Veto',
      actor: 'viewer_decides',
      actorMessage: 'Your turn: decide whether to use the Power of Veto.',
      commissionerMessage: 'Waiting on {vetoHolder} to decide whether to use the veto. If they miss the deadline, the nominations stay the same.',
      memberMessage: 'Waiting on {vetoHolder} to decide whether to use the veto.',
      involvedMessage: "You're on the block. {vetoHolder} is deciding whether to use the veto.",
      waitingOn: '{vetoHolder} (veto holder)',
      action: { tab: 'bb_veto', label: 'Make the veto decision' },
    },
    REPLACEMENT_NOMINATION_OPEN: {
      title: 'The veto was used on {vetoSaved}',
      actor: 'viewer_decides',
      actorMessage: 'Your turn: name a replacement nominee.',
      commissionerMessage: 'Waiting on {hoh} (HOH) to name a replacement nominee. If the deadline passes, the fallback rule picks one.',
      memberMessage: 'Waiting on {hoh} (HOH) to name a replacement nominee.',
      waitingOn: '{hoh} (HOH)',
      action: { tab: 'bb_hoh', label: 'Name a replacement' },
    },
    VOTING_OPEN: {
      title: 'Eviction vote: {nominees}',
      actor: 'viewer_decides',
      actorMessage: 'Your turn: cast your eviction vote before voting closes.',
      // `ballot.hasVoted` on the summary — the viewer's own ballot only, never who for.
      doneMessage: 'Your eviction vote is in. The result is announced when voting closes.',
      commissionerMessage: 'The house is voting. The eviction happens automatically when voting closes.',
      memberMessage: 'The house is voting on who to evict. The result is announced when voting closes.',
      involvedMessage: "You're on the block. The house is voting — the result is announced when voting closes.",
      waitingOn: 'Every houseguest with a vote',
      action: { tab: 'bb_voting', label: 'Cast your vote' },
    },
    VOTING_LOCKED: {
      title: 'Votes are locked',
      actor: 'automatic',
      commissionerMessage: 'The votes are being counted and the eviction is announced next.',
      memberMessage: 'The votes are being counted. The eviction is announced next.',
    },
    EVICTION_RESOLVED: {
      title: '{evicted} has been evicted',
      actor: 'automatic',
      commissionerMessage: 'The week wraps up automatically, then the next Head of Household competition opens.',
      memberMessage: 'Nothing to do. The next Head of Household competition opens soon.',
    },
    JURY_UPDATE: {
      title: '{evicted} has been evicted',
      actor: 'automatic',
      commissionerMessage: 'The jury is being updated. The next week starts automatically.',
      memberMessage: 'The jury is being updated. The next Head of Household competition opens soon.',
    },
    RESET_NEXT_WEEK: {
      title: 'Week {week} is over',
      actor: 'automatic',
      commissionerMessage: 'The next week starts automatically.',
      memberMessage: 'Nothing to do. The next Head of Household competition opens soon.',
    },
    FINALE: {
      title: 'Finale: {finalists}',
      actor: 'viewer_decides',
      actorMessage: 'Your turn: as a juror, vote for who wins Big Brother.',
      commissionerMessage: 'The jury is voting for the winner.',
      memberMessage: 'The jury is voting for the winner of Big Brother.',
      involvedMessage: "You're in the final. The jury is voting for the winner.",
      waitingOn: 'The jury',
      action: { tab: 'bb_jury', label: 'Vote for the winner' },
    },
  },
}

// ── Survivor ─────────────────────────────────────────────────────────────────────────────────

const SURVIVOR: FormatGuide = {
  format: 'survivor',
  label: 'Survivor',
  phases: {
    pre_season: {
      title: 'Tribes have not been formed yet',
      actor: 'commissioner',
      actorMessage: 'Finish the draft and form the tribes from Survivor command. Week 1 starts after that.',
      commissionerMessage: 'Finish the draft and form the tribes from Survivor command. Week 1 starts after that.',
      memberMessage: 'Waiting on the commissioner to finish the draft and form the tribes.',
      waitingOn: 'The commissioner',
      action: { tab: 'survivor_command', label: 'Open Survivor command' },
    },
    paused: {
      title: 'Survivor is paused',
      actor: 'commissioner',
      actorMessage: 'You paused the season. Nothing resolves until you resume it from Survivor command.',
      commissionerMessage: 'The season is paused. Nothing resolves until it is resumed from Survivor command.',
      memberMessage: 'The commissioner has paused the season. Nothing happens until it resumes.',
      waitingOn: 'The commissioner',
      action: { tab: 'survivor_command', label: 'Open Survivor command' },
    },
    challenge: {
      title: 'Week {week}: the immunity challenge is on',
      actor: 'everyone',
      actorMessage: 'Set your strongest lineup — this week’s scores decide immunity. Check the challenge before it locks.',
      commissionerMessage: 'Everyone is playing for immunity this week. Tribal Council follows once the challenge locks.',
      memberMessage: 'Set your strongest lineup — this week’s scores decide immunity.',
      action: { tab: 'survivor_challenges', label: 'See the challenge' },
    },
    tribal_open: {
      title: 'Tribal Council: {tribe} is voting',
      actor: 'viewer_decides',
      actorMessage: 'Your turn: cast your vote at Tribal Council before it closes.',
      doneMessage: 'Your vote is in. The castaway voted out is revealed when votes close.',
      commissionerMessage: '{tribe} is voting at Tribal Council. The castaway voted out is revealed when votes close.',
      memberMessage: '{tribe} is at Tribal Council. You are safe this round — the result is revealed when votes close.',
      waitingOn: '{tribe}',
      action: { tab: 'survivor_tribal', label: 'Go to Tribal Council' },
    },
    revote: {
      title: 'Tribal Council tied — revote',
      actor: 'viewer_decides',
      actorMessage: 'Your turn: the vote tied. Cast your revote before it closes.',
      doneMessage: 'Your revote is in. The result is revealed when votes close.',
      commissionerMessage: 'The vote tied, so a revote is open. The league’s tie rule applies if it ties again.',
      memberMessage: 'The vote tied, so a revote is open. Nothing to do unless you have a revote.',
      involvedMessage: "You're in the tie. Managers outside the tie are revoting now.",
      waitingOn: 'Managers outside the tie',
      action: { tab: 'survivor_tribal', label: 'Cast your revote' },
    },
    reveal: {
      title: 'The votes are being read',
      actor: 'automatic',
      commissionerMessage: 'Votes are closed and being revealed one by one.',
      memberMessage: 'Votes are closed. Watch the reveal at Tribal Council.',
      action: { tab: 'survivor_tribal', label: 'Watch the reveal' },
    },
    in_week: {
      title: 'Week {week} on the island',
      actor: 'everyone',
      actorMessage: 'Set your lineup. The next challenge and Tribal Council follow this week’s scores.',
      commissionerMessage: 'The week is underway. The next challenge and Tribal Council run on the league schedule.',
      memberMessage: 'Set your lineup. The next challenge and Tribal Council follow this week’s scores.',
      action: { tab: 'survivor', label: 'Open the island' },
    },
    finale_vote: {
      title: 'Finale: {finalists}',
      actor: 'viewer_decides',
      actorMessage: 'Your turn: as a juror, vote for the Sole Survivor.',
      doneMessage: 'Your jury vote is in. The Sole Survivor is revealed when the jury is done ({juryVotes} in).',
      commissionerMessage: 'The jury is voting for the winner ({juryVotes} in).',
      memberMessage: 'The jury is voting for the Sole Survivor ({juryVotes} in).',
      involvedMessage: "You're a finalist. The jury is voting for the winner.",
      waitingOn: 'The jury',
      action: { tab: 'survivor_jury', label: 'Vote for the winner' },
    },
    crowned: {
      title: '{winner} is the Sole Survivor',
      actor: 'automatic',
      commissionerMessage: 'The season is over. Review the jury and the season story.',
      memberMessage: 'The season is over. See how the jury voted.',
      action: { tab: 'survivor_jury', label: 'See the finale' },
    },
  },
}

// ── Zombie ───────────────────────────────────────────────────────────────────────────────────

const ZOMBIE: FormatGuide = {
  format: 'zombie',
  label: 'Zombie',
  phases: {
    setup: {
      title: 'The outbreak has not started',
      actor: 'commissioner',
      actorMessage: 'Finish setup and run the draft. The Whisperer is chosen and the outbreak starts in Week 1.',
      commissionerMessage: 'Finish setup and run the draft. The Whisperer is chosen and the outbreak starts in Week 1.',
      memberMessage: 'Waiting on the commissioner to finish setup and the draft. The outbreak starts in Week 1.',
      waitingOn: 'The commissioner',
      action: { tab: 'zombie', label: 'Open the outbreak' },
    },
    in_season: {
      title: 'Week {week}: {survivorCount} survivors left',
      actor: 'everyone',
      actorMessage: '{roleAdvice}',
      commissionerMessage: 'The week resolves automatically after scores are final: any survivor who loses to a zombie becomes one.',
      memberMessage: 'Set your lineup. Any survivor who loses to a zombie becomes one.',
      action: { tab: 'zombie', label: 'Open the outbreak' },
    },
    paused: {
      title: 'The outbreak is paused',
      actor: 'commissioner',
      actorMessage: 'You paused the league. Nothing resolves until you resume it.',
      commissionerMessage: 'The league is paused. Nothing resolves until it is resumed.',
      memberMessage: 'The commissioner has paused the league. Nothing resolves until it resumes.',
      waitingOn: 'The commissioner',
      action: { tab: 'zombie', label: 'Open the outbreak' },
    },
  },
}

// ── Guillotine ───────────────────────────────────────────────────────────────────────────────

const GUILLOTINE: FormatGuide = {
  format: 'guillotine',
  label: 'Guillotine',
  phases: {
    pre_season: {
      title: 'The season has not started',
      actor: 'commissioner',
      actorMessage: 'Run the draft. The lowest-scoring team is chopped each week once chops begin.',
      commissionerMessage: 'Run the draft. The lowest-scoring team is chopped each week once chops begin.',
      memberMessage: 'Waiting on the draft. Once chops begin, the lowest score each week is eliminated.',
      waitingOn: 'The commissioner',
      action: { tab: 'draft', label: 'Open the draft' },
    },
    before_chops: {
      title: 'Chops start in Week {chopStartWeek}',
      actor: 'everyone',
      actorMessage: 'Set your lineup. No one is chopped yet, but your scores already count toward the chop line.',
      commissionerMessage: 'No chops yet. They start in Week {chopStartWeek}.',
      memberMessage: 'Set your lineup. No one is chopped yet.',
      action: { tab: 'guillotine', label: 'Open the Guilly' },
    },
    chop_week: {
      title: 'Week {week}: {teamsLeft} teams left',
      actor: 'everyone',
      actorMessage: '{chopAdvice}',
      commissionerMessage: 'The lowest score this week is chopped automatically when scores are final, and their players go to waivers.',
      memberMessage: 'Set your lineup. The lowest score this week is chopped and their players go to waivers.',
      action: { tab: 'guillotine', label: 'See the chop line' },
    },
    complete: {
      title: 'The last team standing has been crowned',
      actor: 'automatic',
      commissionerMessage: 'The Guillotine season is over.',
      memberMessage: 'The Guillotine season is over. See the full chop history.',
      action: { tab: 'guillotine', label: 'See the season' },
    },
  },
}

// ── Pirate ───────────────────────────────────────────────────────────────────────────────────

const PIRATE: FormatGuide = {
  format: 'pirate',
  label: 'Pirate',
  phases: {
    claim_pending: {
      title: 'A claim is waiting: {claimant} beat {victim}',
      actor: 'viewer_decides',
      actorMessage: 'Your turn: you won your matchup. Choose the player you take from {victim}.',
      commissionerMessage: 'Waiting on {claimant} to choose a player from {victim}.',
      memberMessage: 'Waiting on {claimant} to choose a player from {victim}.',
      involvedMessage: '{claimant} beat you and is choosing one of your unprotected players.',
      waitingOn: '{claimant}',
      action: { tab: 'pirate', label: 'Choose your player' },
    },
    protections_open: {
      title: 'Week {week}: protections are open',
      actor: 'everyone',
      actorMessage: 'Choose the players to protect before lock. Lose your matchup and the winner can take anyone unprotected.',
      commissionerMessage: 'Managers are choosing protected players. Protections lock at the deadline.',
      memberMessage: 'Choose the players to protect before lock.',
      action: { tab: 'pirate', label: 'Set protections' },
    },
    locked: {
      title: 'Week {week}: protections are locked',
      actor: 'everyone',
      actorMessage: 'Protections are locked. Win your matchup to claim a player from the team you beat.',
      commissionerMessage: 'Protections are locked. Claims open when matchups are final.',
      memberMessage: 'Win your matchup to claim a player from the team you beat.',
      action: { tab: 'matchups', label: 'Open matchup' },
    },
  },
}

// ── Season lifecycle (every format without its own weekly engine) ────────────────────────────

/**
 * Phases every league goes through. Ids are `nativeLeaguePhase` buckets plus the draft time, which is
 * what a native league actually stores (`lifecycleState` / `status`).
 */
function lifecycleGuide(
  format: WhatsNextFormatId,
  label: string,
  overrides: { inSeason?: Partial<PhaseGuide>; offseason?: Partial<PhaseGuide>; setup?: Partial<PhaseGuide> } = {},
): FormatGuide {
  return {
    format,
    label,
    phases: {
      setup: {
        title: 'Your league is getting ready',
        actor: 'commissioner',
        actorMessage: 'Invite your managers and set a draft time. Everyone can mock draft and build a queue meanwhile.',
        commissionerMessage: 'Invite your managers and set a draft time.',
        memberMessage: 'Waiting on the commissioner to set a draft time. Mock draft and build your queue meanwhile.',
        waitingOn: 'The commissioner',
        action: { tab: 'draft', label: 'Open Draft HQ' },
        ...overrides.setup,
      },
      draft_scheduled: {
        title: 'Draft is scheduled',
        actor: 'everyone',
        actorMessage: 'Get ready: rank players and build your queue before the draft starts.',
        commissionerMessage: 'The draft is scheduled. Check that every team has a manager before it starts.',
        memberMessage: 'Get ready: rank players and build your queue before the draft starts.',
        action: { tab: 'draft', label: 'Open Draft HQ' },
      },
      drafting: {
        title: 'The draft is live',
        actor: 'everyone',
        actorMessage: 'Your draft is happening now. Head to the draft room.',
        commissionerMessage: 'The draft is live. Manage it from the draft room.',
        memberMessage: 'Your draft is happening now. Head to the draft room.',
        action: { href: '/league/{leagueId}/draft', label: 'Go to the draft room' },
      },
      in_season: {
        title: 'Week {week} is underway',
        actor: 'everyone',
        actorMessage: 'Set your lineup before your players lock.',
        commissionerMessage: 'The season is running. League Health flags anything that needs you.',
        memberMessage: 'Set your lineup before your players lock.',
        action: { tab: 'roster', label: 'Set your lineup' },
        ...overrides.inSeason,
      },
      playoffs: {
        title: 'Playoffs: Week {week}',
        actor: 'everyone',
        actorMessage: 'If you made the playoffs, set your lineup. Every week is win-or-go-home.',
        commissionerMessage: 'The playoffs are running. Follow the bracket in standings.',
        memberMessage: 'The playoffs are on. Follow the bracket in standings.',
        action: { tab: 'matchups', label: 'Open matchup' },
      },
      offseason: {
        title: 'The season is over',
        actor: 'commissioner',
        actorMessage: 'Review the final standings, then renew the league for next season when you are ready.',
        commissionerMessage: 'Review the final standings, then renew the league for next season when you are ready.',
        memberMessage: 'The season is over. Waiting on the commissioner to renew the league for next season.',
        waitingOn: 'The commissioner',
        action: { tab: 'standings', label: 'Final standings' },
        ...overrides.offseason,
      },
    },
  }
}

const TOURNAMENT: FormatGuide = lifecycleGuide('tournament', 'Tournament', {
  setup: {
    memberMessage: 'Waiting on the tournament to fill and the drafts to be scheduled.',
    actorMessage: 'Fill the tournament and schedule each league’s draft. Round 1 starts after the drafts.',
    commissionerMessage: 'Fill the tournament and schedule each league’s draft.',
  },
  inSeason: {
    title: 'Tournament round: Week {week}',
    actorMessage: 'Set your lineup. The top teams in each league advance when the round ends.',
    memberMessage: 'Set your lineup. The top teams in each league advance when the round ends.',
    commissionerMessage: 'The round is running. Advancement is decided by standings when it ends.',
  },
})

const BEST_BALL = lifecycleGuide('best_ball', 'Best Ball', {
  inSeason: {
    actorMessage: 'Nothing to set: best ball starts your highest-scoring lineup for you. Watch the waiver wire for depth.',
    memberMessage: 'Nothing to set: best ball starts your highest-scoring lineup for you.',
    action: { tab: 'matchups', label: 'Open matchup' },
  },
})

const DYNASTY = lifecycleGuide('dynasty', 'Dynasty', {
  offseason: {
    title: 'Dynasty offseason',
    actorMessage: 'Renew the league, set the rookie draft and settle taxi squads. Rosters carry over.',
    commissionerMessage: 'Renew the league, set the rookie draft and settle taxi squads. Rosters carry over.',
    memberMessage: 'Rosters carry over. Trade picks and prepare for the rookie draft while the commissioner renews.',
    action: { tab: 'dynasty_picks', label: 'Draft picks' },
  },
})

const KEEPER = lifecycleGuide('keeper', 'Keeper', {
  offseason: {
    title: 'Keeper offseason',
    actorMessage: 'Renew the league and open keeper selection so everyone can choose who they keep.',
    commissionerMessage: 'Renew the league and open keeper selection so everyone can choose who they keep.',
    memberMessage: 'Waiting on the commissioner to open keeper selection for next season.',
    action: { tab: 'keeper', label: 'Keepers' },
  },
})

const DEVY = lifecycleGuide('devy', 'Devy', {
  offseason: {
    title: 'Devy offseason',
    actorMessage: 'Renew the league. College players who declared move up to your pro roster.',
    commissionerMessage: 'Renew the league. College players who declared move up to the pro rosters.',
    memberMessage: 'Waiting on the commissioner to renew the league. Declared college players move to pro rosters.',
  },
})

const C2C = lifecycleGuide('c2c', 'Campus to Canton', {
  inSeason: {
    actorMessage: 'Set your lineup — your college (campus) and pro (canton) starters both count toward your score.',
    memberMessage: 'Set your lineup — your college (campus) and pro (canton) starters both count toward your score.',
  },
})

const SALARY_CAP = lifecycleGuide('salary_cap', 'Salary Cap', {
  offseason: {
    title: 'Salary cap offseason',
    actorMessage: 'Renew the league. Contracts roll over, so check every team is under the cap.',
    commissionerMessage: 'Renew the league. Contracts roll over, so check every team is under the cap.',
    memberMessage: 'Contracts roll over. Check your cap space before the next season.',
  },
})

const IDP = lifecycleGuide('idp', 'IDP', {
  inSeason: {
    actorMessage: 'Set your lineup — including your defensive players — before they lock.',
    memberMessage: 'Set your lineup — including your defensive players — before they lock.',
  },
})

// ── Imported leagues (Sleeper, ESPN, Fantrax, MFL, Fleaflicker) ──────────────────────────────

/*
 * ⚠ ALLFANTASY IS READ-ONLY FOR AN IMPORTED LEAGUE (lib/league-links/sourceLinkResolver.ts header),
 * so every action button opens the HOST, never a tab here, and every line says so.
 *
 * ⚠ PHASES ARE THE PROVIDER'S OWN STATUS, AND ONLY WHEN IT SENT ONE. Sleeper reports
 * pre_draft / drafting / in_season / complete; several providers report nothing, which must not read
 * as "getting ready" in the middle of a season — that is the `unknown` phase. No week number either:
 * an imported season's current week defaults to 1 (canonicalSeasonMaterialization).
 */
const IMPORTED: FormatGuide = {
  format: 'imported',
  label: 'Imported league',
  phases: {
    unknown: {
      title: 'Your {platform} league',
      actor: 'automatic',
      commissionerMessage: 'AllFantasy reads this league from {platform}. Run it there — settings, the draft and lineups — and this page picks up the changes on the next sync.',
      memberMessage: 'AllFantasy reads this league from {platform}. Set lineups and make moves there; this page picks them up on the next sync.',
      action: { href: '{hostLeagueUrl}', external: true, label: 'Open on {platform}' },
    },
    pre_draft: {
      title: 'Your draft hasn’t been scheduled',
      actor: 'commissioner',
      actorMessage: 'Schedule the draft on {platform}. AllFantasy picks up the date on the next sync.',
      commissionerMessage: 'Schedule the draft on {platform}. AllFantasy picks up the date on the next sync.',
      memberMessage: 'Waiting on your commissioner to schedule the draft on {platform}. Mock draft here meanwhile.',
      waitingOn: 'The commissioner',
      action: { href: '{hostLeagueUrl}', external: true, label: 'Open on {platform}' },
    },
    draft_scheduled: {
      title: 'Your draft is scheduled on {platform}',
      actor: 'everyone',
      actorMessage: 'Get ready: mock draft here with your league’s settings, then draft on {platform}.',
      commissionerMessage: 'The draft is scheduled on {platform}.',
      memberMessage: 'Get ready: mock draft here with your league’s settings, then draft on {platform}.',
      action: { href: '{hostLeagueUrl}', external: true, label: 'Open on {platform}' },
    },
    drafting: {
      title: 'Your draft is live on {platform}',
      actor: 'everyone',
      actorMessage: 'Your draft is happening now on {platform}.',
      commissionerMessage: 'The draft is live on {platform}.',
      memberMessage: 'Your draft is happening now on {platform}.',
      action: { href: '{hostLeagueUrl}', external: true, label: 'Go to the draft on {platform}' },
    },
    in_season: {
      title: 'The season is on',
      actor: 'everyone',
      actorMessage: 'Set your lineup on {platform} before your players lock. AllFantasy picks it up on the next sync.',
      commissionerMessage: 'The season is running on {platform}. League Health here flags anything that needs you.',
      memberMessage: 'Set your lineup on {platform} before your players lock.',
      action: { href: '{hostLineupUrl}', external: true, label: 'Set my lineup on {platform}' },
    },
    complete: {
      title: 'The season is over',
      actor: 'commissioner',
      actorMessage: 'Renew the league on {platform} when you’re ready for next season.',
      commissionerMessage: 'Renew the league on {platform} when you’re ready for next season.',
      memberMessage: 'The season is over. Waiting on your commissioner to renew the league on {platform}.',
      waitingOn: 'The commissioner',
      action: { href: '{hostLeagueUrl}', external: true, label: 'Open on {platform}' },
    },
  },
}

const REDRAFT = lifecycleGuide('redraft', 'Redraft')

export const FORMAT_GUIDES: Record<WhatsNextFormatId, FormatGuide> = {
  big_brother: BIG_BROTHER,
  survivor: SURVIVOR,
  zombie: ZOMBIE,
  guillotine: GUILLOTINE,
  tournament: TOURNAMENT,
  pirate: PIRATE,
  redraft: REDRAFT,
  dynasty: DYNASTY,
  keeper: KEEPER,
  best_ball: BEST_BALL,
  devy: DEVY,
  c2c: C2C,
  salary_cap: SALARY_CAP,
  idp: IDP,
  imported: IMPORTED,
}

/** Formats whose phase comes from their own summary route; the rest use the season lifecycle. */
export const ENGINE_FORMATS = ['big_brother', 'survivor', 'zombie', 'guillotine', 'pirate'] as const
export type EngineFormat = (typeof ENGINE_FORMATS)[number]

export function isEngineFormat(format: WhatsNextFormatId): format is EngineFormat {
  return (ENGINE_FORMATS as readonly string[]).includes(format)
}
