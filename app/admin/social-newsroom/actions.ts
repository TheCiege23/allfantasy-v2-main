"use server"

import { getAdminAccessState } from "@/lib/adminAuth"

/**
 * "Make it fun" — three playful X variants from Claude, grounded ONLY in the story's own headline,
 * summary and source. A server action rather than an API route: it is reached only from the admin
 * newsroom page, and it re-checks admin access itself because a server action is a public POST.
 *
 * ⚠ THE BRIEF IS THE ENTIRE FACT BASE. It says, in so many words, not to add numbers, quotes or
 * details the headline does not contain, and to keep the source credit and link. The admin still
 * reads every variant before posting — an AI draft is a draft.
 */
export async function draftFunVariants(input: {
  sport: string
  title: string
  description: string | null
  url: string
  outletName: string
  outletHandle: string | null
}): Promise<{ ok: true; variants: string[] } | { ok: false; error: string }> {
  const gate = await getAdminAccessState()
  if (gate.status !== "admin") return { ok: false, error: "Admin access required." }

  const title = String(input.title ?? "").slice(0, 300)
  const url = String(input.url ?? "")
  if (!title || !/^https:\/\//.test(url)) return { ok: false, error: "Story is missing a headline or link." }
  const credit = input.outletHandle ? `via ${input.outletHandle}` : `via ${input.outletName}`

  const brief = [
    `Write a fun, quirky, punchy X post about this REAL ${input.sport} story for a fantasy sports brand.`,
    `Headline (verbatim from ${input.outletName}): ${title}`,
    input.description ? `Summary from ${input.outletName}: ${String(input.description).slice(0, 400)}` : "",
    `Rules: use ONLY facts in the headline and summary — no extra numbers, quotes, records or details.`,
    `If the story is sad or serious (injury, death, arrest), be respectful, not jokey.`,
    `Every variant must end with "${credit}" and then the link ${url}.`,
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const { draftBrandPostWithClaude } = await import("@/lib/brand-social/draftWithClaude")
    const result = await draftBrandPostWithClaude({ platform: "x", brief, tone: "playful", variants: 3, includeHashtags: true })
    const variants = result.variants.map((v) => {
      let body = v.body
      // The credit and link are not optional, whatever the model did with them.
      if (!body.includes(url)) body = `${body}\n\n${credit}\n${url}`
      const tags = v.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).slice(0, 3).join(" ")
      return tags ? `${body}\n${tags}` : body
    })
    return { ok: true, variants }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "AI drafting failed." }
  }
}
