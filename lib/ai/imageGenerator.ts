/**
 * AI Image Generation Service using OpenAI DALL-E 3.
 * Generates league banners, tribe logos, player avatars, and event graphics.
 *
 * ⚠ NOTHING CALLS THIS TODAY. Verified on 2026-08-27 against main by all four
 * import forms — module path, relative path, dynamic `import()`, and every
 * exported name (generateImage, generateTribeLogo, generateLeagueBanner,
 * generateMergedTribeLogo, generateEventGraphic). The only other file in the
 * repo that mentions it is the spend-guard ratchet that was tracking it.
 *
 * So the guard below buys nothing TODAY. It is here because DALL-E is the most
 * expensive call per request in this codebase, and the failure mode for dead
 * code is someone wiring it up later without noticing it was never metered.
 * Deleting the file instead would be the stronger fix; that is a product call,
 * not a cleanup.
 */
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'

// NB: read once at module load, not per call.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY

interface ImageGenerationOptions {
  prompt: string
  size?: '1024x1024' | '1792x1024' | '1024x1792'
  quality?: 'standard' | 'hd'
  style?: 'vivid' | 'natural'
}

interface GeneratedImage {
  url: string
  revisedPrompt: string
}

/**
 * Generate an image using DALL-E 3.
 */
export async function generateImage(options: ImageGenerationOptions): Promise<GeneratedImage | null> {
  // PROVIDER BOUNDARY. Non-throwing to match this function's contract: it
  // returns `GeneratedImage | null` and already returns null when the key is
  // absent, so callers have a null path and no catch path. Above the key check
  // for the same reason as the other boundaries — when both are missing, the
  // switch is the more actionable answer.
  if (!isAiSpendEnabled()) {
    console.warn('[imageGenerator] AI spend is disabled; not generating')
    return null
  }
  if (!OPENAI_API_KEY) {
    console.warn('[imageGenerator] No OPENAI_API_KEY configured')
    return null
  }

  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: options.prompt,
        n: 1,
        size: options.size ?? '1024x1024',
        quality: options.quality ?? 'standard',
        style: options.style ?? 'vivid',
        response_format: 'url',
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      console.error('[imageGenerator] DALL-E error:', err)
      return null
    }

    const data = await response.json()
    const image = data.data?.[0]
    if (!image?.url) return null

    return {
      url: image.url,
      revisedPrompt: image.revised_prompt ?? options.prompt,
    }
  } catch (err) {
    console.error('[imageGenerator] Failed:', err)
    return null
  }
}

/**
 * Generate a tribe logo for a Survivor league.
 */
export async function generateTribeLogo(
  tribeName: string,
  tribeColor: string,
  sport: string,
): Promise<GeneratedImage | null> {
  return generateImage({
    prompt: `A dramatic tribal emblem logo for a fantasy ${sport} tribe called "${tribeName}". The logo should use ${tribeColor} as the primary color. Style: premium sports team logo, tropical Survivor-inspired, clean vector style with dramatic lighting. Dark background, no text, no words, just the emblem. Premium quality, game-show aesthetic.`,
    size: '1024x1024',
    quality: 'hd',
    style: 'vivid',
  })
}

/**
 * Generate a league banner for any league type.
 */
export async function generateLeagueBanner(
  leagueName: string,
  leagueType: string,
  sport: string,
): Promise<GeneratedImage | null> {
  const themeMap: Record<string, string> = {
    survivor: 'tropical island with dramatic sunset, tribal torches, strategic atmosphere',
    zombie: 'dark apocalyptic cityscape with green infection glow, horror-fantasy theme',
    guillotine: 'medieval arena with dramatic blade, competitive elimination theme',
    dynasty: 'royal dynasty castle with golden crown, legacy empire theme',
    redraft: 'sleek modern sports arena with neon lighting, competitive draft theme',
    keeper: 'treasure vault with locked keepers, strategic collection theme',
    best_ball: 'futuristic optimization grid with glowing data streams',
    devy: 'campus-to-pro pipeline with stadium lights, prospect development theme',
    c2c: 'dual arena split between college campus and pro stadium',
    salary_cap: 'luxury penthouse war room with contracts and strategy boards',
    tournament: 'grand tournament bracket arena with spotlight on champion stage',
  }

  const theme = themeMap[leagueType] ?? 'premium fantasy sports competition arena'

  return generateImage({
    prompt: `A cinematic wide banner image for a fantasy ${sport} league called "${leagueName}". Theme: ${theme}. Style: premium, dramatic, dark background with vibrant accent lighting. No text, no words. Widescreen composition, game-show quality, flagship premium feel.`,
    size: '1792x1024',
    quality: 'hd',
    style: 'vivid',
  })
}

/**
 * Generate a merged tribe logo for Survivor merge event.
 */
export async function generateMergedTribeLogo(
  tribeName: string,
  sport: string,
): Promise<GeneratedImage | null> {
  return generateImage({
    prompt: `A premium merged tribe emblem for a fantasy ${sport} Survivor league. The merged tribe is called "${tribeName}". Style: golden/amber tones, dramatic unification symbol, combining multiple tribal elements into one. Dark background, no text, premium game-show logo quality.`,
    size: '1024x1024',
    quality: 'hd',
    style: 'vivid',
  })
}

/**
 * Generate an event graphic (elimination, merge, finale).
 */
export async function generateEventGraphic(
  eventType: 'elimination' | 'merge' | 'finale' | 'idol_play' | 'rocks',
  sport: string,
  context?: string,
): Promise<GeneratedImage | null> {
  const prompts: Record<string, string> = {
    elimination: `Dramatic elimination scene for a fantasy ${sport} Survivor game. A torch being extinguished in dramatic lighting. Dark, cinematic, premium game-show quality. No text.`,
    merge: `Epic merge ceremony for a fantasy ${sport} Survivor game. Two tribal banners merging into one golden symbol. Dramatic lighting, premium quality. No text.`,
    finale: `Grand finale stage for a fantasy ${sport} Survivor game. Spotlight on a championship throne with jury torches surrounding it. Premium, dramatic, cinematic. No text.`,
    idol_play: `Hidden immunity idol being played in a dramatic fantasy ${sport} Survivor game. A glowing idol artifact revealed in torchlight. Dramatic, premium quality. No text.`,
    rocks: `Dramatic rock draw scene for a fantasy ${sport} Survivor game. Colorful rocks in a bag being drawn under torchlight, one purple rock glowing ominously. No text.`,
  }

  return generateImage({
    prompt: prompts[eventType] ?? prompts.elimination!,
    size: '1792x1024',
    quality: 'hd',
    style: 'vivid',
  })
}
