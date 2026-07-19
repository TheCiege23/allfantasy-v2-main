'use client'

/**
 * "Your Snapshot" — the customisable KPI row.
 *
 * Layout is genuinely different per breakpoint, not one grid reflowed:
 *   desktop  6-column grid
 *   tablet   3-column grid (two rows)
 *   mobile   horizontally snap-scrolling strip of fixed-width cards
 *
 * The row owns presentation and edit mode only. Each widget arrives with its content
 * already resolved by the orchestrator — including, where a metric has no real source, a
 * `<NoMetric/>` node. Keeping the "is there data" decision upstream is what stops this
 * component from ever having to invent a fallback number.
 */

import type { ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import type { DeviceKind } from '../hooks/useDeviceKind'
import type { WidgetLayout } from '../hooks/useWidgetLayout'
import { LockOverlay } from '../ui/Gating'

export type KpiWidget = {
  key: string
  label: string
  locked: boolean
  lockLabel: string
  onUnlock: () => void
  /** Already-resolved body: chart + value, or an honest empty state. */
  body: ReactNode
}

export function KpiRow({
  widgets, layout, device, editMode, onToggleEdit,
}: {
  widgets: KpiWidget[]
  layout: WidgetLayout
  device: DeviceKind
  editMode: boolean
  onToggleEdit: () => void
}) {
  const byKey = new Map(widgets.map((w) => [w.key, w]))
  const visible = layout.visible.map((k) => byKey.get(k)).filter((w): w is KpiWidget => Boolean(w))
  const hidden = layout.hidden.map((k) => byKey.get(k)).filter((w): w is KpiWidget => Boolean(w))

  const isMobile = device === 'mobile'
  const columns = device === 'desktop' ? 'repeat(6,1fr)' : device === 'tablet' ? 'repeat(3,1fr)' : undefined

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
        <h2 className="af-section-title">Your Snapshot</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {editMode && layout.isCustomised && (
            <button type="button" onClick={layout.reset} className="af-btn af-btn-ghost"
              style={{ fontSize: 11, padding: '5px 9px', fontWeight: 500 }}>
              Reset Layout
            </button>
          )}
          <button type="button" onClick={onToggleEdit} className="af-btn af-btn-ghost"
            aria-pressed={editMode}
            style={{ fontSize: 11, padding: '5px 10px', color: editMode ? 'var(--af-cyan)' : 'var(--af-text-muted)' }}>
            <Pencil size={12} strokeWidth={2} />
            {editMode ? 'Done' : 'Customize'}
          </button>
        </div>
      </div>

      <div
        className={isMobile ? 'af-hscroll af-hsnap' : undefined}
        style={
          isMobile
            ? { marginBottom: 22 }
            : { display: 'grid', gridTemplateColumns: columns, gap: 12, marginBottom: 22 }
        }
      >
        {visible.map((w, i) => (
          <div key={w.key} style={{
            position: 'relative',
            borderRadius: 'var(--af-r-lg)',
            ...(isMobile ? { flexShrink: 0, minWidth: 210, width: 210 } : null),
          }}>
            <div className={`af-card${w.locked ? ' af-locked-body' : ''}`} style={{ height: '100%' }}
              aria-hidden={w.locked || undefined}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div className="af-card-label">{w.label}</div>
                {editMode && !w.locked && (
                  <EditControls
                    canMoveLeft={i > 0}
                    canMoveRight={i < visible.length - 1}
                    onLeft={() => layout.move(w.key, -1)}
                    onRight={() => layout.move(w.key, 1)}
                    onHide={() => layout.hide(w.key)}
                    label={w.label}
                  />
                )}
              </div>
              <div style={{ marginTop: 6 }}>{w.body}</div>
            </div>
            {w.locked && <LockOverlay label={w.lockLabel} onUnlock={w.onUnlock} />}
          </div>
        ))}
      </div>

      {hidden.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '-12px 0 20px' }}>
          <span style={{ fontSize: 11, color: 'var(--af-text-faint)' }}>Hidden:</span>
          {hidden.map((w) => (
            <button key={w.key} type="button" onClick={() => layout.show(w.key)}
              style={{
                fontSize: 11, color: 'var(--af-text-muted)', background: 'var(--af-surface-2)',
                border: '1px dashed rgba(139,92,246,.35)', borderRadius: 6, padding: '4px 9px', cursor: 'pointer',
              }}>
              + {w.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function EditControls({
  canMoveLeft, canMoveRight, onLeft, onRight, onHide, label,
}: {
  canMoveLeft: boolean; canMoveRight: boolean
  onLeft: () => void; onRight: () => void; onHide: () => void
  label: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
      <MiniBtn onClick={onLeft} disabled={!canMoveLeft} label={`Move ${label} left`}>‹</MiniBtn>
      <MiniBtn onClick={onRight} disabled={!canMoveRight} label={`Move ${label} right`}>›</MiniBtn>
      <MiniBtn onClick={onHide} label={`Hide ${label}`} tone="danger">✕</MiniBtn>
    </div>
  )
}

function MiniBtn({
  children, onClick, disabled, label, tone,
}: {
  children: ReactNode; onClick: () => void; disabled?: boolean; label: string; tone?: 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        width: 18, height: 18, borderRadius: 4, background: 'var(--af-surface-2)', border: 'none',
        color: tone === 'danger' ? 'var(--af-red)' : 'var(--af-text-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: tone === 'danger' ? 10 : 11, lineHeight: 1, opacity: disabled ? 0.35 : 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
      }}
    >
      {children}
    </button>
  )
}
