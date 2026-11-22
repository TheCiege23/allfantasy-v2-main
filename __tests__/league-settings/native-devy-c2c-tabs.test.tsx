/**
 * Commissioner Settings for a Devy or C2C league that plays on AllFantasy.
 *
 * Such a league's settings live in `DevyLeagueConfig` / `C2CLeagueConfig` (written at creation). The
 * modal's Devy and C2C tabs read the legacy `DevyLeague` / `C2CLeague` records instead, which nothing in
 * the app creates any more, so those tabs never showed and a commissioner could not reach the editors
 * from here. The modal now asks the native config routes and adds one editable tab for each.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SettingsNav, isC2cSettingsTab, isDevySettingsTab } from '@/app/league/[leagueId]/components/settings/SettingsNav'

const nav = (over: Record<string, boolean> = {}) =>
  render(<SettingsNav activeTab="league" onSelect={vi.fn()} saveStatus={'idle' as never} {...over} />)

describe('the native Devy / C2C tabs', () => {
  it('show only for a league that has the native config', () => {
    const { unmount } = nav()
    expect(screen.queryByText('Devy Settings')).toBeNull()
    expect(screen.queryByText('C2C Settings')).toBeNull()
    unmount()
    nav({ showNativeDevyTab: true, showNativeC2cTab: true })
    expect(screen.getByText('Devy Settings')).toBeTruthy()
    expect(screen.getByText('C2C Settings')).toBeTruthy()
  })

  it('are not legacy tabs, so the legacy guards never send them back to League', () => {
    expect(isDevySettingsTab('native_devy')).toBe(false)
    expect(isC2cSettingsTab('native_c2c')).toBe(false)
  })

  it('the modal asks the native config routes and mounts the editors there', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/league/[leagueId]/components/CommissionerSettingsModal.tsx'), 'utf8')
    expect(src).toMatch(/\/api\/leagues\/\$\{id\}\/devy\/config`/)
    expect(src).toMatch(/\/api\/leagues\/\$\{id\}\/merged-devy-c2c\/config`/)
    expect(src).toMatch(/showNativeDevyTab=\{nativeDevy\}/)
    expect(src).toMatch(/showNativeC2cTab=\{nativeC2c\}/)
    const devy = src.slice(src.indexOf("activeTab === 'native_devy' ?"), src.indexOf("activeTab === 'native_c2c' ?"))
    expect(devy).toMatch(/<DevySettingsPanel leagueId=\{leagueId\} isCommissioner=\{canEdit\} \/>/)
    const c2c = src.slice(src.indexOf("activeTab === 'native_c2c' ?"), src.indexOf("activeTab === 'c2c_format' ?"))
    expect(c2c).toMatch(/canEdit \?\s*\(\s*<MergedDevyC2CCommissionerSettings leagueId=\{leagueId\} \/>/)
  })

  it('the legacy Devy panel no longer promises edits "in a follow-up", and points native leagues to Devy Settings', async () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/devy/components/settings/DevyFormatPanel.tsx'), 'utf8')
    expect(src).not.toMatch(/follow-up/)
    // The copy moved into the dictionaries (English and Spanish) when the panel became an editor.
    expect(src).toMatch(/t\('legacyDevy\.format\.intro'\)/)
    const { translations } = await import('@/lib/i18n/translations')
    expect(translations.en['legacyDevy.format.intro']).toMatch(/Devy Settings/)
    expect(translations.es['legacyDevy.format.intro']).toMatch(/Devy Settings/)
  })
})
