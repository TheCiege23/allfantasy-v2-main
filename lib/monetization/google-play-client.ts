import { useEffect, useState } from "react"
import { isTrustedWebActivity } from "@/lib/platform/isTrustedWebActivity"
import { PLAY_METHOD, PLAY_PACKAGE } from "@/lib/google-play/billingCatalog"

type PlayDetail = { itemId: string; price: { currency: string; value: string }; subscriptionPeriod?: string; freeTrialPeriod?: string; introductoryPrice?: unknown }
type PlayReceipt = { itemId: string; purchaseToken: string }
type DigitalGoods = { getDetails(ids: string[]): Promise<PlayDetail[]>; listPurchases(): Promise<PlayReceipt[]> }
type PlayWindow = Window & { getDigitalGoodsService?: (method: string) => Promise<DigitalGoods> }
type Pending = { productId: string; intentId: string; ownerId: string; purchaseToken?: string }
const STORAGE = "af:play:pending:v1"
let inFlight: Promise<void> | null = null
async function service() {
  const get = (window as PlayWindow).getDigitalGoodsService
  if (!get) throw new Error("Update the AllFantasy Android app and Chrome to use Google Play purchases.")
  return get.call(window, PLAY_METHOD)
}
function saved(): Pending[] {
  try { return JSON.parse(window.localStorage.getItem(STORAGE) || "[]") as Pending[] } catch { return [] }
}
function save(rows: Pending[]) {
  // Do not open payment if storage is blocked: unfinished receipts must remain recoverable.
  window.localStorage.setItem(STORAGE, JSON.stringify(rows))
}
async function config() {
  const r = await fetch("/api/monetization/google-play/products", { cache: "no-store" })
  const data = await r.json() as { enabled?: boolean; products?: Array<{ sku: string; productId: string; type: string; interval: string | null }> }
  if (!r.ok || !data.enabled) throw new Error("Google Play purchases are not available yet. You can keep using AllFantasy for free.")
  return data.products || []
}
function checkDetail(item: { type: string; interval: string | null }, detail?: PlayDetail) {
  if (!detail?.price?.currency || !/^\d+(\.\d+)?$/.test(detail.price.value)) throw new Error("Google Play did not return a valid price.")
  if (item.type === "subscription" && (detail.subscriptionPeriod !== (item.interval === "month" ? "P1M" : "P1Y") || detail.freeTrialPeriod || detail.introductoryPrice)) {
    throw new Error("Google Play returned a different billing interval or offer. Purchase is unavailable.")
  }
  return detail
}
export function useGooglePlayPrices() {
  const [playApp, setPlayApp] = useState(false), [prices, setPrices] = useState<Record<string, string>>({}), [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!isTrustedWebActivity()) return
    setPlayApp(true)
    let active = true
    void (async () => {
      try {
        const items = await config(), api = await service(), details = await api.getDetails(items.map(i => i.productId))
        const formatted: Record<string, string> = {}
        for (const item of items) {
          const detail = details.find(d => d.itemId === item.productId)
          if (!detail) continue
          try { const valid = checkDetail(item, detail); formatted[item.sku] = new Intl.NumberFormat(navigator.language, { style: "currency", currency: valid.price.currency }).format(Number(valid.price.value)) } catch { /* Unsupported offers are unavailable. */ }
        }
        if (active) setPrices(formatted)
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Google Play purchases are unavailable.") }
    })()
    return () => { active = false }
  }, [])
  return { playApp, prices, error }
}
async function verify(receipt: Pending & { purchaseToken: string }) {
  const r = await fetch("/api/monetization/google-play/transactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(receipt) })
  const result = await r.json().catch(() => ({})) as { error?: string; pending?: boolean; finishPending?: boolean }
  if (!r.ok) throw new Error(result.error || "Unable to verify your purchase. Sign in with the purchase account and tap Restore Purchases.")
  if (!result.pending) save(saved().filter(row => row.intentId !== receipt.intentId))
  return result
}
export function purchaseWithGooglePlay(sku: string): Promise<void> {
  if (inFlight) return Promise.reject(new Error("A Google Play purchase is already in progress."))
  const run = (async () => {
    const items = await config(), item = items.find(i => i.sku === sku)
    if (!item) throw new Error("This Google Play product is unavailable.")
    const api = await service(), detail = checkDetail(item, (await api.getDetails([item.productId]))[0])
    const r = await fetch("/api/monetization/google-play/intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sku }) })
    const intent = await r.json() as { intentId: string; ownerId: string; error?: string; message?: string }
    if (!r.ok) throw new Error(intent.message || intent.error || "Please sign in before purchasing.")
    const pending: Pending = { intentId: intent.intentId, ownerId: intent.ownerId, productId: item.productId }
    save([...saved(), pending])
    const payment = new PaymentRequest([{ supportedMethods: PLAY_METHOD, data: { sku: item.productId } }],
      { total: { label: "AllFantasy", amount: detail.price } })
    let response: PaymentResponse
    try { response = await payment.show() } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") save(saved().filter(p => p.intentId !== pending.intentId))
      throw cause
    }
    const token = (response.details as { purchaseToken?: string }).purchaseToken
    if (!token) { await response.complete("fail"); throw new Error("Google Play did not return a receipt. Use Restore Purchases before trying again.") }
    const receipt = { ...pending, purchaseToken: token }
    try { save(saved().map(p => p.intentId === pending.intentId ? receipt : p)) }
    catch { await response.complete("unknown").catch(() => {}); throw new Error("Your payment receipt needs recovery. Keep this account signed in and use Restore Purchases.") }
    try {
      const result = await verify(receipt)
      await response.complete("success")
      if (result.pending) throw new Error("Payment is pending with Google Play. Your purchase will appear after payment completes; use Restore Purchases to check.")
    } catch (cause) { await response.complete("unknown").catch(() => {}); throw cause }
  })()
  inFlight = run
  return run.finally(() => { inFlight = null })
}
export async function restoreGooglePlayPurchases() {
  const api = await service(), purchases = await api.listPurchases(), pending = saved()
  let restored = 0, failed = 0, pendingCount = 0
  // Include saved receipts as well as active/unconsumed Play purchases. Never use listPurchaseHistory().
  const receipts = new Map(purchases.map(p => [p.purchaseToken, p]))
  for (const p of pending) if (p.purchaseToken) receipts.set(p.purchaseToken, { itemId: p.productId, purchaseToken: p.purchaseToken })
  for (const p of receipts.values()) {
    const savedIntent = pending.find(i => i.purchaseToken === p.purchaseToken) || pending.filter(i => i.productId === p.itemId).at(-1)
    try {
      const r = await fetch("/api/monetization/google-play/transactions", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ purchaseToken: p.purchaseToken, productId: p.itemId, ...(savedIntent ? { intentId: savedIntent.intentId } : {}) }) })
      const result = await r.json().catch(() => ({})) as { pending?: boolean }
      if (!r.ok) { failed++; continue }
      if (result.pending) pendingCount++
      if (!result.pending) { restored++; if (savedIntent) save(saved().filter(i => i.intentId !== savedIntent.intentId)) }
    } catch { failed++ }
  }
  if (failed) throw new Error(`Restored ${restored} purchases. ${failed} need attention: sign in with the original AllFantasy account and retry. Previously spent token packs do not refill.`)
  if (pendingCount) throw new Error(`${restored} purchases restored. ${pendingCount} payments are still pending with Google Play. No tokens or subscription access have been granted for pending payments.`)
  return restored
}
export function manageGooglePlaySubscriptions() {
  window.location.assign(`https://play.google.com/store/account/subscriptions?package=${encodeURIComponent(PLAY_PACKAGE)}`)
}
