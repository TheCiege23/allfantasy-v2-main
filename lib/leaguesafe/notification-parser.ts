import "server-only"
import { createHash } from "node:crypto"
import PostalMime from "postal-mime"
import { parse, type DefaultTreeAdapterMap } from "parse5"

export const LS_PARSER_VERSION = "phase2-samples-v1"
const MONEY = String.raw`\$(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)\.\d{2}`
const clean = (value: string) => value.replace(/\s+/gu, " ").trim()
type Node = DefaultTreeAdapterMap["node"]
export type NotificationDocument = {
  subject: string; text: string; tables: string[][][]; leagueIds: string[]
  notificationSentAt: string | null
}
type League = { name: string; id: string | null }
type Allocation = { ownerDisplayName: string; winningsCents: number; additionalFeesCents: number | null }
export type NotificationDetails =
  | { type: "payment_received"; league: League; payerDisplayName: string; payerEmail: null; amountCents: number; leagueBalanceCents: number; ownersPaid: number }
  | { type: "wallet_refund_processed"; league: null; amountCents: number; transactionId: string; confirmation: string; destination: "fanball_wallet" }
  | { type: "league_refund_processed"; league: League; ownerDisplayText: string; amountCents: number }
  | { type: "wallet_credit"; league: League; amountCents: number; destination: "sportshub_account" }
  | { type: "allocation_vote_requested"; league: League; allocations: Allocation[]; voteExpiresText: string }
  | { type: "allocation_approved"; league: League; allocations: Allocation[] }
  | { type: "payout_structure_updated"; league: League; additionalInformation: string; prizes: [] }
export type ParsedNotification = {
  schemaVersion: 1; parserVersion: string; currency: "USD"; details: NotificationDetails
  source: { gmailMessageId: string; receivedAt: string; notificationSentAt: string | null }
  // Notification dates are not transaction timestamps. Identity matching is Phase 3.
  occurredAt: null; dedupeKey: string; dedupeScope: "transaction" | "message"
}

/** Exact integer cents: reject signs, ambiguous grouping, excess precision and overflow. */
function cents(value: string): number | null {
  if (!new RegExp(`^${MONEY}$`).test(value)) return null
  const [whole, fraction] = value.slice(1).replaceAll(",", "").split(".")
  const result = Number(whole) * 100 + Number(fraction)
  return Number.isSafeInteger(result) && result <= 2_147_483_647 ? result : null
}
function one(text: string, pattern: RegExp): RegExpMatchArray | null {
  const matches = [...text.matchAll(new RegExp(pattern.source, "g"))]
  return matches.length === 1 ? matches[0] : null
}
function name(value: string): string | null {
  const result = clean(value)
  return result.length > 0 && result.length <= 240 ? result : null
}
function league(doc: NotificationDocument, value: string): League | null {
  const result = name(value)
  return result && doc.leagueIds.length <= 1 ? { name: result, id: doc.leagueIds[0] ?? null } : null
}

/** Decode only the outer MIME body. Attachments, including attached .eml files, are never evidence. */
export async function decodeNotification(raw: string): Promise<NotificationDocument | null> {
  try {
    if (!raw || raw.includes("\0") || Buffer.byteLength(raw, "utf8") > 2 * 1024 * 1024) return null
    const email = await PostalMime.parse(raw, {
      maxNestingDepth: 16, maxHeadersSize: 64 * 1024,
      maxPartCount: 100, maxRfc822NestingDepth: 0, forceRfc822Attachments: true,
    })
    if (email.headers.filter(h => h.key === "subject").length !== 1 || !email.subject || !email.html) return null
    // Only observed HTML templates are supported. No subject-only or attachment-based inference.
    const tree = parse(email.html)
    const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : []
    const blocked = (node: Node) => {
      if (!("tagName" in node)) return false
      return ["head", "script", "style", "template", "noscript", "iframe", "object", "svg"].includes(node.tagName) ||
        node.attrs.some(a => a.name === "hidden" || (a.name === "aria-hidden" && a.value === "true") ||
          (a.name === "style" && /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(a.value)))
    }
    const textOf = (start: Node): string => {
      const text: string[] = [], pending: Node[] = [start]
      while (pending.length) {
        const node = pending.pop()!
        if (blocked(node)) continue
        if ("value" in node && node.nodeName === "#text") text.push(node.value)
        else pending.push(...children(node).toReversed())
      }
      return clean(text.join(" "))
    }
    const tables: string[][][] = [], leagueIds = new Set<string>()
    const pending: { node: Node; depth: number; table: string[][] | null; row: string[] | null }[] =
      [{ node: tree, depth: 0, table: null, row: null }]
    let count = 0
    while (pending.length) {
      const item = pending.pop()!, { node, depth } = item
      if (++count > 30000 || depth > 100) return null
      if (blocked(node)) continue
      let { table, row } = item
      if ("tagName" in node) {
        if (node.tagName === "table") { table = []; tables.push(table); row = null }
        if (node.tagName === "tr" && table) { row = []; table.push(row) }
        if (["td", "th"].includes(node.tagName) && row) row.push(textOf(node))
        if (node.tagName === "a") {
          const href = node.attrs.find(a => a.name === "href")?.value
          // The only observed numeric league reference. Never follow email links.
          const match = href?.match(/^https:\/\/www\.leaguesafe\.com\/league\/(\d{1,12})\/?$/)
          if (match) leagueIds.add(match[1])
        }
      }
      pending.push(...children(node).toReversed().map(child => ({ node: child, depth: depth + 1, table, row })))
    }
    const dates = email.headers.filter(header => header.key === "date")
    // postal-mime normalizes dates; do not let a timezone-free header acquire the server's zone.
    const explicitZone = dates.length === 1 && /(?:[+-]\d{4}|GMT|UT|Z)\s*(?:\([^)]*\))?$/i.test(dates[0].value)
    const date = explicitZone && email.date ? new Date(email.date) : null
    return { subject: clean(email.subject), text: textOf(tree), tables, leagueIds: [...leagueIds],
      notificationSentAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : null }
  } catch { return null }
}

export function parsePaymentReceived(doc: NotificationDocument): NotificationDetails | null {
  const subject = doc.subject.match(new RegExp(`^(.+?) made a (${MONEY}) payment to (.+)$`))
  if (!subject || !doc.text.includes("Payment Received!")) return null
  const summary = one(doc.text, new RegExp(`(?:^| )Who: (.+?) Amount: (${MONEY}) (.+?) has made a (${MONEY}) payment to (.+?)\\. Current League Balance: (${MONEY}) Total Owners Paid: (\\d+)(?: |$)`))
  if (!summary) return null
  const [, who, amount, payer, repeated, leagueName, balance, paid] = summary
  const amountCents = cents(amount), leagueBalanceCents = cents(balance), target = league(doc, leagueName)
  if (!target || !name(who) || who !== payer || who !== subject[1] || amount !== repeated || amount !== subject[2] ||
      target.name !== subject[3] || amountCents === null || amountCents <= 0 || leagueBalanceCents === null || !Number.isSafeInteger(Number(paid))) return null
  return { type: "payment_received", league: target, payerDisplayName: who, payerEmail: null, amountCents, leagueBalanceCents, ownersPaid: Number(paid) }
}

export function parseWalletRefund(doc: NotificationDocument): NotificationDetails | null {
  if (doc.subject !== "Your requested refund has been processed" || !doc.text.includes("Credit Card Refund Processed") ||
      !doc.text.includes("Funds have been returned to your Fanball Wallet")) return null
  const fields = one(doc.text, new RegExp(`Refund Amount: (${MONEY}) Confirmation: ([a-zA-Z0-9_-]{1,100}) Transaction #: ([a-zA-Z0-9_-]{1,100})(?: |$)`))
  const amountCents = fields ? cents(fields[1]) : null
  return fields && amountCents !== null && amountCents > 0 ? { type: "wallet_refund_processed", league: null,
    amountCents, confirmation: fields[2], transactionId: fields[3], destination: "fanball_wallet" } : null
}

export function parseLeagueRefund(doc: NotificationDocument): NotificationDetails | null {
  const subject = doc.subject.match(/^A refund has been processed in (.+)$/)
  if (!subject || !doc.text.includes("Refund Notification") || !doc.text.includes("you are a commissioner of this league")) return null
  const fields = one(doc.text, new RegExp(`An owner \\(or owners\\) in (.+?) has received a refund from your league\\. Owner\\(s\\): (.+?) Refunded Amount: (${MONEY})\\.`))
  const target = fields ? league(doc, fields[1]) : null, amountCents = fields ? cents(fields[3]) : null
  return fields && target && target.name === subject[1] && name(fields[2]) && amountCents !== null && amountCents > 0 ?
    { type: "league_refund_processed", league: target, ownerDisplayText: fields[2], amountCents } : null
}

export function parseWalletCredit(doc: NotificationDocument): NotificationDetails | null {
  if (doc.subject !== "LeagueSafe Alert: You've received a payout!" || !doc.text.includes("Winnings are now in your account!") ||
      !doc.text.includes("This money is in your SportsHub account!")) return null
  const fields = one(doc.text, new RegExp(`your league commissioner has allocated you (${MONEY}) from (.+?)!`))
  const target = fields ? league(doc, fields[2]) : null, amountCents = fields ? cents(fields[1]) : null
  return fields && target && amountCents !== null && amountCents > 0 ?
    { type: "wallet_credit", league: target, amountCents, destination: "sportshub_account" } : null
}

function allocationRows(doc: NotificationDocument, requested: boolean): Allocation[] | null {
  const heading = requested ? ["OWNER", "WINNINGS", "ADDITIONAL FEES", "WINS/OWES", "STATUS"] : ["OWNER", "WINNINGS", "WINS/OWES"]
  const candidates = doc.tables.filter(table => table.some(row => JSON.stringify(row) === JSON.stringify(heading)))
  if (candidates.length !== 1) return null
  const table = candidates[0], start = table.findIndex(row => row[0] === "OWNER")
  const rows = table.slice(start + 1).filter(row => row.some(Boolean))
  if (!rows.length || rows.length > 1000) return null
  const results: Allocation[] = []
  for (const row of rows) {
    if (row.length !== heading.length || !name(row[0])) return null
    const winningsCents = cents(row[1]), additionalFeesCents = requested ? cents(row[2]) : null
    const wins = row[requested ? 3 : 2].match(new RegExp(`^Wins (${MONEY})$`))
    // Only the observed nonnegative, zero-additional-fee allocation shape is supported.
    if (winningsCents === null || !wins || cents(wins[1]) !== winningsCents ||
        (requested && (additionalFeesCents !== 0 || row[4] !== "PENDING"))) return null
    results.push({ ownerDisplayName: row[0], winningsCents, additionalFeesCents })
  }
  return results
}

export function parseAllocationVoteRequest(doc: NotificationDocument): NotificationDetails | null {
  if (doc.subject !== "LeagueSafe Alert: Vote required to approve payouts" || !doc.text.includes("Payouts have been allocated!")) return null
  const fields = one(doc.text, /The commissioner of (.+?) has allocated end of season payouts/)
  const expiry = one(doc.text, /This poll will expire on (.+?)\s*\. Please contact/)
  const target = fields ? league(doc, fields[1]) : null, allocations = allocationRows(doc, true)
  return target && allocations && expiry && expiry[1].length <= 160 ?
    { type: "allocation_vote_requested", league: target, allocations, voteExpiresText: expiry[1] } : null
}

export function parseAllocationApproved(doc: NotificationDocument): NotificationDetails | null {
  if (doc.subject !== "LeagueSafe Alert: Your allocation vote has passed!" || !doc.text.includes("Allocation vote approved!")) return null
  const fields = one(doc.text, /The payout allocation vote for (.+?) has been approved!/)
  const target = fields ? league(doc, fields[1]) : null, allocations = allocationRows(doc, false)
  return target && allocations ? { type: "allocation_approved", league: target, allocations } : null
}

export function parsePayoutStructureUpdate(doc: NotificationDocument): NotificationDetails | null {
  const subject = doc.subject.match(/^\[(.+?)\s*\] Updated payout information$/)
  if (!subject) return null
  const header = one(doc.text, /Payouts have been updated in (.+?) Hi /)
  const info = one(doc.text, /Updated League Payouts Place Prize Additional Information (.+?) Thanks,/)
  const target = header ? league(doc, header[1]) : null
  // The verified specimen has an EMPTY Place/Prize table. Do not infer prizes from free text.
  if (!target || target.name !== clean(subject[1]) || !target.id || !info || info[1].length > 4000) return null
  return { type: "payout_structure_updated", league: target, additionalInformation: info[1], prizes: [] }
}

const parsers = [parsePaymentReceived, parseWalletRefund, parseLeagueRefund, parseWalletCredit,
  parseAllocationVoteRequest, parseAllocationApproved, parsePayoutStructureUpdate]

export async function parseLeagueSafeNotification(input: { rawBody: string; messageId: string; receivedAt: Date }): Promise<ParsedNotification | null> {
  try {
    if (!/^[a-f0-9]{1,64}$/i.test(input.messageId) || !Number.isFinite(input.receivedAt.getTime())) return null
    const doc = await decodeNotification(input.rawBody)
    if (!doc) return null
    const results = parsers.map(parser => parser(doc)).filter((item): item is NotificationDetails => item !== null)
    if (results.length !== 1) return null
    const details = results[0], transaction = details.type === "wallet_refund_processed" ? details.transactionId : null
    const dedupeScope = transaction ? "transaction" : "message"
    const identity = transaction ? [details.type, transaction] : [input.messageId.toLowerCase()]
    return { schemaVersion: 1, parserVersion: LS_PARSER_VERSION, currency: "USD", details, occurredAt: null,
      source: { gmailMessageId: input.messageId, receivedAt: input.receivedAt.toISOString(), notificationSentAt: doc.notificationSentAt },
      dedupeScope, dedupeKey: `leaguesafe:${dedupeScope}:` + createHash("sha256").update(JSON.stringify(identity)).digest("hex") }
  } catch { return null }
}
