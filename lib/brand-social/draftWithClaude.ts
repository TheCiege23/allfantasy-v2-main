import 'server-only'
import {
  BRAND_PLATFORMS,
  PLATFORM_CHAR_LIMITS,
  PLATFORM_LABELS,
  type BrandDraftVariant,
  type BrandPlatform,
} from './types'
import { assertAiSpendAllowed } from '@/lib/ai/aiSpendGuard'

/** Claude model used for brand-post drafting — Haiku for cost/latency on short posts. */
const MODEL = 'claude-haiku-4-5-20251001'

function isPlatform(p: string): p is BrandPlatform {
  return (BRAND_PLATFORMS as readonly string[]).includes(p)
}

function parseDraftJson(raw: string): Array<{ body: string; hashtags: string[] }> {
  // Claude may wrap JSON in prose; grab the first array.
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('no JSON array in response')
  const parsed = JSON.parse(match[0])
  if (!Array.isArray(parsed)) throw new Error('response was not an array')
  return parsed.map((v: any) => ({
    body: typeof v?.body === 'string' ? v.body.trim() : '',
    hashtags: Array.isArray(v?.hashtags)
      ? v.hashtags.filter((h: unknown) => typeof h === 'string' && h.trim().length > 0).map((h: string) => h.trim())
      : [],
  }))
}

export type BrandDraftRequest = {
  platform: BrandPlatform | string
  brief: string
  tone?: 'neutral' | 'hype' | 'analytical' | 'playful'
  variants?: number
  includeHashtags?: boolean
}

export type BrandDraftResult = {
  platform: BrandPlatform
  model: string
  systemPrompt: string
  variants: BrandDraftVariant[]
}

/**
 * Generates N platform-aware brand-post variants via Claude. Throws when the
 * Anthropic key is missing or the model returns unparseable output — callers
 * should surface the error rather than fall back to fabricated content.
 */
export async function draftBrandPostWithClaude(req: BrandDraftRequest): Promise<BrandDraftResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  // PROVIDER BOUNDARY. Guard form matches this function's own contract: it
  // already throws when the key is absent, so a spend refusal behaves
  // identically to an unconfigured provider. Above the key check because when
  // both are missing the switch is the actionable one.
  assertAiSpendAllowed('brand-social')

  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  if (!isPlatform(req.platform)) {
    throw new Error(`Unsupported platform: ${req.platform}`)
  }
  const brief = req.brief?.trim()
  if (!brief || brief.length < 4) throw new Error('brief is too short')

  const variants = Math.min(5, Math.max(1, req.variants ?? 3))
  const tone = req.tone ?? 'neutral'
  const includeHashtags = req.includeHashtags !== false
  const charLimit = PLATFORM_CHAR_LIMITS[req.platform]
  const label = PLATFORM_LABELS[req.platform]

  const systemPrompt = [
    `You are a social media copywriter for AllFantasy, a fantasy sports platform.`,
    `Draft ${variants} distinct variants for a single ${label} post.`,
    `Hard rules:`,
    `- Each variant's body MUST be at or under ${charLimit} characters (platform limit).`,
    `- Tone: ${tone}.`,
    `- No emoji unless the tone is "hype" or "playful".`,
    `- Do NOT invent product features, stats, or user counts. Stay within the brief.`,
    `- ${includeHashtags ? 'Propose 2-6 relevant hashtags per variant as a separate "hashtags" array.' : 'Do NOT include hashtags. Set "hashtags" to an empty array.'}`,
    `- Return ONLY a JSON array with objects of the shape {"body": string, "hashtags": string[]}.`,
    `- No prose, no preamble, no markdown code fences.`,
  ].join('\n')

  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const anthropic = new Anthropic({ apiKey })

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    temperature: 0.7,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Brief: ${brief}`,
      },
    ],
  })

  const textBlock = resp.content.find((c: any) => c.type === 'text') as { type: 'text'; text: string } | undefined
  if (!textBlock?.text) throw new Error('Claude returned no text content')

  let parsed: Array<{ body: string; hashtags: string[] }>
  try {
    parsed = parseDraftJson(textBlock.text)
  } catch (err) {
    console.error('[brand-social] Failed to parse Claude response:', err, textBlock.text.slice(0, 500))
    throw new Error('Claude returned unparseable draft output')
  }

  const built: BrandDraftVariant[] = parsed
    .filter((v) => v.body.length > 0)
    .slice(0, variants)
    .map((v) => ({
      body: v.body,
      hashtags: v.hashtags,
      charCount: v.body.length,
      withinLimit: v.body.length <= charLimit,
    }))

  if (built.length === 0) throw new Error('Claude returned no usable variants')

  return {
    platform: req.platform,
    model: MODEL,
    systemPrompt,
    variants: built,
  }
}
