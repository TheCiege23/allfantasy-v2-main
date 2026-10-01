/**
 * The trade card a phone notification shows: both managers, their letters, and what each
 * receives, with headshots. Rendered by /api/push-card/trade.
 *
 * 🛑 THE CARD IS DRAWN FROM ITS URL, AND THE URL IS SIGNED. The picture is fetched by the phone
 * itself — Apple's notification extension or Android — with no session cookie, so the route
 * cannot look the trade up as the user. Everything it draws travels in `d`, which carries only
 * what the recipient's notification text already tells them, and `s` is an HMAC over it. Without
 * the signature anyone could use allfantasy.ai to render an image saying whatever they liked.
 *
 * The key is derived from NEXTAUTH_SECRET (it signs on the worker, where the trade crons run,
 * and verifies on the web service, which serves allfantasy.ai), so both services must hold the
 * same value. If they ever differ the route answers 403 and logs it, and the notification still
 * arrives — as text. A picture is never the only place information lives.
 */
import "server-only"
import crypto from "crypto"
import type { GradeLetter } from "@/lib/trade-intel/gradeScale"

export type TradeCardAsset = {
  /** Display name: "Breece Hall", "2026 1st". */
  n: string
  /** "RB · NYJ" — optional. */
  d?: string
  /** Sleeper NFL player id, digits only, for the headshot. */
  id?: string
}

export type TradeCardSide = {
  name: string
  you?: boolean
  letter?: GradeLetter | null
  gets: TradeCardAsset[]
  /** Assets beyond the ones drawn, shown as "+N more". */
  more?: number
}

export type TradeCard = {
  v: 1
  kind: "offer" | "accepted"
  league: string
  sides: [TradeCardSide, TradeCardSide]
}

const LETTERS: ReadonlySet<string> = new Set(["A", "B", "C", "D", "F"])
const MAX_ASSETS = 4

function clean(text: unknown, max: number): string {
  // Printable text only: the card is an image, and a control character or a 2 KB name is either
  // a rendering bug or someone probing the route.
  return String(text ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
}

function cleanAsset(a: TradeCardAsset): TradeCardAsset | null {
  const n = clean(a.n, 40)
  if (!n) return null
  const d = clean(a.d, 24)
  const id = typeof a.id === "string" && /^\d{1,10}$/.test(a.id) ? a.id : undefined
  return { n, ...(d ? { d } : {}), ...(id ? { id } : {}) }
}

function cleanSide(s: TradeCardSide): TradeCardSide {
  const assets = (s.gets ?? []).map(cleanAsset).filter((a): a is TradeCardAsset => a !== null)
  // Overflow from this pass plus any already recorded, so normalizing twice (sign, then verify)
  // keeps the count instead of losing it.
  const carried = Number.isInteger(s.more) && (s.more as number) > 0 ? Math.min(s.more as number, 99) : 0
  const more = Math.max(0, assets.length - MAX_ASSETS) + carried
  return {
    name: clean(s.name, 32) || "Manager",
    ...(s.you ? { you: true } : {}),
    letter: s.letter && LETTERS.has(s.letter) ? s.letter : null,
    gets: assets.slice(0, MAX_ASSETS),
    // How many did not fit, so the card can say "+2 more" rather than silently dropping them.
    ...(more > 0 ? { more } : {}),
  }
}

/** Bound every field, so the URL and the image both stay small whatever the trade holds. */
export function normalizeTradeCard(card: TradeCard): TradeCard {
  return {
    v: 1,
    kind: card.kind === "accepted" ? "accepted" : "offer",
    league: clean(card.league, 48) || "Your league",
    sides: [cleanSide(card.sides[0]), cleanSide(card.sides[1])],
  }
}

function signingKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const secret = env.NEXTAUTH_SECRET?.trim()
  if (!secret) return null
  // Derived, so the push-card key is never the session key itself.
  return crypto.createHmac("sha256", secret).update("af-push-card:v1").digest()
}

function sign(data: string, key: Buffer): string {
  return crypto.createHmac("sha256", key).update(data).digest("base64url").slice(0, 32)
}

/** `/api/push-card/trade?d=…&s=…`, or null when there is no key (the push goes out without one). */
export function tradeCardPath(card: TradeCard, env?: Record<string, string | undefined>): string | null {
  const key = signingKey(env)
  if (!key) return null
  const d = Buffer.from(JSON.stringify(normalizeTradeCard(card)), "utf8").toString("base64url")
  return `/api/push-card/trade?d=${d}&s=${sign(d, key)}`
}

export type VerifyResult = { ok: true; card: TradeCard } | { ok: false; reason: "no_key" | "bad_signature" | "bad_payload" }

export function verifyTradeCard(
  d: string | null,
  s: string | null,
  env?: Record<string, string | undefined>,
): VerifyResult {
  const key = signingKey(env)
  if (!key) return { ok: false, reason: "no_key" }
  if (!d || !s || d.length > 4000) return { ok: false, reason: "bad_payload" }
  const expected = Buffer.from(sign(d, key))
  const given = Buffer.from(s)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad_signature" }
  }
  try {
    const parsed = JSON.parse(Buffer.from(d, "base64url").toString("utf8")) as TradeCard
    if (parsed?.v !== 1 || !Array.isArray(parsed.sides) || parsed.sides.length !== 2) {
      return { ok: false, reason: "bad_payload" }
    }
    return { ok: true, card: normalizeTradeCard(parsed) }
  } catch {
    return { ok: false, reason: "bad_payload" }
  }
}
