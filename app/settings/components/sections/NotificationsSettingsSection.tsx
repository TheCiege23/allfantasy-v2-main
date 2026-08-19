"use client"

import { useState, useEffect } from "react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import ChimmyAlertPreferencesPanel from "@/components/chimmy-surfaces/ChimmyAlertPreferencesPanel"
import {
  resolveNotificationPreferences,
  getNotificationPreferencesFingerprint,
  getDefaultNotificationPreferences,
  getDeliveryMethodAvailability,
  updateNotificationPreferences,
  sendTestNotification,
  NOTIFICATION_CATEGORY_IDS,
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationPreferences,
  type NotificationCategoryId,
} from "@/lib/notification-settings"
import { NotificationCategoryRenderer } from "@/components/notification-settings/NotificationCategoryRenderer"
import type { SettingsProfile } from "./settings-types"
import { EnableWebPushCard } from "@/components/notifications/EnableWebPushCard"

const CHIMMY_SHORTCUTS_DISABLED_KEY = "af_chimmy_shortcuts_disabled"

export function NotificationsSettingsSection({
  profile,
  onRefetch,
}: {
  profile: SettingsProfile
  onRefetch: () => void
}) {
  const { t } = useLanguage()
  const resolved = resolveNotificationPreferences(profile?.notificationPreferences as NotificationPreferences | null)
  const [prefs, setPrefs] = useState<NotificationPreferences>(resolved)
  const [expandedCategory, setExpandedCategory] = useState<NotificationCategoryId | null>("lineup_reminders")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [remoteUpdatePending, setRemoteUpdatePending] = useState(false)
  const [testCategory, setTestCategory] = useState<NotificationCategoryId>("lineup_reminders")
  const [testing, setTesting] = useState(false)
  const [testResultMessage, setTestResultMessage] = useState<string | null>(null)
  const [testResultTone, setTestResultTone] = useState<"success" | "info" | "error" | null>(null)
  const [chimmyShortcutsEnabled, setChimmyShortcutsEnabled] = useState(true)
  const [lastLoadedFingerprint, setLastLoadedFingerprint] = useState(
    getNotificationPreferencesFingerprint(profile?.notificationPreferences as NotificationPreferences | null)
  )

  useEffect(() => {
    try {
      const disabled = window.localStorage.getItem(CHIMMY_SHORTCUTS_DISABLED_KEY) === "1"
      setChimmyShortcutsEnabled(!disabled)
    } catch {
      setChimmyShortcutsEnabled(true)
    }
  }, [])

  const deliveryAvailability = getDeliveryMethodAvailability({
    hasEmail: !!profile?.email,
    phoneVerified: !!profile?.phoneVerifiedAt,
  })

  useEffect(() => {
    const nextPrefs = resolveNotificationPreferences(profile?.notificationPreferences as NotificationPreferences | null)
    const nextFingerprint = getNotificationPreferencesFingerprint(
      profile?.notificationPreferences as NotificationPreferences | null
    )
    if (dirty) {
      if (nextFingerprint !== lastLoadedFingerprint) {
        setRemoteUpdatePending(true)
      }
      return
    }
    setPrefs(nextPrefs)
    setLastLoadedFingerprint(nextFingerprint)
    setRemoteUpdatePending(false)
  }, [profile?.notificationPreferences, dirty, lastLoadedFingerprint])

  const updateCategory = (categoryId: NotificationCategoryId, patch: Partial<NonNullable<NotificationPreferences["categories"]>[NotificationCategoryId]>) => {
    setDirty(true)
    setSaveError(null)
    setTestResultMessage(null)
    setTestResultTone(null)
    setPrefs((prev) => ({
      ...prev,
      categories: {
        ...prev.categories,
        [categoryId]: { ...(prev.categories?.[categoryId] ?? { enabled: true, inApp: true, email: true, sms: false }), ...patch },
      },
    }))
  }

  const defaultCh = { enabled: true, inApp: true, email: true, sms: false } as const

  const setAllEmailChannels = (email: boolean) => {
    setDirty(true)
    setSaveError(null)
    setTestResultMessage(null)
    setTestResultTone(null)
    setPrefs((prev) => {
      const categories = { ...prev.categories }
      for (const id of NOTIFICATION_CATEGORY_IDS) {
        categories[id] = { ...(categories[id] ?? { ...defaultCh }), email }
      }
      return { ...prev, categories }
    })
  }

  const setAllPushChannels = (inApp: boolean) => {
    setDirty(true)
    setSaveError(null)
    setTestResultMessage(null)
    setTestResultTone(null)
    setPrefs((prev) => {
      const categories = { ...prev.categories }
      for (const id of NOTIFICATION_CATEGORY_IDS) {
        categories[id] = { ...(categories[id] ?? { ...defaultCh }), inApp }
      }
      return { ...prev, categories }
    })
  }

  const allEmailOn = NOTIFICATION_CATEGORY_IDS.every((id) => prefs.categories?.[id]?.email === true)
  const allPushOn = NOTIFICATION_CATEGORY_IDS.every((id) => prefs.categories?.[id]?.inApp === true)

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    const result = await updateNotificationPreferences(prefs)
    setSaving(false)
    if (result.ok) {
      setDirty(false)
      setRemoteUpdatePending(false)
      setLastLoadedFingerprint(getNotificationPreferencesFingerprint(prefs))
      onRefetch()
    } else setSaveError(result.error ?? "Failed to save")
  }

  const handleReset = () => {
    const defaults = getDefaultNotificationPreferences()
    setPrefs(defaults)
    setDirty(true)
    setSaveError(null)
    setRemoteUpdatePending(false)
    setTestResultMessage(null)
    setTestResultTone(null)
  }

  const handleReloadSaved = () => {
    const saved = resolveNotificationPreferences(profile?.notificationPreferences as NotificationPreferences | null)
    setPrefs(saved)
    setDirty(false)
    setRemoteUpdatePending(false)
    setSaveError(null)
    setTestResultMessage(null)
    setTestResultTone(null)
  }

  const handleSendTestNotification = async () => {
    const selectedCategoryPrefs = prefs.categories?.[testCategory] ?? {
      enabled: true,
      inApp: true,
      email: true,
      sms: false,
    }

    setTesting(true)
    setTestResultMessage(null)
    setTestResultTone(null)
    const result = await sendTestNotification({
      category: testCategory,
      channels: {
        inApp: selectedCategoryPrefs.inApp,
        email: selectedCategoryPrefs.email,
        sms: selectedCategoryPrefs.sms,
      },
    })
    setTesting(false)

    if (!result.ok) {
      if (result.rateLimited) {
        setTestResultTone("error")
        setTestResultMessage("Rate limited. Please wait before sending another test.")
        return
      }
      if ((result.blockedReasons?.length ?? 0) > 0) {
        setTestResultTone("info")
        setTestResultMessage(`No test sent. Blocked by: ${(result.blockedReasons ?? []).join(", ")}.`)
        return
      }
      setTestResultTone("error")
      setTestResultMessage(result.error ?? "Failed to send test notification.")
      return
    }

    const sentChannels = Object.entries(result.sent ?? {})
      .filter(([, sent]) => sent)
      .map(([name]) => name)
    if (sentChannels.length > 0) {
      setTestResultTone("success")
      setTestResultMessage(`Test sent via ${sentChannels.join(", ")}.`)
    } else {
      setTestResultTone("info")
      setTestResultMessage("No test sent. Check your current category and delivery settings.")
    }
  }

  const handleChimmyShortcutToggle = (enabled: boolean) => {
    setChimmyShortcutsEnabled(enabled)
    try {
      if (enabled) {
        window.localStorage.removeItem(CHIMMY_SHORTCUTS_DISABLED_KEY)
      } else {
        window.localStorage.setItem(CHIMMY_SHORTCUTS_DISABLED_KEY, "1")
      }
      // Same-tab localStorage writes do not emit a "storage" event.
      window.dispatchEvent(new Event("af:chimmy-shortcuts-changed"))
    } catch {
      // Ignore storage failures; shell defaults to enabled behavior.
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text)]">
          {t("settings.notifications.title")}
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {t("settings.notifications.subtitle")}
        </p>
      </div>

      <div
        className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel2)] p-4"
        data-testid="notifications-global-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-[var(--text)]">
            {t("settings.notifications.globalLabel")}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-[var(--muted)]">
              {prefs.globalEnabled !== false ? t("settings.notifications.on") : t("settings.notifications.off")}
            </span>
            <input
              type="checkbox"
              checked={prefs.globalEnabled !== false}
              onChange={(e) => {
                setDirty(true)
                setSaveError(null)
                setTestResultMessage(null)
                setTestResultTone(null)
                setPrefs((p) => ({ ...p, globalEnabled: e.target.checked }))
              }}
              className="h-4 w-4 rounded accent-[var(--accent-cyan)]"
              data-testid="notifications-global-toggle"
            />
          </label>
        </div>
        <p className="text-xs text-[var(--muted)]">{t("settings.notifications.globalHint")}</p>
      </div>

      {/*
        Per-DEVICE browser push, distinct from the category toggles below.
        Those are account preferences; this is a subscription held by this
        browser, and it is what the injured-starter sweep actually delivers
        through. Without it that sweep has nobody to notify.
      */}
      <div
        className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--panel2)] p-4"
        data-testid="notifications-webpush-card"
      >
        <p className="text-sm font-medium text-[var(--text)]">
          {t("settings.notifications.pushTitle")}
        </p>
        <EnableWebPushCard />
        <p className="text-xs text-[var(--muted)]">{t("settings.notifications.pushHint")}</p>
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-[#1a1f3a]/90 p-4 space-y-3">
        <p className="text-sm font-medium text-[var(--text)]">
          {t("settings.notifications.deliveryMasters")}
        </p>
        <label className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-[var(--muted)]">{t("settings.notifications.emailAll")}</span>
          <input
            type="checkbox"
            checked={allEmailOn}
            onChange={(e) => setAllEmailChannels(e.target.checked)}
            className="h-4 w-4 rounded accent-[var(--accent-cyan)]"
          />
        </label>
        <label className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-[var(--muted)]">{t("settings.notifications.pushAll")}</span>
          <input
            type="checkbox"
            checked={allPushOn}
            onChange={(e) => setAllPushChannels(e.target.checked)}
            className="h-4 w-4 rounded accent-[var(--accent-cyan)]"
          />
        </label>
        <p className="text-xs text-[var(--muted2)]">{t("settings.notifications.deliveryMixHint")}</p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-[var(--muted2)]">{t("settings.notifications.byCategory")}</p>
        <ul className="space-y-2">
          {NOTIFICATION_CATEGORY_IDS.map((categoryId) => (
            <li key={categoryId}>
              <NotificationCategoryRenderer
                categoryId={categoryId}
                prefs={prefs.categories?.[categoryId] ?? { enabled: true, inApp: true, email: true, sms: false }}
                deliveryAvailability={deliveryAvailability}
                expanded={expandedCategory === categoryId}
                onToggleExpand={() => setExpandedCategory((c) => (c === categoryId ? null : categoryId))}
                onToggleEnabled={(enabled) => updateCategory(categoryId, { enabled })}
                onToggleChannel={(channel, value) => updateCategory(categoryId, { [channel]: value })}
              />
            </li>
          ))}
        </ul>
      </div>

      {remoteUpdatePending && (
        <div className="rounded-xl border border-[var(--accent-cyan)] bg-[color-mix(in_srgb,var(--accent-cyan)_12%,transparent)] px-3 py-2 text-sm text-[var(--text)]">
          {t("settings.notifications.remotePending")}
          <button
            type="button"
            onClick={handleReloadSaved}
            className="ml-2 rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--text)]"
          >
            {t("settings.notifications.reloadSaved")}
          </button>
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel2)] p-4">
        <p className="text-sm font-medium text-[var(--text)]">{t("settings.notifications.testTitle")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Notification test category"
            value={testCategory}
            onChange={(e) => setTestCategory(e.target.value as NotificationCategoryId)}
            className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
          >
            {NOTIFICATION_CATEGORY_IDS.map((id) => (
              <option key={id} value={id}>{NOTIFICATION_CATEGORY_LABELS[id]}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleSendTestNotification}
            disabled={testing}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text)]"
          >
            {testing ? t("settings.notifications.sendingTest") : t("settings.notifications.sendTest")}
          </button>
        </div>
        <p className="text-xs text-[var(--muted)]">{t("settings.notifications.testHint")}</p>
        {testResultMessage && (
          <p
            className={[
              "text-xs",
              testResultTone === "success"
                ? "text-emerald-600"
                : testResultTone === "error"
                  ? "text-[var(--accent-red-strong)]"
                  : "text-[var(--muted2)]",
            ].join(" ")}
          >
            {testResultMessage}
          </p>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel2)] p-4">
        <div>
          <p className="text-sm font-medium text-[var(--text)]">Chimmy alert controls</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Tune Chimmy alert frequency, muted categories, and channel-level delivery without leaving settings.
          </p>
        </div>
        <ChimmyAlertPreferencesPanel />
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2">
          <label className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-[var(--text)]">Enable Chimmy global keyboard shortcuts</span>
            <input
              type="checkbox"
              checked={chimmyShortcutsEnabled}
              onChange={(e) => handleChimmyShortcutToggle(e.target.checked)}
              className="h-4 w-4 rounded accent-[var(--accent-cyan)]"
              data-testid="chimmy-shortcuts-toggle"
            />
          </label>
          <p className="mt-1 text-xs text-[var(--muted)]">Shortcuts: <kbd className="rounded border border-[var(--border)] px-1 py-0.5">/</kbd> and <kbd className="rounded border border-[var(--border)] px-1 py-0.5">Ctrl/Cmd+Shift+K</kbd></p>
        </div>
      </div>

      {saveError && (
        <p className="text-sm text-[var(--accent-red-strong)]">{saveError}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={handleSave}
          data-testid="notifications-save-button"
          className={[
            "rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold",
            dirty && !saving
              ? "bg-[linear-gradient(135deg,var(--accent-cyan),var(--accent-purple))] text-[var(--on-accent-bg)]"
              : "bg-[var(--panel2)] text-[var(--muted)]",
          ].join(" ")}
        >
          {saving ? t("settings.actions.saving") : t("settings.notifications.save")}
        </button>
        <button
          type="button"
          onClick={handleReset}
          data-testid="notifications-reset-button"
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)]"
        >
          {t("settings.notifications.resetDefaults")}
        </button>
        <a
          href="/alerts/settings"
          data-testid="notifications-sports-alerts-link"
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)]"
        >
          {t("settings.notifications.sportsAlertsPage")}
        </a>
        <a
          href="/settings?tab=profile"
          data-testid="notifications-back-to-profile-link"
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)]"
        >
          {t("settings.notifications.backToProfile")}
        </a>
      </div>
    </div>
  )
}
