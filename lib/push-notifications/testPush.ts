/**
 * "Send a test" — one sample alert to every device the signed-in user has turned alerts on for.
 *
 * It exists because nothing else can answer "does my phone actually get these?" on demand: real
 * alerts wait for a trade, an injury or a touchdown. It is also the one place a user (or we) can
 * read WHY a phone gets nothing. Apple's refusal codes name the cause exactly — a key restricted
 * to the wrong environment, a key from a different developer team — so the reply carries the
 * code and a plain-language hint instead of a bare "failed".
 *
 * The sample is a trade offer drawn as the same signed trade card real offers use, so a passing
 * test proves the picture path too (iPhone notification extension, card route, signing key).
 */
import "server-only"

import { tradeCardPath, type TradeCard } from "@/lib/push-notifications/tradeCard"
import type { PushPayload } from "@/lib/push-notifications/types"

/** Well-known players so the headshots render; the trade itself is obviously a sample. */
export const TEST_TRADE_CARD: TradeCard = {
  v: 1,
  kind: "offer",
  league: "Sample league",
  sides: [
    {
      name: "You",
      you: true,
      letter: "A",
      gets: [
        { n: "Bijan Robinson", d: "RB · ATL", id: "9509" },
        { n: "CeeDee Lamb", d: "WR · DAL", id: "6786" },
      ],
    },
    {
      name: "Sample Manager",
      letter: "B",
      gets: [{ n: "Ja'Marr Chase", d: "WR · CIN", id: "7564" }],
    },
  ],
}

export function buildTestPush(env?: Record<string, string | undefined>): PushPayload {
  return {
    title: "Trade offer (test)",
    body: "You get Bijan Robinson + CeeDee Lamb for Ja'Marr Chase. This is a sample — your alerts are working.",
    href: "/core/notifications",
    tag: "af-test-push",
    type: "test_push",
    imageUrl: tradeCardPath(TEST_TRADE_CARD, env),
  }
}

export type TestPushDevice = {
  kind: "iphone" | "browser"
  ok: boolean
  /** Apple's or the browser service's refusal, e.g. "APNs 403 BadEnvironmentKeyInToken". */
  code?: string
  hint?: string
}

/**
 * Only shapes we recognise leave the server. An error string is built from exceptions in places,
 * and a raw exception has no business in a client response.
 */
function safeCode(error: string): string | undefined {
  const apns = /^APNs (\d{3})(?: ([A-Za-z]+))?$/.exec(error.trim())
  if (apns) return apns[2] ? `APNs ${apns[1]} ${apns[2]}` : `APNs ${apns[1]}`
  if (error.startsWith("APNs key unusable")) return "APNs key unusable"
  if (["APNs not configured", "APNs timeout", "VAPID not configured", "Subscription expired"].includes(error)) return error
  return undefined
}

export function explainPushFailure(kind: TestPushDevice["kind"], error: string | undefined): TestPushDevice {
  const code = safeCode(error ?? "")
  const reason = code ?? ""
  let hint = "Delivery failed. Try again in a minute."
  if (/BadEnvironmentKeyInToken/.test(reason)) {
    hint =
      "Apple refused the server's push key for this phone. App Store and TestFlight builds need a key enabled for Production (or Sandbox & Production)."
  } else if (/InvalidProviderToken|ExpiredProviderToken|MissingProviderToken/.test(reason)) {
    hint =
      "Apple refused the server's push key. The key ID, team ID and private key must all come from the same key, on the Apple developer team that publishes AllFantasy."
  } else if (/TopicDisallowed|DeviceTokenNotForTopic|BadTopic/.test(reason)) {
    hint = "Apple says the server's push key cannot send to the AllFantasy app."
  } else if (/APNs 410|BadDeviceToken|Subscription expired/.test(reason)) {
    hint = "This device's registration had expired and was removed. Turn alerts on again on this device."
  } else if (reason === "APNs not configured" || reason === "VAPID not configured") {
    hint = "The server isn't set up to send to this kind of device yet."
  } else if (reason === "APNs key unusable") {
    hint = "The server's Apple push key couldn't be read. Check the private key was pasted whole."
  } else if (reason === "APNs timeout") {
    hint = "Apple didn't answer in time. Try again in a minute."
  }
  return { kind, ok: false, code, hint }
}
