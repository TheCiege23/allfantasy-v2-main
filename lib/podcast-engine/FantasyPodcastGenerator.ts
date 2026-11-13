/**
 * Generates weekly fantasy podcast script: league recap, top waiver targets, player performance summaries.
 * Can be extended with AI or real league/waiver data.
 */
import type { GeneratedPodcastScript, PodcastScriptSection } from "./types"
import { normalizeToSupportedSport } from "@/lib/sport-scope"

interface GenerateOptions {
  leagueName?: string
  sport?: string
  weekLabel?: string
}

/**
 * Generate a fantasy podcast script. Uses templates; can be wired to AI or data later.
 */
export function generateFantasyPodcastScript(options: GenerateOptions = {}): GeneratedPodcastScript {
  const leagueName = options.leagueName ?? "your league"
  const sport = normalizeToSupportedSport(options.sport)
  const weekLabel = options.weekLabel ?? "this week"

  const sections: PodcastScriptSection[] = [
    {
      heading: "League recap",
      body: `Welcome to your weekly fantasy recap for ${leagueName}. ${weekLabel} we saw some big swings. We'll cover the top storylines, waiver wire moves you should make, and players who balled out or disappointed.`,
    },
    {
      heading: "Top waiver targets",
      body: `On the waiver wire this week: prioritize running backs with new opportunity due to injuries or depth chart changes. Look for handcuffs that might have become starters. At wide receiver, target high-volume offenses and players with upcoming favorable matchups. Don't forget to check your league's waiver order and use your priority wisely.`,
    },
    {
      heading: "Player performance summary",
      body: `Key performances from ${sport} this week: quarterbacks with rushing upside continue to be league-winners. At running back, volume and goal-line work are king. For receivers, target share and red zone usage are the stats that matter most. We'll have more personalized takes when you connect your league.`,
    },
  ]

  const script = sections.map((s) => `${s.heading}. ${s.body}`).join("\n\n")
  const title = `Fantasy Recap — ${leagueName} ${weekLabel}`

  return { title, script, sections }
}
