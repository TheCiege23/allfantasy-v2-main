import 'server-only'

import { openaiChatText } from '@/lib/openai-client'
import { stripChimmyMentionPrefix } from '@/lib/chat-core/mentionPrivacyFilter'
import { loadLeagueGroundingForUser } from '@/lib/chimmy/chimmy-league-snapshot'
import { buildHeadToHeadGrounding } from '@/lib/chimmy/headToHeadGrounding'
import { buildLeagueStandingsContext } from '@/lib/chimmy/leagueStandingsGrounding'
import { prepareChimmyDecisionAnswer } from '@/lib/chimmy/decisionAnswerService'
import type { ChimmyDecisionAnswer } from '@/lib/chimmy/decisionAnswerContract'
import { recordChatStartSitAdvice } from '@/lib/chimmy-advice/chatStartSitAdvice'
import { consumeRateLimit } from '@/lib/rate-limit'
import {
  readChimmyPlanAllowance,
  releaseChimmyPlanAllowance,
  takeChimmyPlanAllowance,
} from '@/lib/chimmy/planAllowance'
import { runChimmyToolLoop } from '@/lib/chimmy/tools/chimmyToolLoop'
import { CHIMMY_TOOL_LOOP_SYSTEM_PROMPT } from '@/lib/chimmy/tools/toolLoopSystemPrompt'
import type { ChatStartCall } from '@/lib/chimmy/tools/chimmyTools'
import { enforceTradeLetters, type ChimmyTradeGrade } from '@/lib/chimmy/tradeGradeCheck'

/** Two newlines, kept as a constant so an editing pass cannot flatten it. */
const NEWLINES = String.fromCharCode(10, 10)

const NO_LEAGUE_NOTE =
  'CONTEXT: this conversation is not attached to a league, so you have no roster, standings or matchup data here. Say that plainly if the question needs it, and point the reader at the Chimmy panel on a league page rather than guessing.'

/**
 * What the model is allowed to know, assembled from the same builders the
 * Chimmy panel uses. Every failure degrades to a statement that the data is
 * absent rather than to silence, because silence is what the model fills in.
 */
async function buildPrivateGrounding(context: {
  leagueId?: string | null
  userId?: string | null
}): Promise<string> {
  const { leagueId, userId } = context
  if (!leagueId || !userId) return NO_LEAGUE_NOTE

  /*
   * `loadLeagueGroundingForUser` is the GATE, not the content. It answers "is
   * this person actually in this league" — grounding a league somebody is not a
   * member of would leak another league's standings into a private reply. The
   * facts come from the same exported builders the Chimmy panel uses, so there
   * is one implementation of each rather than a second copy living here.
   *
   * ⚠ The signature is `(userId, leagueId)`. This call had them swapped from
   * 2026-08-26, so every member was refused and every @chimmy reply here was told
   * the league "could not be loaded". The failure is closed, so it leaked nothing
   * and looked like an ordinary sync gap.
   */
  const access = await loadLeagueGroundingForUser(userId, leagueId).catch(() => null)
  if (!access || !access.ok) {
    const reason = access && !access.ok ? access.reason : 'error'
    return `CONTEXT: this league's data could not be loaded (${reason}). Do not describe the roster, standings or history; say plainly that you could not read them.`
  }

  const blocks: string[] = []

  try {
    const standings = await buildLeagueStandingsContext(leagueId, userId)
    if (standings) blocks.push(standings)
  } catch {
    /* Non-fatal: a reply without standings is still a reply. */
  }

  try {
    const h2h = await buildHeadToHeadGrounding(leagueId)
    if (h2h) blocks.push(h2h.text)
  } catch {
    /* Rivalry history is a bonus here, not a requirement. */
  }

  if (blocks.length === 0) {
    return "CONTEXT: this league is real and you are a member, but it has no standings or matchup history stored yet. Do not invent either."
  }

  return blocks.join(NEWLINES)
}


/**
 * Short Chimmy reply for a private @chimmy message — only the sender sees it.
 *
 * ⚠ THIS RAN COMPLETELY BLIND. The `leagueId` argument was named `_leagueId`
 * and never read, so @chimmy in a league chat reached a model that had been
 * told "never invent player or league stats" and then given no league, no
 * roster and no standings to work from. The same assistant answering in the
 * drawer has a dozen grounding builders behind it. Asking "who should I start"
 * in league chat and in the panel got answers of completely different quality,
 * from what looks like the same assistant.
 *
 * ⚠ WHERE THERE IS NO LEAGUE, IT SAYS SO IN THE PROMPT. A DM has no league to
 * ground against, and a model that does not know it is missing the data is the
 * one that fills the gap in confidently.
 */
export async function generateChimmyPrivateReply(
  prompt: string,
  context: { leagueId?: string | null; userId?: string | null; onDecision?: (decision: ChimmyDecisionAnswer) => void } = {},
): Promise<string> {
  const userContent = stripChimmyMentionPrefix(prompt).slice(0, 4000)
  if (!userContent.trim()) {
    return "Hey — what would you like help with? Add your question after @chimmy."
  }

  // Consequential advice uses the same authenticated engines as the full Chimmy surface.
  // Neither a missing engine result nor an engine verdict is handed to a model to replace.
  const decision = await prepareChimmyDecisionAnswer({ question: userContent, leagueId: context.leagueId, userId: context.userId })
  if (decision) {
    if (context.userId && decision.status === 'ready' && decision.startCalls?.length) {
      await recordChatStartSitAdvice({ userId: context.userId, calls: decision.startCalls, answer: decision.answer }).catch(() => null)
    }
    context.onDecision?.(decision)
    return decision.answer
  }

  /*
   * 🛑 EVERYTHING THAT WAS NOT A DECISION QUESTION REACHED A WEAKER, UNMETERED ASSISTANT. The panel
   * answers through the tool loop (rosters, matchups, injuries, the engines, the "facts + confidence"
   * rules); this path made one bare OpenAI call with standings and head-to-head only, and no plan or
   * rate check — so the most public place Chimmy speaks gave the worst answer, at an open cost.
   *
   * Now: a member of the league (membership proven here, never assumed from the client's id) whose
   * plan includes Chimmy with allowance left gets the SAME tool loop and prompt as the panel, paid
   * from the SAME daily allowance (given back when no answer arrives). Everyone else keeps the short
   * grounded answer they had — rate-limited, so it is no longer an uncapped model call.
   */
  const provenLeagueId = context.leagueId && context.userId ? await provenMembership(context.userId, context.leagueId) : null
  const full = context.userId
    ? await answerWithToolLoop({ question: userContent, userId: context.userId, leagueId: provenLeagueId }).catch(() => null)
    : null
  if (full) return full

  if (context.userId) {
    const limited = consumeRateLimit({
      scope: 'chimmy',
      action: 'chat_private_reply',
      sleeperUsername: context.userId,
      maxRequests: FALLBACK_REPLIES_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    })
    if (!limited.success) {
      return "You've asked @chimmy a lot this hour. Open the Chimmy panel for more, or try again a little later."
    }
  }

  const grounding = await buildPrivateGrounding(context)

  const result = await openaiChatText({
    temperature: 0.5,
    maxTokens: 600,
    messages: [
      {
        role: 'system',
        content: `You are Chimmy, the calm, analytical AI assistant for AllFantasy fantasy sports. Be concise, helpful, and never invent player or league stats. If context is missing, ask a brief clarifying question.

${grounding}`,
      },
      { role: 'user', content: userContent },
    ],
  })

  if (result.ok && result.text.trim()) {
    return result.text.trim()
  }

  return "I'm having trouble reaching the AI right now. Try again in a moment, or open the full Chimmy panel from the dashboard."
}

/** The short fallback answers per user per hour. Generous for a person; a ceiling for a script. */
export const FALLBACK_REPLIES_PER_HOUR = 20

/** The tool loop's own budget in a chat thread, and the cap after which the quick answer is used. */
export const CHAT_LOOP_BUDGET_MS = 20_000
export const CHAT_LOOP_HARD_CAP_MS = 28_000

/**
 * Chat-only instructions, sent after the shared (cached) prompt. A reply in a chat thread is read in
 * a bubble and only the asker sees it; it cannot carry a confirm card (the propose tools already say
 * so when no card collector is passed), and it must not quote anyone's private messages.
 */
export const CHAT_REPLY_STYLE =
  'WHERE THIS ANSWER APPEARS: a private reply inside a chat thread, seen only by the person who asked. ' +
  'Keep it short: the call and its evidence in about 120 words. ' +
  'Nothing you do here can change a lineup or send a trade; if they want a move made, give your recommendation and tell them to make it in the league, or in the Chimmy panel where a confirm card can be shown.'

async function provenMembership(userId: string, leagueId: string): Promise<string | null> {
  const access = await loadLeagueGroundingForUser(userId, leagueId).catch(() => null)
  return access && access.ok ? leagueId : null
}

/**
 * The panel's tool loop for a plan holder with allowance left, or null (caller falls back). Never
 * throws past the caller's `.catch`; an included answer that never arrives is given back.
 */
async function answerWithToolLoop(args: {
  question: string
  userId: string
  leagueId: string | null
}): Promise<string | null> {
  const plan = await readChimmyPlanAllowance({ userId: args.userId }).catch(() => null)
  if (!plan || plan.remaining <= 0) return null
  const taken = await takeChimmyPlanAllowance({ userId: args.userId, state: plan }).catch(() => null)
  if (!taken) return null

  const context = {
    leagueId: args.leagueId,
    userId: args.userId,
    startCalls: [] as ChatStartCall[],
    tradeGrades: [] as ChimmyTradeGrade[],
  }
  const loopArgs = {
    question: args.question,
    systemPrompt: CHIMMY_TOOL_LOOP_SYSTEM_PROMPT,
    clockLine: `CURRENT DATE AND TIME (UTC): ${new Date().toISOString()}`,
    styleLine: CHAT_REPLY_STYLE,
    conversation: [],
    context,
    enabled: true,
    budgetMs: CHAT_LOOP_BUDGET_MS,
  }
  /*
   * The sender's own message is held until this reply exists (the chat routes return both together),
   * so the full assistant gets a chat-sized budget and a hard cap. Past the cap the quick answer is
   * given instead and the included answer goes back — a person waiting on a spinner is the worse cost.
   */
  let capTimer: ReturnType<typeof setTimeout> | undefined
  const loop = await Promise.race([
    runChimmyToolLoop(loopArgs).catch(() => null),
    new Promise<null>((resolve) => {
      capTimer = setTimeout(() => resolve(null), CHAT_LOOP_HARD_CAP_MS)
    }),
  ]).finally(() => clearTimeout(capTimer))
  let text = loop?.text?.trim() || ''
  if (text) {
    // The same rule as the panel: a trade letter in the answer must be one the engine gave.
    const held = await enforceTradeLetters({
      answer: text,
      grades: context.tradeGrades,
      retry: async (correction) =>
        (await runChimmyToolLoop({ ...loopArgs, question: `${args.question}\n\n${correction}` }).catch(() => null))?.text ?? null,
    }).catch(() => null)
    if (held) text = held.text.trim()
  }
  if (!text) {
    await releaseChimmyPlanAllowance({ userId: args.userId, state: taken }).catch(() => false)
    return null
  }
  if (context.startCalls.length > 0) {
    await recordChatStartSitAdvice({ userId: args.userId, calls: context.startCalls, answer: text }).catch(() => null)
  }
  return text
}
