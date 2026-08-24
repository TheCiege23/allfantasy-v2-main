"use client"

import { MessageSquare, Repeat, Star, Table2 } from "lucide-react"
import {
  EmptyStateGrid,
  EmptyStateRenderer,
  ErrorStateRenderer,
  LoadingStateRenderer,
  SkeletonRowsRenderer,
  StaleDataNotice,
} from "@/components/ui-states"

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <p className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#8b93b8]">
        {label}
      </p>
      {children}
    </section>
  )
}

export function StatesPreviewClient() {
  return (
    <main className="min-h-screen bg-[#06070f] px-5 py-10 text-[#eef0fa]">
      <div className="mx-auto w-full max-w-[760px]">
        <h1 className="mb-1 text-2xl font-black">16c — empty, loading and error states</h1>
        <p className="mb-9 text-sm text-[#7d84a8]">
          Dev-only preview. Every variant of the shared state vocabulary, with synthetic data.
        </p>

        <Group label="Empty · full">
          <EmptyStateRenderer
            variant="full"
            icon={<Table2 className="h-5 w-5" />}
            title="No leagues yet"
            description={
              "Import a league from Sleeper, ESPN or Yahoo, or start one here.\nEverything else on this screen fills in from your real rosters."
            }
            actions={[
              { id: "import", label: "Import a league", href: "/import", variant: "primary" },
              { id: "create", label: "Create a league", href: "/create-league" },
            ]}
          />
        </Group>

        <Group label="Empty · compact, inside a panel">
          <EmptyStateRenderer
            icon={<Repeat className="h-5 w-5" />}
            title="No trades in this league yet"
            description="When someone sends an offer, it shows up here with a grade."
          />
        </Group>

        <Group label="Empty · small paired">
          <EmptyStateGrid>
            <EmptyStateRenderer
              variant="compact"
              icon={<MessageSquare className="h-4 w-4" />}
              title="Nobody's said anything yet"
              description="Be the one who starts it."
            />
            <EmptyStateRenderer
              variant="compact"
              icon={<Star className="h-4 w-4" />}
              title="No career history yet"
              description="Import past seasons to backfill it."
            />
          </EmptyStateGrid>
        </Group>

        <Group label="Loading">
          <LoadingStateRenderer label="Loading your settings…" />
        </Group>

        <Group label="Loading · skeleton, when shape is known">
          <SkeletonRowsRenderer rows={3} label="Loading leagues…" />
        </Group>

        <Group label="Loading · slow">
          <LoadingStateRenderer
            slow
            label="Still pulling your Sleeper leagues…"
            reason="This one has 14 seasons of history. About 20 more seconds."
          />
        </Group>

        <Group label="Error · full, with recovery">
          <ErrorStateRenderer
            title="We couldn't load your settings"
            message="Your session may have expired."
            dataSafeNote="Everything you'd saved is safe."
            onRetry={() => window.location.reload()}
            actions={[
              { id: "dash", label: "Back to dashboard", href: "/dashboard" },
              { id: "out", label: "Sign out", href: "/api/auth/logout" },
            ]}
          />
        </Group>

        <Group label="Error · compact, inline above the content">
          <ErrorStateRenderer
            inline
            message="Couldn't save. Your changes are still here — try again."
            onRetry={() => undefined}
            retryLabel="Retry"
          />
        </Group>

        <Group label="Error · stale data, not an outage">
          <StaleDataNotice age="2 hours ago" source="ESPN didn't respond." onResync={() => undefined} />
        </Group>

        <p className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4 text-sm leading-relaxed text-[#989fc2]">
          <span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#8b93b8]">
            The rule
          </span>
          Every state says what happened, whether your data is safe, and what to press. No blank
          screens, no spinners that never end, and no error that only says &ldquo;something went
          wrong&rdquo; when we know more than that.
        </p>
      </div>
    </main>
  )
}
