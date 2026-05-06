import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Metadata } from 'next';
import LegacyImportForm from '@/components/LegacyImportForm';
import { LeagueImportFlow } from '@/components/unified-import-ui/LeagueImportFlow';

export const metadata: Metadata = {
  title: 'Import Legacy League – AllFantasy',
  description: 'Bring in your historical Sleeper or ESPN leagues for dynasty analysis',
};

export default async function LegacyImportPage() {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string };
  } | null;

  if (!session?.user?.id) {
    redirect('/login?callbackUrl=/legacy-import');
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0a0f] to-[#0f0f1a] py-12 md:py-16">
      <LeagueImportFlow
        userId={session.user.id}
        returnTo="/af-legacy"
        defaultProvider="sleeper"
        mode="full"
        showBackButton
        showSupportButton
      />

      <div className="container mx-auto mt-16 max-w-3xl px-4 pb-24">
        <details className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-white/70">
            Advanced: multi-season legacy import (original tool)
          </summary>
          <p className="mt-3 text-[13px] text-white/45">
            Season-by-season Sleeper/ESPN pulls for dynasty historians. Prefer the unified import above for career rank & dashboard sync.
          </p>
          <div className="mt-6">
            <LegacyImportForm userId={session.user.id} />
          </div>
        </details>
      </div>
    </div>
  );
}
