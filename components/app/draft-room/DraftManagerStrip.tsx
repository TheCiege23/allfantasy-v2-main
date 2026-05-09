'use client'

import { Crown } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { getManagerColorBySlot, withAlpha } from '@/lib/draft-room'
import { sleeperAvatarUrl } from '@/lib/sleeper-avatar'

export type ManagerSlot = {
  slot: number
  rosterId: string
  displayName: string
  teamName?: string | null
  handle?: string | null
  avatarUrl?: string | null
  isCommissioner?: boolean
  /** If this pick was traded, show metadata */
  tradedPickMeta?: { newOwnerName?: string; previousOwnerName?: string; tintColor?: string } | null
}

export type DraftManagerStripProps = {
  managers: ManagerSlot[]
  activeRosterId: string | null
  tradedPickColorMode?: boolean
  /** Optional: show new owner name in red on traded picks */
  showNewOwnerInRed?: boolean
  /** Optional: e.g. "Weighted Lottery Order" when order came from lottery */
  orderSourceLabel?: string | null
  /** Roster IDs the current user can claim (member without a team; placeholder rosters). */
  claimableRosterIds?: readonly string[] | null
  onClaimSlot?: (rosterId: string) => void
  claimSlotLoadingRosterId?: string | null
}

function normalizeManagerKey(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function managerInitials(value: string): string {
  const parts = value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)

  if (parts.length === 0) return 'AF'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

export function DraftManagerStrip({
  managers,
  activeRosterId,
  tradedPickColorMode = false,
  showNewOwnerInRed = false,
  orderSourceLabel,
  claimableRosterIds = null,
  onClaimSlot,
  claimSlotLoadingRosterId = null,
}: DraftManagerStripProps) {
  const { t } = useLanguage()
  const claimSet = claimableRosterIds?.length ? new Set(claimableRosterIds) : null

  return (
    <div className="border-b border-white/8 bg-[#060b14] px-2 pb-1 pt-0.5 sm:px-3 sm:pb-1.5 sm:pt-1">
      {orderSourceLabel ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/38">
            Draft order
          </span>
          <span className="rounded-full border border-amber-400/25 bg-amber-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200/90">
            {orderSourceLabel}
          </span>
        </div>
      ) : null}

      <div className="flex gap-2 overflow-x-auto pb-0.5 sm:gap-2.5" data-testid="draft-manager-strip">
        {managers.map((manager) => {
          const isActive = manager.rosterId === activeRosterId
          const color = getManagerColorBySlot(manager.slot)
          const avatarSrc = sleeperAvatarUrl(manager.avatarUrl)
          const displayHandle = (manager.handle?.trim() || manager.displayName?.trim() || manager.teamName?.trim() || `Team ${manager.slot}`).replace(/^@/, '')
          const initials = managerInitials(manager.handle?.trim() || manager.displayName?.trim() || manager.teamName?.trim() || `Manager ${manager.slot}`)
          const tradedTint =
            tradedPickColorMode && manager.tradedPickMeta?.tintColor
              ? {
                  borderColor: withAlpha(manager.tradedPickMeta.tintColor, 0.65),
                  backgroundColor: withAlpha(manager.tradedPickMeta.tintColor, 0.14),
                }
              : undefined

          const showClaim = Boolean(claimSet?.has(manager.rosterId) && onClaimSlot)
          const claiming = claimSlotLoadingRosterId === manager.rosterId

          return (
            <div
              key={manager.rosterId}
              className="group flex min-w-[56px] flex-col items-center gap-1 pb-0.5 text-center sm:min-w-[64px]"
              data-slot={manager.slot}
              data-roster-id={manager.rosterId}
              data-testid={`draft-manager-slot-${manager.slot}`}
            >
              <div className="relative flex h-9 w-9 items-center justify-center sm:h-11 sm:w-11">
                <span
                  className="absolute inset-1 rounded-full blur-[10px] transition-opacity duration-200 group-hover:opacity-100"
                  style={{ backgroundColor: withAlpha(color.tintHex, isActive ? 0.48 : 0.3) }}
                  aria-hidden
                />
                <div
                  className={`relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border bg-[#020814] shadow-[0_8px_24px_rgba(0,0,0,0.35)] sm:h-9 sm:w-9 ${
                    isActive ? 'ring-2 ring-cyan-300/75 ring-offset-2 ring-offset-[#060b14]' : ''
                  }`}
                  style={
                    tradedTint ?? {
                      borderColor: withAlpha(color.tintHex, isActive ? 0.9 : 0.52),
                      backgroundColor: withAlpha(color.tintHex, 0.12),
                    }
                  }
                >
                  {avatarSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-white/80">
                      {initials}
                    </span>
                  )}
                </div>

                {manager.isCommissioner ? (
                  <span className="absolute -right-0.5 -top-0.5 rounded-full border border-amber-300/40 bg-[#0b1323] p-1 text-amber-200 shadow-sm">
                    <Crown className="h-2.5 w-2.5" />
                  </span>
                ) : null}

                {isActive ? (
                  <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border border-[#071020] bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,0.8)]" />
                ) : null}
              </div>

              <div className="w-[62px] sm:w-[70px]">
                <p className={`truncate text-[10px] font-semibold leading-tight sm:text-[11px] ${isActive ? 'text-white' : 'text-[#9fb7ff]'}`}>
                  {displayHandle}
                </p>

                {showNewOwnerInRed && manager.tradedPickMeta?.newOwnerName ? (
                  <p className="truncate text-[9px] text-red-300 sm:text-[10px]" title={`Now: ${manager.tradedPickMeta.newOwnerName}`}>
                    Now {manager.tradedPickMeta.newOwnerName}
                  </p>
                ) : manager.teamName &&
                  normalizeManagerKey(manager.teamName) !== normalizeManagerKey(displayHandle) ? (
                  <p className="truncate text-[9px] text-white/32 sm:text-[10px]">{manager.teamName}</p>
                ) : null}

                {!manager.teamName &&
                normalizeManagerKey(displayHandle) !== normalizeManagerKey(`Team ${manager.slot}`) ? (
                  <p className="truncate text-[9px] text-white/32 sm:text-[10px]">Team {manager.slot}</p>
                ) : null}

                {showClaim ? (
                  <button
                    type="button"
                    onClick={() => onClaimSlot?.(manager.rosterId)}
                    disabled={claiming}
                    data-testid={`draft-manager-claim-${manager.slot}`}
                    aria-label={t('draftRoom.managerStrip.aria.claim')}
                    className="mt-1 w-full rounded border border-cyan-400/35 bg-cyan-500/14 px-1 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-cyan-100 transition hover:bg-cyan-500/22 disabled:opacity-50"
                  >
                    {claiming ? t('draftRoom.managerStrip.claiming') : t('draftRoom.managerStrip.claim')}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
