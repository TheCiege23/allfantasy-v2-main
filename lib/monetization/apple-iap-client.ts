import { useEffect, useState } from "react"

type AppleResult = {
  requestId: string
  error?: string
  cancelled?: boolean
  productId?: string
  transactionId?: string
  signedTransactionInfo?: string
  transactions?: Array<{ productId: string; transactionId: string; signedTransactionInfo: string }>
  products?: Array<{ id: string; displayPrice: string; displayName: string }>
}

type AppleHandler = { postMessage: (message: Record<string, string>) => void }

function handler(): AppleHandler | undefined {
  if (typeof window === "undefined") return undefined
  return (window as typeof window & { webkit?: { messageHandlers?: { "apple-iap"?: AppleHandler } } })
    .webkit?.messageHandlers?.["apple-iap"]
}

export function isAppleApp(): boolean {
  if (typeof window === "undefined") return false
  return Boolean(handler()) || (/\bPWAShell\b/.test(navigator.userAgent) && /iPhone|iPad|iPod/.test(navigator.userAgent))
}

export function useAppleIapPrices() {
  const [appleApp, setAppleApp] = useState(false)
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [needsUpdate, setNeedsUpdate] = useState(false)
  useEffect(() => {
    if (!isAppleApp()) return
    setAppleApp(true)
    if (!handler()) {
      setNeedsUpdate(true)
      return
    }
    nativeRequest({ action: "products" }).then((result) => {
      setPrices(Object.fromEntries((result.products ?? []).map((p) => [p.id, p.displayPrice])))
    }).catch(() => {})
  }, [])
  return { appleApp, prices, needsUpdate }
}

function nativeRequest(message: Record<string, string>): Promise<AppleResult> {
  const bridge = handler()
  if (!bridge) return Promise.reject(new Error("Update the AllFantasy iOS app to buy subscriptions or tokens."))
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("allfantasy:apple-iap", listener)
      reject(new Error("Apple did not respond. Please try again."))
    }, 90_000)
    function listener(event: Event) {
      const detail = (event as CustomEvent<AppleResult>).detail
      if (detail?.requestId !== requestId) return
      window.clearTimeout(timeout)
      window.removeEventListener("allfantasy:apple-iap", listener)
      resolve(detail)
    }
    window.addEventListener("allfantasy:apple-iap", listener)
    bridge.postMessage({ ...message, requestId })
  })
}

async function grant(transaction: { productId: string; transactionId: string; signedTransactionInfo: string }) {
  const response = await fetch("/api/monetization/apple/transactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedTransactionInfo: transaction.signedTransactionInfo }),
  })
  const data = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(data.error || "Unable to verify your Apple purchase. Use Restore Purchases after signing in.")
  handler()?.postMessage({ action: "finish", requestId: crypto.randomUUID(), productId: transaction.productId, transactionId: transaction.transactionId })
}

export async function purchaseWithApple(sku: string): Promise<{ cancelled: boolean }> {
  const response = await fetch("/api/monetization/apple/products", { cache: "no-store" })
  if (response.status === 401) throw new Error("Please sign in before purchasing.")
  const data = await response.json().catch(() => ({})) as {
    error?: string; appAccountToken?: string; subscriptions?: string[]; tokenPacks?: string[]
  }
  if (!response.ok || !data.appAccountToken) throw new Error(data.error || "Apple purchases are not configured yet.")
  if (![...(data.subscriptions ?? []), ...(data.tokenPacks ?? [])].includes(sku)) throw new Error("Apple product is unavailable.")
  const result = await nativeRequest({ action: "purchase", productId: sku, appAccountToken: data.appAccountToken })
  if (result.cancelled) return { cancelled: true }
  if (result.error) throw new Error(result.error)
  if (!result.productId || !result.transactionId || !result.signedTransactionInfo) throw new Error("Apple did not return a verified transaction.")
  await grant({ productId: result.productId, transactionId: result.transactionId, signedTransactionInfo: result.signedTransactionInfo })
  return { cancelled: false }
}

export async function restoreApplePurchases(): Promise<number> {
  const result = await nativeRequest({ action: "restore" })
  if (result.error) throw new Error(result.error)
  let count = 0
  for (const transaction of result.transactions ?? []) {
    await grant(transaction)
    count++
  }
  return count
}

export async function manageAppleSubscriptions(): Promise<void> {
  const result = await nativeRequest({ action: "manage" })
  if (result.error) throw new Error(result.error)
}
