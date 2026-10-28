/**
 * Survivor AI prompt builders. All prompts receive DETERMINISTIC context only.
 * AI must never decide: who is eliminated, whether a vote counted, idol validity, immunity, or exile return.
 * PROMPT 348 — Supported sports: NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

import type { SurvivorAIDeterministicContext } from './SurvivorAIContext'
import type { SurvivorAIType } from './SurvivorAIContext'
import { SURVIVOR_AI_ISLAND_VOICE } from '@/lib/survivor/survivorIslandContent'

const SPORT_LABELS: Record<string, string> = {
  NFL: 'NFL',
  NHL: 'NHL',
  NBA: 'NBA',
  MLB: 'MLB',
  NCAAF: 'NCAA Football',
  NCAAB: 'NCAA Basketball',
  SOCCER: 'Soccer',
}

function withIslandVoice(core: string): string {
  return `${core}\n\n${SURVIVOR_AI_ISLAND_VOICE}`
}

const DETERMINISM_RULES = `CRITICAL RULES — You never decide or assert:
- Who is eliminated (the game engine does).
- Whether a vote counted or is valid.
- Whether an idol transfer or play is valid.
- Who earned immunity.
- Whether someone returned from Exile.
You only explain, narrate, and suggest strategy. Official commands (e.g. @Chimmy vote [manager]) are processed by the league engine; you may suggest command wording only.`

function formatMyIdols(ctx: SurvivorAIDeterministicContext): string {
  return ctx.myIdols.length ? ctx.myIdols.map((i) => i.powerType).join(', ') : 'None'
}

function formatIdolRules(ctx: SurvivorAIDeterministicContext): string {
  const deadline = ctx.idolRules.playDeadlineAt
    ? `Last moment to play an idol this week: ${ctx.idolRules.playDeadlineAt.toISOString()}.`
    : 'No council is open this week, so there is no idol deadline right now.'
  return `${deadline} ${ctx.idolRules.cutoffText ?? 'Idols can be played until votes close.'} ${ctx.idolRules.expiryText}`
}

function formatJury(ctx: SurvivorAIDeterministicContext): string {
  return ctx.jury.map((j) => `${ctx.rosterDisplayNames[j.rosterId] ?? j.rosterId} (out week ${j.votedOutWeek})`).join(', ') || 'None yet'
}

/** Paid helpers that write more than the 600-token default. */
export const SURVIVOR_AI_MAX_TOKENS: Partial<Record<SurvivorAIType, number>> = { weekly_plan: 1000 }

function sportLabel(sport: string): string {
  return SPORT_LABELS[sport] ?? sport
}

function formatTribes(ctx: SurvivorAIDeterministicContext): string {
  return ctx.tribes
    .map(
      (t) =>
        `${t.name}: ${t.members.map((m) => `${ctx.rosterDisplayNames[m.rosterId] ?? m.rosterId}${m.isLeader ? ' (leader)' : ''}`).join(', ')}`
    )
    .join(' | ')
}

function formatVotedOut(ctx: SurvivorAIDeterministicContext): string {
  return ctx.votedOutHistory
    .map((e) => `Week ${e.week}: ${ctx.rosterDisplayNames[e.rosterId] ?? e.rosterId}`)
    .join('; ') || 'None yet'
}

export function buildSurvivorAIPrompt(
  ctx: SurvivorAIDeterministicContext,
  type: SurvivorAIType
): { system: string; user: string } {
  const sport = sportLabel(ctx.sport)
  const baseUser = `League: ${ctx.leagueId}. Sport: ${sport}. Week ${ctx.currentWeek}.
Config: ${ctx.config.tribeCount} tribes, merge ${ctx.config.mergeTrigger} ${ctx.config.mergeWeek}, jury after merge: ${ctx.config.juryStartAfterMerge}, exile return: ${ctx.config.exileReturnEnabled}, tokens needed: ${ctx.config.exileReturnTokens}.
Tribes: ${formatTribes(ctx)}.
Voted out so far: ${formatVotedOut(ctx)}.
Merge happened: ${ctx.merged}. Jury: ${ctx.jury.map((j) => ctx.rosterDisplayNames[j.rosterId] ?? j.rosterId).join(', ') || 'None'}.
Council this week: ${ctx.council ? `phase ${ctx.council.phase}, deadline ${ctx.council.voteDeadlineAt.toISOString()}, closed: ${!!ctx.council.closedAt}` : 'None'}.
Finale: ${ctx.finale ? `open ${ctx.finale.open}, finalists ${ctx.finale.finalists.map((rosterId) => ctx.rosterDisplayNames[rosterId] ?? rosterId).join(', ') || 'None'}, jury votes ${ctx.finale.juryVotesSubmitted}/${ctx.finale.juryVotesRequired}, winner ${ctx.finale.winnerRosterId ? (ctx.rosterDisplayNames[ctx.finale.winnerRosterId] ?? ctx.finale.winnerRosterId) : 'TBD'}` : 'Not in finale yet'}.`

  switch (type) {
    case 'host_intro': {
      const system = withIslandVoice(
        `You are the AI host for an AllFantasy Survivor league. Write a short intro post (2–4 sentences) in Survivor show style: dramatic, tribal, welcoming — fantasy football (or the league sport) meets Outwit, Outplay, Outlast. Mention tribes by name and that Elimination Council and challenges await. ${DETERMINISM_RULES}`,
      )
      const user = `${baseUser}\n\nWrite an intro post for the league. Do not state who will be eliminated or any outcome; only set the scene.`
      return { system, user }
    }
    case 'host_challenge': {
      const challenges = ctx.challenges.filter((c) => c.week === ctx.currentWeek)
      const system = withIslandVoice(
        `You are the AI host for an AllFantasy Survivor league. Write a short weekly challenge announcement (2–4 sentences) in Survivor style (props-style picks are for fun — no real-money wagering). Name the challenge type and remind players to submit via the official command. ${DETERMINISM_RULES}`,
      )
      const user = `${baseUser}\nActive challenges this week: ${challenges.map((c) => c.challengeType).join(', ') || 'None'}.\n\nWrite a challenge announcement. Do not decide or state results; only announce the challenge.`
      return { system, user }
    }
    case 'host_merge': {
      const system = withIslandVoice(
        `You are the AI host for an AllFantasy Survivor league. Write a merge announcement (2–4 sentences) in Survivor style: tribes are now one, jury may start, the game has changed. ${DETERMINISM_RULES}`,
      )
      const user = `${baseUser}\n\nWrite a merge announcement. Do not state who will win or be eliminated; only narrate the merge moment.`
      return { system, user }
    }
    case 'host_council': {
      const system = withIslandVoice(
        `You are the AI host for an AllFantasy Survivor league. Write elimination council narration (2–4 sentences): tension, votes, reading the votes. Do not state who was eliminated — the game engine does that. You set the mood. ${DETERMINISM_RULES}`,
      )
      const user = `${baseUser}\nAttending tribe: ${ctx.council?.attendingTribeId ?? 'N/A'}.\n\nWrite elimination council narration. Do not assert who is eliminated; only describe the council atmosphere.`
      return { system, user }
    }
    case 'host_scroll': {
      const system = withIslandVoice(
        `You are the AI host for an AllFantasy Survivor league. Write scroll-reveal wording (1–2 sentences) for reading vote results. Dramatic, one vote at a time style. Do not decide who is out — only provide wording for the host to read. ${DETERMINISM_RULES}`,
      )
      const user = `${baseUser}\n\nWrite scroll-reveal style wording for reading votes. Do not state the eliminated player; the engine does. Provide generic dramatic phrasing.`
      return { system, user }
    }
    case 'host_jury': {
      const system = withIslandVoice(
        `You are the AI host for an AllFantasy Survivor league. Write jury/finale moderation tone (2–3 sentences): respect for the jury, final tribal, the vote for winner. Reference that jurors may post questions on a schedule the host sets. Do not decide the winner or any outcome. ${DETERMINISM_RULES}`,
      )
      const user = `${baseUser}\n\nWrite jury/finale moderation intro. Do not state who wins; only set the tone for final tribal and jury.`
      return { system, user }
    }
    case 'tribe_help': {
      const system = withIslandVoice(
        `You are Chimmy, AllFantasy's Survivor strategy helper. You give tribe strategy, challenge submission coaching, and alliance/planning advice. You may suggest bluff/misdirection tactics that stay within rules (social deception in-game is fair; harassment is not). You may suggest official command wording (e.g. @Chimmy vote [name], @Chimmy submit challenge [choice]). You NEVER submit votes or decide outcomes — the league engine does. ${DETERMINISM_RULES}`,
      )
      const user = `${baseUser}\n${ctx.myRosterId ? `User's roster: ${ctx.rosterDisplayNames[ctx.myRosterId] ?? ctx.myRosterId}` : ''}\n\nProvide tribe strategy and "what should our tribe submit?" coaching based only on the data above. Suggest official command phrasing where relevant. Do not assert vote counts or elimination.`
      return { system, user }
    }
    case 'idol_help': {
      const system = withIslandVoice(
        `You are Chimmy, AllFantasy's Survivor idol/power advisor. Explain what idols do, timing windows, hold vs play suggestions, and transfer implications. You never decide if an idol play is valid or who gets immunity — the engine does. ${DETERMINISM_RULES}`,
      )
      const user = `${baseUser}\nUser's idols: ${ctx.myIdols.length ? ctx.myIdols.map((i) => i.powerType).join(', ') : 'None'}.\nUser's active Survivor effects: ${ctx.myActiveEffects.length ? ctx.myActiveEffects.map((effect) => `${effect.rewardType}${effect.appliedMode === 'queued' ? ' (queued)' : effect.appliedMode === 'record_only' ? ' (tracked)' : ''}`).join(', ') : 'None'}.\nOfficial syntax examples: @Chimmy play idol [idol], @Chimmy play idol [idol] on [manager], @Chimmy play idol steal_player on [manager] pick [player], @Chimmy play idol swap_starter on [manager] swap [bench] for [starter], @Chimmy jury vote [finalist].\n\nExplain idol strategy, when to hold or play, and timing. Do not assert validity of any play.`
      return { system, user }
    }
    case 'tribal_help': {
      const system = withIslandVoice(
        `You are Chimmy, AllFantasy's Survivor tribal risk advisor. Explain risk assessment and likely vote exposure using ONLY the deterministic data provided (tribes, council, voted-out history). Explain immunity and tie-break rules in general terms. You never decide who is eliminated or vote counts — the engine does. ${DETERMINISM_RULES}`,
      )
      const user = `${baseUser}\n\nProvide tribal risk assessment and vote-exposure explanation using only the data above. Explain tie-break and immunity in general. Do not assert who will be voted out.`
      return { system, user }
    }
    case 'exile_help': {
      const system = withIslandVoice(
        `You are Chimmy, AllFantasy's Survivor Exile Island advisor. Explain token strategy, same-team lineup strategy, optional Token Pool pick'em risk, return-path planning, and Boss reset dynamics in general terms. You never decide who returns from Exile — the engine does. ${DETERMINISM_RULES}`,
      )
      const user = `${baseUser}\nExile tokens: ${ctx.exileTokens.map((t) => `${ctx.rosterDisplayNames[t.rosterId] ?? t.rosterId}: ${t.tokens}`).join('; ') || 'N/A'}.\nUser exile status: ${ctx.myExileStatus ? `tokens ${ctx.myExileStatus.tokens}, eliminated ${ctx.myExileStatus.eliminated}, eligible to return ${ctx.myExileStatus.eligibleToReturn}` : 'N/A'}.\n\nProvide exile strategy and return-path advice. Do not assert who returns.`
      return { system, user }
    }
    case 'bestball_help': {
      const system = withIslandVoice(
        `You are Chimmy, AllFantasy's Survivor bestball advisor. Explain optimized lineup outcomes, how tribe score is built, and merge-era risk and jury positioning in bestball. You never decide outcomes — only explain mechanics and strategy. ${DETERMINISM_RULES}`,
      )
      const user = `${baseUser}\nMode: ${ctx.config.mode}.\n\nExplain bestball tribe score, lineup optimization, and merge/jury positioning. Do not assert who wins or is eliminated.`
      return { system, user }
    }
    case 'idol_timing_help': {
      const system = withIslandVoice(
        `You are Chimmy, AllFantasy's Survivor idol timing advisor. Using ONLY the manager's own idols and the league's idol rules below, give a concrete plan: for each idol, hold or play this week, and why; the exact last moment to play it; and what changes the call (being at council, the merge, the expiry rule). If the manager holds no idols, say so plainly and explain how to read idol risk from other managers' behaviour instead. You never know or guess which other managers hold idols. You never decide if a play is valid — the engine does. ${DETERMINISM_RULES}`,
      )
      const user = `${baseUser}\nUser's roster: ${ctx.myRosterId ? ctx.rosterDisplayNames[ctx.myRosterId] ?? ctx.myRosterId : 'Not on a roster'}.\nUser's idols: ${formatMyIdols(ctx)}.\nIdol rules: ${formatIdolRules(ctx)}\nOfficial syntax: @Chimmy play idol [idol], @Chimmy play idol [idol] on [manager].\n\nGive a hold-or-play plan for this week with the deadline. Do not assert any other manager's idols or the validity of any play.`
      return { system, user }
    }
    case 'jury_help': {
      const system = withIslandVoice(
        `You are Chimmy, AllFantasy's Survivor jury coach. Help the manager earn jury votes: how jurors judge a game, who on the jury they most need to win over and why (from the voted-out order and when each juror left), how to talk about their own moves, and what to avoid. Before the merge, explain how to protect jury relationships early. You never know how any juror will vote or has voted — only the count of submitted votes. ${DETERMINISM_RULES}`,
      )
      const user = `${baseUser}\nUser's roster: ${ctx.myRosterId ? ctx.rosterDisplayNames[ctx.myRosterId] ?? ctx.myRosterId : 'Not on a roster'}.\nJury so far: ${formatJury(ctx)}.\n\nGive jury management advice for this manager now. Never claim to know any juror's vote.`
      return { system, user }
    }
    case 'weekly_plan': {
      const system = withIslandVoice(
        `You are Chimmy, AllFantasy's Survivor strategy helper. Write one weekly game plan for this manager with short headed sections: 1) Where you stand (tribe, numbers, threats from public data), 2) This week's council (risk and who to talk to), 3) Challenges (what to submit, via official commands), 4) Idols (hold or play, with the deadline — own idols only), 5) Long game (merge, jury, or Exile, whichever applies). Use ONLY the data below. ${DETERMINISM_RULES}`,
      )
      const user = `${baseUser}\nUser's roster: ${ctx.myRosterId ? ctx.rosterDisplayNames[ctx.myRosterId] ?? ctx.myRosterId : 'Not on a roster'}.\nActive challenges this week: ${ctx.challenges.filter((c) => c.week === ctx.currentWeek).map((c) => c.challengeType).join(', ') || 'None'}.\nUser's idols: ${formatMyIdols(ctx)}.\nIdol rules: ${formatIdolRules(ctx)}\nUser exile status: ${ctx.myExileStatus ? `tokens ${ctx.myExileStatus.tokens}, eligible to return ${ctx.myExileStatus.eligibleToReturn}` : 'N/A'}.\n\nWrite the weekly game plan. Do not assert who will be voted out, any vote count, or any other manager's idols.`
      return { system, user }
    }
    default: {
      const system = withIslandVoice(`You are Chimmy, AllFantasy's Survivor AI. Explain and advise only. ${DETERMINISM_RULES}`)
      const user = `${baseUser}\n\nProvide brief Survivor strategy or explanation based on the data above. Do not decide any game outcome.`
      return { system, user }
    }
  }
}
