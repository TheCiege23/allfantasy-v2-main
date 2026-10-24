"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { tOr } from "@/lib/i18n/tInterpolate"
import {
  HIDDEN_HOME_SECTIONS_KEY,
  HOME_SECTIONS,
  HOME_SECTION_GROUPS,
  readHiddenHomeSections,
  toggleHomeSection,
  type HomeSectionId,
} from "@/lib/core-app/homeSections"
import {
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_CATEGORY_LABEL_KEYS,
} from "@/lib/notification-settings/types"
import type { SettingsProfile } from "./settings-types"

/**
 * Settings → Home page (2026-10-24): one switch per /core home section.
 *
 * A user loved the app and found the home "way too much information". The ask was a control as
 * plain as the league import picker: every row says what it is, ON is unmistakable, and OFF takes
 * the card AND its notifications away. The mapping lives in lib/core-app/homeSections.ts.
 *
 * ⚠ EVERY CLICK SAVES — THERE IS NO SAVE BUTTON. The row flips at once and the write follows. Writes
 * run one at a time, each carrying the whole list as it stands after that click, so two quick taps
 * can never land out of order and leave the server holding the older list. A failed write puts the
 * switches back to what the server last confirmed and says so.
 */

/**
 * Sections whose "off" also silences an alert that needs you to act — on the clock in a draft, an offer
 * sent to you. Said on the row in plain words, so nobody discovers it by missing a pick.
 */
const WARN_KEY: Partial<Record<HomeSectionId, string>> = {
  drafts: "settings.home.warn.drafts",
  "league-trades": "settings.home.warn.leagueTrades",
}

type SaveState = "idle" | "saving" | "saved" | "error"

export function HomeSectionsSettingsSection({
  profile,
  onRefetch,
}: {
  profile: SettingsProfile
  onRefetch: () => void
}) {
  const { t, tInterpolate } = useLanguage()
  const [hidden, setHidden] = useState<Set<HomeSectionId>>(() =>
    readHiddenHomeSections(profile?.notificationPreferences),
  )
  const [saveState, setSaveState] = useState<SaveState>("idle")
  /** The list as of the latest click — two taps inside one render must both count. */
  const latest = useRef<Set<HomeSectionId>>(hidden)
  const apply = (next: Set<HomeSectionId>) => {
    latest.current = next
    setHidden(next)
  }
  /** What the server last confirmed — where a failed write returns the switches to. */
  const confirmed = useRef<Set<HomeSectionId>>(new Set(hidden))
  const queue = useRef<Promise<void>>(Promise.resolve())
  const pending = useRef(0)

  // Follows a profile refetch, but never over a click still being saved.
  useEffect(() => {
    if (pending.current > 0) return
    const next = readHiddenHomeSections(profile?.notificationPreferences)
    confirmed.current = new Set(next)
    latest.current = next
    setHidden(next)
  }, [profile?.notificationPreferences])

  useEffect(() => {
    if (saveState !== "saved") return
    const id = window.setTimeout(() => setSaveState("idle"), 2500)
    return () => window.clearTimeout(id)
  }, [saveState])

  const save = useCallback(
    (list: HomeSectionId[]) => {
      pending.current += 1
      setSaveState("saving")
      queue.current = queue.current.then(async () => {
        let ok = false
        try {
          const res = await fetch("/api/user/profile", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notificationPreferences: { [HIDDEN_HOME_SECTIONS_KEY]: list } }),
          })
          ok = res.ok
        } catch {
          ok = false
        }
        pending.current -= 1
        if (ok) {
          confirmed.current = new Set(list)
          if (pending.current === 0) {
            setSaveState("saved")
            // Other tabs (the Notifications notes) read the same profile.
            onRefetch()
          }
        } else {
          if (pending.current === 0) {
            latest.current = new Set(confirmed.current)
            setHidden(new Set(confirmed.current))
          }
          setSaveState("error")
        }
      })
    },
    [onRefetch],
  )

  const setVisible = (id: HomeSectionId, visible: boolean) => {
    const list = toggleHomeSection(latest.current, id, visible)
    apply(new Set(list))
    save(list)
  }

  const showAll = () => {
    if (latest.current.size === 0) return
    apply(new Set())
    save([])
  }

  const shownCount = HOME_SECTIONS.length - hidden.size
  const categoryLabel = (id: (typeof HOME_SECTIONS)[number]["categories"][number]) =>
    tOr(t, NOTIFICATION_CATEGORY_LABEL_KEYS[id], NOTIFICATION_CATEGORY_LABELS[id])

  return (
    <div className="space-y-5" data-testid="settings-home-sections">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
          {t("settings.home.title")}
        </h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {t("settings.home.intro")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold" style={{ color: "var(--text)" }} data-testid="home-sections-count">
            {tInterpolate("settings.home.count", { shown: shownCount, total: HOME_SECTIONS.length })}
          </span>
          <button
            type="button"
            onClick={showAll}
            disabled={hidden.size === 0}
            className="min-h-[36px] rounded-lg border px-3 text-xs font-semibold disabled:opacity-40"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            {t("settings.home.showAll")}
          </button>
          <span
            role="status"
            aria-live="polite"
            className="text-xs font-semibold"
            style={{ color: saveState === "error" ? "var(--accent-red-strong, #fb5b78)" : "var(--muted)" }}
          >
            {saveState === "saving"
              ? t("settings.home.saving")
              : saveState === "saved"
                ? t("settings.home.saved")
                : saveState === "error"
                  ? t("settings.home.saveFailed")
                  : ""}
          </span>
        </div>
      </div>

      {HOME_SECTION_GROUPS.map((group) => (
        <section key={group} className="space-y-2" aria-labelledby={`home-sections-${group}`}>
          <h3
            id={`home-sections-${group}`}
            className="text-xs font-bold uppercase tracking-[0.12em]"
            style={{ color: "var(--muted2)" }}
          >
            {t(`settings.home.group.${group}`)}
          </h3>
          <ul className="space-y-2">
            {HOME_SECTIONS.filter((s) => s.group === group).map((section) => {
              const visible = !hidden.has(section.id)
              const title = t(`settings.home.section.${section.id}.title`)
              const warnKey = WARN_KEY[section.id]
              return (
                <li key={section.id}>
                  {/*
                    The whole row is the label, so a tap anywhere flips it — the import picker's lesson:
                    a small target on a phone is what made the choice feel hard.
                  */}
                  <label
                    className="af-home-section-row flex cursor-pointer items-start gap-3 rounded-xl px-4 py-3"
                    data-shown={visible ? "true" : "false"}
                    data-home-section={section.id}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold" style={{ color: "var(--text)" }}>
                          {title}
                        </span>
                        {!visible ? (
                          <span className="af-home-section-hidden-tag">{t("settings.home.hiddenTag")}</span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                        {t(`settings.home.section.${section.id}.desc`)}
                      </span>
                      {section.categories.length > 0 ? (
                        <span className="mt-1.5 block text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
                          {tInterpolate(visible ? "settings.home.alsoMutes" : "settings.home.alsoMuted", {
                            list: section.categories.map(categoryLabel).join(" · "),
                          })}
                        </span>
                      ) : (
                        <span className="mt-1.5 block text-xs" style={{ color: "var(--muted2)" }}>
                          {t("settings.home.visualOnly")}
                        </span>
                      )}
                      {warnKey ? (
                        <span
                          className="mt-1 block text-xs font-semibold"
                          style={{ color: "var(--ns-warn, #fbbf24)" }}
                          data-testid={`home-section-warn-${section.id}`}
                        >
                          ⚠ {t(warnKey)}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={visible}
                        onChange={(e) => setVisible(section.id, e.target.checked)}
                        aria-label={tInterpolate("settings.home.switchAria", { section: title })}
                      />
                      <span className="text-[11px] font-bold" style={{ color: visible ? "var(--accent-cyan)" : "var(--muted)" }}>
                        {visible ? t("settings.home.on") : t("settings.home.off")}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      <p className="text-xs" style={{ color: "var(--muted2)" }}>
        {t("settings.home.footnote")}
      </p>
    </div>
  )
}
