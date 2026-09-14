"use client"

import { ChevronDown, ChevronRight } from "lucide-react"
import type { NotificationCategoryId, NotificationChannelPrefs } from "@/lib/notification-settings"
import { NOTIFICATION_CATEGORY_LABELS } from "@/lib/notification-settings"
import { DELIVERY_LABELS, type DeliveryMethodAvailability } from "@/lib/notification-settings"
import { isPushCategory } from "@/lib/push-notifications/categories"

export interface NotificationCategoryRendererProps {
  categoryId: NotificationCategoryId
  prefs: NotificationChannelPrefs
  deliveryAvailability: DeliveryMethodAvailability
  expanded: boolean
  onToggleExpand: () => void
  onToggleEnabled: (enabled: boolean) => void
  onToggleChannel: (channel: keyof NotificationChannelPrefs, value: boolean) => void
}

/**
 * Renders one notification category: expand/collapse, enabled toggle, and delivery toggles
 * (in-app, push for categories that can push, email, SMS when available).
 *
 * ⚠ THE PUSH BOX SHOWS `push ?? inApp`. A saved row without a push switch pushes whenever
 * in-app is on (that is how push worked before it had a switch), so the box has to show
 * that, not an unticked default the server does not act on.
 */
export function NotificationCategoryRenderer({
  categoryId,
  prefs,
  deliveryAvailability,
  expanded,
  onToggleExpand,
  onToggleEnabled,
  onToggleChannel,
}: NotificationCategoryRendererProps) {
  const label = NOTIFICATION_CATEGORY_LABELS[categoryId]

  return (
    <div
      className="rounded-lg border"
      style={{ borderColor: "var(--border)", background: "var(--panel2)" }}
      data-notification-category={categoryId}
    >
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
        style={{ color: "var(--text)" }}
        aria-expanded={expanded}
        aria-controls={`notification-category-${categoryId}-panel`}
      >
        <span className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="text-sm font-medium">{label}</span>
        </span>
        <label className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <span className="text-xs" style={{ color: "var(--muted)" }}>{prefs.enabled ? "On" : "Off"}</span>
          <input
            type="checkbox"
            checked={prefs.enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
            className="h-4 w-4 rounded border"
            style={{ accentColor: "var(--accent-cyan)" }}
            aria-label={`${label} enabled`}
          />
        </label>
      </button>
      {expanded && (
        <div
          id={`notification-category-${categoryId}-panel`}
          className="border-t px-3 py-2 space-y-2"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="text-xs font-medium" style={{ color: "var(--muted2)" }}>Delivery</p>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prefs.inApp}
                onChange={(e) => onToggleChannel("inApp", e.target.checked)}
                disabled={!deliveryAvailability.inApp}
                className="h-3.5 w-3.5 rounded"
                style={{ accentColor: "var(--accent-cyan)" }}
                aria-label={`${label} ${DELIVERY_LABELS.inApp}`}
              />
              <span style={{ color: "var(--text)" }}>{DELIVERY_LABELS.inApp}</span>
            </label>
            {isPushCategory(categoryId) && deliveryAvailability.push !== false && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs.push ?? prefs.inApp}
                  onChange={(e) => onToggleChannel("push", e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                  style={{ accentColor: "var(--accent-cyan)" }}
                  aria-label={`${label} ${DELIVERY_LABELS.push}`}
                />
                <span style={{ color: "var(--text)" }}>{DELIVERY_LABELS.push}</span>
              </label>
            )}
            {deliveryAvailability.email && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs.email}
                  onChange={(e) => onToggleChannel("email", e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                  style={{ accentColor: "var(--accent-cyan)" }}
                  aria-label={`${label} ${DELIVERY_LABELS.email}`}
                />
                <span style={{ color: "var(--text)" }}>{DELIVERY_LABELS.email}</span>
              </label>
            )}
            {deliveryAvailability.sms && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs.sms}
                  onChange={(e) => onToggleChannel("sms", e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                  style={{ accentColor: "var(--accent-cyan)" }}
                  aria-label={`${label} ${DELIVERY_LABELS.sms}`}
                />
                <span style={{ color: "var(--text)" }}>{DELIVERY_LABELS.sms}</span>
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
