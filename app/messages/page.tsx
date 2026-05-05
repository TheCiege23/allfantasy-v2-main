"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"
import MessagesContent from "./MessagesContent"

export default function MessagesPage() {
  const { status } = useSession()
  const isAuthenticated = status === "authenticated"

  return (
    <main
      className={`mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6 mode-readable ${
        isAuthenticated ? "pb-24 lg:pb-6" : ""
      }`}
    >
      <section className="mode-panel rounded-2xl p-5">
        <h1 className="text-2xl font-semibold mode-text">Messages</h1>
        <p className="mt-1 text-sm mode-muted">
          Unified inbox for DMs, group chats, and AI chat.
        </p>
      </section>

      {!isAuthenticated ? (
        <section className="mode-panel rounded-2xl p-8 text-center">
          <h2 className="text-xl font-semibold mode-text">Sign in to open your inbox</h2>
          <p className="mt-2 text-sm mode-muted">
            Account login is required for private and league chat history.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Link href="/login?next=/messages" className="rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              Sign In
            </Link>
            <Link href="/signup?next=/messages" className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}>
              Sign Up
            </Link>
          </div>
        </section>
      ) : (
        <MessagesContent />
      )}
    </main>
  )
}
