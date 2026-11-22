import {
  buildMetaEventPayload,
  type MetaEventPayload,
} from "@/lib/meta-events"
import type { MonetizationCatalogItem } from "@/lib/monetization/catalog"

function money(value: number): number {
  return Number(Number(value || 0).toFixed(2))
}

export function buildSubscriptionMetaEvent(
  eventName: "InitiateCheckout" | "Purchase" | "StartTrial",
  item: MonetizationCatalogItem,
  options?: {
    eventId?: string
    sourceId?: string
    deterministic?: boolean
    orderId?: string | null
  }
): MetaEventPayload {
  const amount = money(item.amountUsd)
  return buildMetaEventPayload(
    eventName,
    {
      value: amount,
      currency: item.currency.toUpperCase(),
      content_name: item.title,
      content_category: "Subscription",
      content_ids: [item.sku],
      content_type: "product",
      contents: [
        {
          id: item.sku,
          quantity: 1,
          item_price: amount,
        },
      ],
      num_items: 1,
      order_id: options?.orderId ?? undefined,
      subscription_interval: item.interval,
      plan_family: item.planFamily,
      sku: item.sku,
    },
    {
      eventId: options?.eventId,
      sourceId: options?.sourceId,
      deterministic: options?.deterministic,
      contentName: item.title,
      contentCategory: "Subscription",
      value: amount,
      currency: item.currency,
    }
  )
}

export function buildSubscriptionPurchaseMetaEvent(
  item: MonetizationCatalogItem,
  stripeSessionId: string
): MetaEventPayload {
  return buildSubscriptionMetaEvent("Purchase", item, {
    sourceId: `stripe_checkout:${stripeSessionId}`,
    deterministic: true,
    orderId: stripeSessionId,
  })
}
