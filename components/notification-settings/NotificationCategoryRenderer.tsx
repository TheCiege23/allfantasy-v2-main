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
      {/*
        ⚠ THE SWITCH IS A SIBLING OF THE EXPAND BUTTON, NOT A CHILD. It used to sit inside the
        <button>, which is invalid HTML (no interactive content inside a button): Firefox delivers
        the click to the button, so the switch never toggled and the row expanded instead.
      */}
      <div className="flex items-center gap-2 pr-3">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 py-2.5 pl-3 text-left"
          style={{ color: "var(--text)" }}
          aria-expanded={expanded}
          aria-controls={`notification-category-${categoryId}-panel`}
        >
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <span className="min-w-0 text-sm font-medium">{label}</span>
        </button>
        <label className="flex shrink-0 items-center gap-2">
          <span className="w-6 text-right text-xs" style={{ color: "var(--muted)" }}>{prefs.enabled ? "On" : "Off"}</span>
          <input
            type="checkbox"
            role="switch"
            checked={prefs.enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
            className="h-4 w-4 rounded border"
            style={{ accentColor: "var(--accent-cyan)" }}
            aria-label={`${label} enabled`}
          />
        </label>
      </div>
      {expanded && (
        <div
          id={`notification-category-${categoryId}-panel`}
          className="border-t px-3 py-2 space-y-2"
          style={{ borderColor: "var(--border)", opacity: prefs.enabled ? 1 : 0.6 }}
        >
          <p className="text-xs font-medium" style={{ color: "var(--muted2)" }}>
            Delivery{prefs.enabled ? "" : " — turn this alert on to use these"}
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
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
