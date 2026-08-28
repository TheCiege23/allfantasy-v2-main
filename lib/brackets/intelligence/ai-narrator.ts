import OpenAI from "openai"
import { assertAiSpendAllowed } from '@/lib/ai/aiSpendGuard'

function getOpenAIClient() {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY

  // PROVIDER BOUNDARY. Guard form matches this function's own contract: it
  // already throws when the key is absent, so a spend refusal behaves
  // identically to an unconfigured provider. Above the key check because when
  // both are missing the switch is the actionable one.
  assertAiSpendAllowed('bracket-narrator')

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing")
  }

  return new OpenAI({
    apiKey,
    baseURL:
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      "https://api.openai.com/v1",
  })
}

type NarratorInput = {
  context: Record<string, any>
  prompt: string
  maxTokens?: number
}

async function generateNarrative(input: NarratorInput): Promise<string> {
  const openai = getOpenAIClient()
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a March Madness bracket analyst for AllFantasy. Be confident, concise, and data-driven. Use the provided data — never make up statistics. Keep responses engaging but grounded.",
        },
        {
          role: "user",
          content: `${input.prompt}\n\nDATA:\n${JSON.stringify(input.context, null, 2)}`,
        },
      ],
      max_tokens: input.maxTokens ?? 200,
      temperature: 0.7,
    })

    return response.choices[0]?.message?.content?.trim() ?? ""
  } catch (err) {
    console.error("[ai-narrator] Error:", err)
    return ""
  }
}

export async function narrateMatchup(data: {
  teamA: string
  teamB: string
  winProbA: number
  winProbB: number
  publicPickPctA: number
  publicPickPctB: number
  seedA: number | null
  seedB: number | null
  round: number
  leverageScore: number
}): Promise<string> {
  return generateNarrative({
    context: data,
    prompt: "Write 2-3 concise sentences explaining this matchup for a casual bracket player. Use the data provided. Be confident and clear. Mention win probability, public pick %, and any leverage angle if the leverage score is above 0.3.",
  })
}

export async function narrateSleeper(data: {
  team: string
  sleeperScore: number
  label: string
  opponent: string
  seedTeam: number | null
  seedOpponent: number | null
  publicPickPct: number
  factors: Record<string, number>
}): Promise<string> {
  return generateNarrative({
    context: data,
    prompt: "Write 1-2 sentences explaining why this team is a sleeper upset pick. Reference the sleeper score factors. Be exciting but honest about the risk.",
  })
}

export async function narrateStoryMode(data: {
  currentRank: number
  totalEntries: number
  winProbability: number
  uniquenessScore: number
  alivePct: number
  currentPoints: number
  maxPossible: number
  riskExposure: number
  championAlive?: boolean
  finalFourAlive?: number
  finalFourTotal?: number
  upside?: number
  remainingPoints?: number
}): Promise<string> {
  return generateNarrative({
    context: data,
    prompt:
      "Write a 2–3 sentence dynamic storyline for this bracket user during the tournament.\n" +
      "Tone: exciting but grounded, like a smart sports broadcast.\n" +
      "Use ONLY the data provided; do NOT invent specific scores or guarantees.\n" +
      "- Mention their rank and pool size.\n" +
      "- Mention alive percentage and remaining points if meaningful.\n" +
      "- Mention whether the champion and Final Four core are still alive if that is in the data.\n" +
      "- Mention win probability and uniqueness only as estimates or context, never as promises.\n" +
      "Make it engaging but clear that outcomes are uncertain.",
  })
}

export async function narrateTrashTalk(data: {
  eventType: string
  headline: string
  detail: string
  metadata: Record<string, any>
}): Promise<string> {
  return generateNarrative({
    context: data,
    prompt: "Write a short playful trash-talk message about this bracket event. Keep it under 20 words. Be witty and fun, not mean.",
    maxTokens: 50,
  })
}

export async function narratePostTournament(data: {
  totalPoints: number
  accuracy: number
  correctPicks: number
  totalPicks: number
  bestLeveragePick: { team: string; leverageGained: number } | null
  worstEvMistake: { team: string; publicPct: number } | null
  pointsLeftOnTable: number
  upsetsCalled: number
  upsetsCorrect: number
  finalRank: number
  totalEntries: number
}): Promise<string> {
  return generateNarrative({
    context: data,
    prompt: "Write a 3-4 sentence post-tournament summary for this bracket player. Highlight their best move, biggest mistake, and overall performance. Be constructive and encouraging. End with a forward-looking statement about next year.",
    maxTokens: 300,
  })
}
