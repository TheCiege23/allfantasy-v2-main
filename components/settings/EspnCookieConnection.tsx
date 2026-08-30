"use client"

/**
 * Connect ESPN, in Settings → Connected Accounts.
 *
 * ⚠ THE PANEL ITSELF MOVED; THIS FILE DID NOT. Every line of logic and markup that
 * used to live here is now `components/core-app/import/EspnConnectPanel.tsx`, because
 * the import flow needs the SAME panel — ESPN cannot be imported without a
 * connection, and the import screen used to handle that by linking out to this page
 * and abandoning the import. Two copies of the connect logic (extension ping,
 * one-click, cookie fallback, disconnect) would mean fixing every ESPN bug twice.
 *
 * This file survives as the mount rather than being deleted and its importer
 * repointed, for one reason: `app/settings/components/sections/ConnectedAccountsSettingsSection.tsx`
 * imports `EspnCookieConnection` from this path, and keeping the name means the
 * Settings page is untouched by the move.
 *
 * ⚠ THE `.af-core` WRAPPER IS LOAD BEARING, NOT COSMETIC. Settings is authored
 * against the older token set (`--panel`, `--panel2`, `--border`, `--muted2`,
 * `--accent-cyan`); the panel is authored against the core one (`--surface`,
 * `--surface2`, `--line`, `--text2`, `--accent`), which is declared ONLY under
 * `.af-core`. Without this div every var() in the panel resolves to nothing and it
 * renders borderless, backgroundless and with an invisible primary button — the
 * exact failure ImportV4's own header note describes. `.af-core` declares tokens and
 * a font-family and paints no background of its own, so the blast radius is this
 * panel and nothing around it.
 */

import { EspnConnectPanel } from "@/components/core-app/import/EspnConnectPanel"

export function EspnCookieConnection() {
  return (
    <div className="af-core">
      <EspnConnectPanel />
    </div>
  )
}

export default EspnCookieConnection
