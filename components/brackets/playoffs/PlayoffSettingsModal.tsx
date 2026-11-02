"use client"

import { useEffect, useRef } from "react"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"
import { CommissionerFanCredSetupNotice } from "@/components/legal/CommissionerFanCredSetupNotice"

/**
 * Commissioner settings.
 *
 * 🛑 THE PROVIDER PICKER FROM THE DESIGN IS NOT HERE, AND BOTH REASONS MATTER.
 * The mockup let a commissioner choose a payments provider and described
 * FanCred as "buy-ins, side markets and instant payouts". First, there is
 * nowhere to PUT the answer — `PlayoffBracketChallenge` has no column for it
 * and adding one is a migration, which is the user's call, not a side effect
 * of a UI change. Second, the app's own committed copy already names one
 * arrangement: dues are settled in FanCred, outside AllFantasy, and "no
 * gambling, betting, or in-app prize payout systems are offered". A picker
 * offering alternatives would contradict the terms while saving nothing.
 *
 * So the payments section renders `CommissionerFanCredSetupNotice` — the same
 * committed component the rest of the app uses — rather than new copy that
 * could drift from the disclosure it is supposed to reflect.
 *
 * ⚠ EVERYTHING HERE IS READ-ONLY EXCEPT "RE-SYNC NOW". Pool name, lock rule
 * and visibility have no write path on this surface, so they are shown as
 * values, not as inputs that quietly discard what you type.
 *
 * ⚠ VISIBILITY IS DISPLAYED BUT NOT ENFORCED ANYWHERE YET — a "private" pool
 * is readable by anyone holding the id. It is labelled as such rather than
 * left to imply a protection it does not provide.
 */

export type PlayoffSettingsModalProps = {
  view: PlayoffChallengeView
  canAdmin: boolean
  onClose: () => void
  onResync?: () => void
  resyncing?: boolean
}

export default function PlayoffSettingsModal({
  view,
  canAdmin,
  onClose,
  onResync,
  resyncing,
}: PlayoffSettingsModalProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const lockRule = view.challenge.lockRule ?? view.challenge.config?.lockRule ?? "series start"
  const sport = String(view.challenge.sport ?? "").toLowerCase()
  const singleGameSport = sport === "ncaaf" || sport === "nba_cup" || sport === "nfl"

  return (
    <div
      className="af-pb-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Pool settings"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="af-pb-modal" data-testid="pb-settings-modal">
        <div className="af-pb-modal-head">
          <span>Pool settings</span>
          <button
            ref={closeRef}
            type="button"
            className="af-pb-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="af-pb-modal-body">
          <div className="af-pb-setting-row">
            <span style={{ color: "var(--pb-muted)" }}>Pool</span>
            <strong>{view.challenge.name}</strong>
          </div>
          <div className="af-pb-setting-row">
            <span style={{ color: "var(--pb-muted)" }}>Season</span>
            <strong className="af-pb-mono">{view.challenge.seasonYear}</strong>
          </div>
          <div className="af-pb-setting-row">
            <span style={{ color: "var(--pb-muted)" }}>Picks lock</span>
            <strong>{String(lockRule).replace(/_/g, " ")}</strong>
          </div>
          <div className="af-pb-setting-row">
            <span style={{ color: "var(--pb-muted)" }}>Visibility</span>
            <strong>{String(view.challenge.visibility ?? "private")}</strong>
          </div>
          <p className="af-pb-note">
            {singleGameSport
              ? "Shared entry links reveal picks only after each game starts. Private leagues require membership."
              : "Visibility is not enforced yet — anyone with the pool link can open it. Treat the link as the access control until that is wired."}
          </p>

          <div className="af-pb-section-label">Seeding</div>
          <p className="af-pb-note" style={{ marginTop: 0 }}>
            {sport === "ncaaf"
              ? "An admin publishes the committee’s 12-team field and game times before picks open."
              : sport === "nba_cup"
                ? "An admin publishes the eight knockout qualifiers and game times after group play is final."
                : sport === "nfl"
                  ? "Seeds 1–7 in each conference are filled from the final regular-season standings, and game times from the NFL schedule. The divisional round reseeds: the 1 seed plays the lowest seed left."
                : "Seeds 1–6 in each league are filled from live standings once the regular season is over. Until then the bracket shows seed slots (AL1…NL6) rather than clubs."}
          </p>
          {canAdmin && onResync ? (
            <button
              type="button"
              className="af-pb-btn af-pb-btn--accent"
              onClick={onResync}
              disabled={!!resyncing}
              data-testid="pb-settings-resync"
            >
              {resyncing ? "Syncing…" : "Sync official data now"}
            </button>
          ) : null}

          <div className="af-pb-section-label">{singleGameSport ? "Fair play" : "Pool dues"}</div>
          {singleGameSport ? <p className="af-pb-note">AllFantasy offers no prizes, gambling, betting, entry fees, or payouts. Extra brackets are a subscription feature. Commissioners manage any external arrangements separately under AllFantasy terms.</p> : <CommissionerFanCredSetupNotice dataTestId="pb-fancred-disclosure" />}
        </div>

        <div className="af-pb-modal-foot">
          <button type="button" className="af-pb-btn af-pb-btn--accent" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
