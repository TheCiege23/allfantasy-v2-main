"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { signOutAndPurge } from "@/lib/pwa/signOutAndPurge"
import { X, User, Settings, Users, Shield, Bell, Bot, Slash } from "lucide-react"
import { useSettingsProfile } from "@/hooks/useSettingsProfile"
import { IdentityImageRenderer } from "@/components/identity/IdentityImageRenderer"

type TabId =
  | "profile"
  | "account"
  | "friends"
  | "privacy"
  | "notifications"
  | "ai"
  | "blocked"

const TABS: { id: TabId; label: string; icon: React.ComponentType<any> }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "account", label: "Account", icon: Settings },
  { id: "friends", label: "Friends", icon: Users },
  { id: "privacy", label: "Privacy", icon: Shield },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "ai", label: "AI Settings", icon: Bot },
  { id: "blocked", label: "Blocked Users", icon: Slash },
]

export interface SettingsModalProps {
  open: boolean
  onClose: () => void
  username?: string | null
}

export default function SettingsModal({ open, onClose, username }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>("profile")
  const { profile, loading, saving, updateProfile } = useSettingsProfile()
  const displayName = profile?.displayName ?? username ?? ""

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-3"
      style={{ background: "var(--overlay)" }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border shadow-xl max-h-[90vh]"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel) 92%, transparent)" }}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Settings
            </h2>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Manage your AllFantasy profile, account, privacy, and AI preferences.{" "}
              <Link href="/settings" className="underline" onClick={onClose}>Full settings →</Link>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border text-xs"
            style={{
              borderColor: "var(--border)",
              background: "color-mix(in srgb, var(--panel2) 88%, transparent)",
              color: "var(--muted)",
            }}
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-1 flex-col md:flex-row">
          {/* Tabs */}
          <nav className="border-b md:border-b-0 md:border-r md:min-w-[190px]" style={{ borderColor: "var(--border)" }}>
            <ul className="flex md:flex-col overflow-x-auto text-xs">
              {TABS.map((tab) => {
                const Icon = tab.icon
                const active = activeTab === tab.id
                return (
                  <li key={tab.id}>
                    <button
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left whitespace-nowrap"
                      style={{
                        color: active ? "var(--text)" : "var(--muted2)",
                        background: active ? "color-mix(in srgb, var(--panel2) 84%, transparent)" : "transparent",
                      }}
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg border text-[11px]" style={{ borderColor: "var(--border)" }}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="font-medium tracking-tight">{tab.label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>

          {/* Content */}
          <section className="flex-1 overflow-y-auto px-4 py-4 text-xs md:px-6 md:py-5 space-y-4">
            {activeTab === "profile" && (
              <ProfileSettings
                profile={profile}
                displayName={displayName}
                loading={loading}
                saving={saving}
                onSave={updateProfile}
                onClose={onClose}
              />
            )}
            {activeTab === "account" && <AccountSettings profile={profile} onClose={onClose} />}
            {activeTab === "friends" && <FriendsSettings onClose={onClose} />}
            {activeTab === "privacy" && <PrivacySettings onClose={onClose} />}
            {activeTab === "notifications" && <NotificationSettings onClose={onClose} />}
            {activeTab === "ai" && <AiSettings onClose={onClose} />}
            {activeTab === "blocked" && <BlockedUsersSettings />}
          </section>
        </div>
      </div>
    </div>
  )
}

function ProfileSettings({
  profile,
  displayName: initialDisplayName,
  loading,
  saving,
  onSave,
  onClose,
}: {
  profile: ReturnType<typeof useSettingsProfile>["profile"]
  displayName: string
  loading: boolean
  saving: boolean
  onSave: (p: import("@/lib/user-settings").ProfileUpdatePayload) => Promise<boolean>
  onClose: () => void
}) {
  const [displayName, setDisplayName] = useState(initialDisplayName)
  useEffect(() => {
    setDisplayName(initialDisplayName)
  }, [initialDisplayName])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const ok = await onSave({ displayName: displayName.trim() || null })
    if (ok) onClose()
  }

  if (loading) {
    return <p className="text-[11px]" style={{ color: "var(--muted)" }}>Loading…</p>
  }

  const username = profile?.username ?? ""

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div>
        <h3 className="text-sm font-semibold mb-1.5" style={{ color: "var(--text)" }}>
          Profile
        </h3>
        <p className="text-[11px]" style={{ color: "var(--muted)" }}>
          Update how you appear across AllFantasy products. Username is read-only.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <IdentityImageRenderer
          avatarUrl={profile?.profileImageUrl}
          avatarPreset={profile?.avatarPreset}
          displayName={displayName}
          username={username}
          size="md"
        />
        <div className="space-y-1 text-[11px]">
          <div style={{ color: "var(--text)" }}>{username || "Your username"}</div>
          <Link href="/settings" onClick={onClose} className="inline-flex items-center rounded-lg border px-2 py-1" style={{ borderColor: "var(--border)", color: "var(--muted2)", background: "color-mix(in srgb, var(--panel2) 84%, transparent)" }}>
            Change avatar (full settings)
          </Link>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[11px]" style={{ color: "var(--muted2)" }}>
          Display name
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded-xl border px-3 py-2 text-xs outline-none"
          style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
          placeholder="Your display name"
        />
      </div>

      <div className="pt-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center rounded-xl px-4 py-2 text-xs font-semibold"
          style={{
            background: "linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))",
            color: "var(--on-accent-bg)",
          }}
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  )
}

function AccountSettings({
  profile,
  onClose,
}: {
  profile: ReturnType<typeof useSettingsProfile>["profile"]
  onClose: () => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-1.5" style={{ color: "var(--text)" }}>
          Account
        </h3>
        <p className="text-[11px]" style={{ color: "var(--muted)" }}>
          Email and phone are managed via verification. Password change uses a secure flow.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11px]" style={{ color: "var(--muted2)" }}>
            Email
          </label>
          <p className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}>
            {profile?.email ?? "—"}
          </p>
        </div>
        <div>
          <label className="mb-1 block text-[11px]" style={{ color: "var(--muted2)" }}>
            Phone
          </label>
          <p className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}>
            {profile?.phone ? (profile.phoneVerifiedAt ? "Verified" : profile.phone) : "Not set"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Link
          href="/verify?returnTo=%2Fsettings%3Ftab%3Dsecurity"
          onClick={onClose}
          className="inline-flex rounded-xl border px-4 py-2 text-xs font-semibold"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          Verify / change email or phone
        </Link>
        <Link
          href="/forgot-password"
          onClick={onClose}
          className="inline-flex rounded-xl border px-4 py-2 text-xs font-semibold"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          Change password
        </Link>
        <button
          type="button"
          onClick={() => void signOutAndPurge({ callbackUrl: "/" })}
          className="text-[11px] font-medium rounded-xl px-4 py-2 border"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-red) 60%, var(--border))",
            color: "var(--accent-red-strong)",
            background: "color-mix(in srgb, var(--accent-red) 10%, transparent)",
          }}
        >
          Log out
        </button>
      </div>
    </div>
  )
}

function FriendsSettings({ onClose }: { onClose: () => void }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
        Friends
      </h3>
      <p className="text-[11px]" style={{ color: "var(--muted)" }}>
        Manage discoverability and social visibility from the full settings experience.
      </p>
      <Link
        href="/settings?tab=profile"
        onClick={onClose}
        className="inline-flex rounded-xl border px-3 py-2 text-[11px] font-medium"
        style={{ borderColor: "var(--border)", color: "var(--text)" }}
      >
        Open full profile & social settings
      </Link>
    </div>
  )
}

function PrivacySettings({ onClose }: { onClose: () => void }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
        Privacy
      </h3>
      <p className="text-[11px]" style={{ color: "var(--muted)" }}>
        Control how your activity and profile appear across AllFantasy products.
      </p>
      <Link
        href="/settings?tab=legal"
        onClick={onClose}
        className="inline-flex rounded-xl border px-3 py-2 text-[11px] font-medium"
        style={{ borderColor: "var(--border)", color: "var(--text)" }}
      >
        Open legal & privacy controls
      </Link>
    </div>
  )
}

function NotificationSettings({ onClose }: { onClose: () => void }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
        Notifications
      </h3>
      <p className="text-[11px]" style={{ color: "var(--muted)" }}>
        Choose which AllFantasy events can notify you. These settings will apply to both Bracket and the Sports App.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/settings?tab=notifications"
          onClick={onClose}
          className="inline-flex rounded-xl border px-3 py-2 text-[11px] font-medium"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          Open notifications settings
        </Link>
        <Link
          href="/alerts/settings"
          onClick={onClose}
          className="inline-flex rounded-xl border px-3 py-2 text-[11px] font-medium"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          Sports alert preferences
        </Link>
      </div>
    </div>
  )
}

function AiSettings({ onClose }: { onClose: () => void }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
        AI Settings
      </h3>
      <p className="text-[11px]" style={{ color: "var(--muted)" }}>
        Control how AllFantasy&apos;s AI assistant behaves and which providers it can use to personalize your advice.
      </p>
      <Link
        href="/settings?tab=connected"
        onClick={onClose}
        className="inline-flex rounded-xl border px-3 py-2 text-[11px] font-medium"
        style={{ borderColor: "var(--border)", color: "var(--text)" }}
      >
        Manage connected providers
      </Link>
    </div>
  )
}

function BlockedUsersSettings() {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
        Blocked Users
      </h3>
      <p className="text-[11px]" style={{ color: "var(--muted)" }}>
        Manage who you’ve blocked from messaging or challenging you in AllFantasy.
      </p>
      <div className="rounded-xl border px-3 py-4 text-[11px]" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <p className="text-[11px]" style={{ color: "var(--muted2)" }}>
          You haven&apos;t blocked anyone yet. When you block a user, they won&apos;t be able to DM you, invite you to
          private leagues, or see your social activity.
        </p>
      </div>
    </div>
  )
}
