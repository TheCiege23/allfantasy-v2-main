'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Info } from 'lucide-react';
import Link from 'next/link';
import { getImportProviderLabel, isImportProviderAvailable } from '@/lib/league-import/provider-ui-config';
import type { ImportProvider } from '@/lib/league-import/types';

export interface ImportSourceInputPanelProps {
  provider: ImportProvider | null;
  /** For available providers: league ID or provider-specific source input. */
  sourceInput: string;
  onSourceInputChange: (value: string) => void;
  onFetchPreview: () => void;
  loading: boolean;
  disabled?: boolean;
}

const PROVIDER_INPUT_CONFIG: Record<
  string,
  { label: string; placeholder: string; help?: string }
> = {
  sleeper: {
    label: 'Sleeper League ID',
    placeholder: 'e.g. 123456789',
    help: 'Find this in your Sleeper league URL or league settings.',
  },
  espn: {
    label: 'ESPN League ID',
    placeholder: 'e.g. 12345678, 2025:12345678, or a full ESPN league URL',
    help: 'Paste an ESPN league ID or full league URL. Public leagues work directly; private leagues need SWID and espn_s2 cookies saved first — connect ESPN in Settings → Connected Accounts.',
  },
  yahoo: {
    label: 'Yahoo League Key',
    placeholder: 'e.g. 461.l.12345 or 12345',
    help: 'Connect Yahoo in League Sync first, then paste the full Yahoo league key or numeric league ID.',
  },
  fantrax: {
    label: 'Fantrax Source',
    placeholder: 'e.g. id:<legacy-uuid> or username|2025|League Name',
    help: 'Import uses Fantrax legacy league snapshots. Provide the legacy Fantrax league UUID or username with optional season/league name.',
  },
  mfl: {
    label: 'MFL League ID',
    placeholder: 'e.g. 12345, 2026:12345, or a full MFL league URL',
    help: 'Save your MFL API key in League Sync first, then paste your MFL league ID, season-prefixed ID, or full league URL.',
  },
};

export function ImportSourceInputPanel({
  provider,
  sourceInput,
  onSourceInputChange,
  onFetchPreview,
  loading,
  disabled,
}: ImportSourceInputPanelProps) {
  if (!provider) return null;

  const available = isImportProviderAvailable(provider);
  const config = PROVIDER_INPUT_CONFIG[provider] ?? {
    label: `${getImportProviderLabel(provider)} ID`,
    placeholder: 'Enter league or connection ID',
  };

  if (!available) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3 flex items-start gap-2">
        <Info className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
        <div className="text-sm text-white/90">
          <p className="font-medium text-amber-200">Import from {getImportProviderLabel(provider)} is coming soon</p>
          <p className="mt-1 text-white/60">We&apos;re working on it. Use one of the available providers for now, or build a new league manually.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-cyan-300" htmlFor="import-source-input">{config.label}</Label>
      <div className="flex gap-2">
        <Input
          id="import-source-input"
          placeholder={config.placeholder}
          value={sourceInput}
          onChange={(e) => onSourceInputChange(e.target.value)}
          disabled={loading || disabled}
          className="flex-1 border-cyan-400/35 bg-[#030a20]"
        />
        <Button
          type="button"
          onClick={onFetchPreview}
          disabled={loading || !sourceInput.trim() || disabled}
          variant="outline"
          className="shrink-0 border-cyan-300/40 text-cyan-200 hover:bg-cyan-300/10"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Fetch & Preview'}
        </Button>
      </div>
      {config.help && (
        <p className="text-xs text-white/50">{config.help}</p>
      )}
      {provider === 'espn' && (
        <div className="mt-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
            <div className="text-xs text-white/70">
              <p className="font-medium text-white/85">
                Private ESPN league? Connect it once on desktop.
              </p>
              <p className="mt-1 text-white/50">
                ESPN has no public login for fantasy, so private leagues need two
                browser cookies. Grab them from a desktop browser:
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-white/60">
                <li>
                  Go to{' '}
                  <code className="rounded bg-white/10 px-1 py-0.5 text-cyan-200">fantasy.espn.com</code>{' '}
                  and make sure you&apos;re signed in.
                </li>
                <li>Open your browser&apos;s dev tools (F12, or right-click → Inspect).</li>
                <li>
                  Go to the <span className="text-white/80">Application</span> tab →{' '}
                  <span className="text-white/80">Cookies</span> →{' '}
                  <code className="rounded bg-white/10 px-1 py-0.5 text-cyan-200">https://fantasy.espn.com</code>.
                </li>
                <li>
                  Find the{' '}
                  <code className="rounded bg-white/10 px-1 py-0.5 text-cyan-200">SWID</code> and{' '}
                  <code className="rounded bg-white/10 px-1 py-0.5 text-cyan-200">espn_s2</code>{' '}
                  values and copy them.
                </li>
                <li>
                  Paste them into{' '}
                  <Link
                    href="/settings?tab=connected"
                    className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
                  >
                    Settings → Connected Accounts → ESPN
                  </Link>
                  , then come back and import.
                </li>
              </ol>
              {/* Exact reuse of the mobile note from components/settings/EspnCookieConnection.tsx — keep the two in sync. */}
              <p className="mt-2 text-[11px] text-white/40">
                On mobile? Connect ESPN once on a desktop browser — it stays saved on
                your account after that.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
