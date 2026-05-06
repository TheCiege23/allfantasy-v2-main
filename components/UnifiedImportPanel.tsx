import React, { useEffect, useState } from 'react';
import { ImportSourceInputPanel } from './league-creation/ImportSourceInputPanel';
import { ImportProvider } from '@/lib/league-import/types';
import { getImportProviderLabel, isImportProviderAvailable } from '@/lib/league-import/provider-ui-config';

interface UnifiedImportPanelProps {
  providers: ImportProvider[];
  onImport: (provider: ImportProvider, sourceInput: string) => Promise<void>;
  loadingProvider?: ImportProvider | null;
  disabledProviders?: ImportProvider[];
}

export function UnifiedImportPanel({
  providers,
  onImport,
  loadingProvider = null,
  disabledProviders = [],
  initialInputs,
}: UnifiedImportPanelProps) {
  const [inputs, setInputs] = useState<Record<ImportProvider, string>>({} as Record<ImportProvider, string>);
  const [errors, setErrors] = useState<Record<ImportProvider, string | null>>({} as Record<ImportProvider, string | null>);

  useEffect(() => {
    if (!initialInputs) return
    setInputs((prev) => {
      const next = { ...prev }
      for (const [k, v] of Object.entries(initialInputs)) {
        if (typeof v === 'string' && v.trim()) {
          next[k as ImportProvider] = v
        }
      }
      return next
    })
  }, [initialInputs])

  return (
    <div className="space-y-8">
      {providers.map((provider) => {
        const available = isImportProviderAvailable(provider);
        return (
          <div key={provider} className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-white text-base">{getImportProviderLabel(provider)}</span>
            </div>
            <ImportSourceInputPanel
              provider={provider}
              sourceInput={inputs[provider] || ''}
              onSourceInputChange={(val) => setInputs((prev) => ({ ...prev, [provider]: val }))}
              onFetchPreview={async () => {
                setErrors((prev) => ({ ...prev, [provider]: null }));
                try {
                  await onImport(provider, inputs[provider] || '');
                } catch (e: any) {
                  setErrors((prev) => ({ ...prev, [provider]: e.message || 'Import failed' }));
                }
              }}
              loading={loadingProvider === provider}
              disabled={disabledProviders.includes(provider) || !available}
            />
            {errors[provider] && <div className="text-xs text-red-400 mt-1">{errors[provider]}</div>}
          </div>
        );
      })}
    </div>
  );
}
