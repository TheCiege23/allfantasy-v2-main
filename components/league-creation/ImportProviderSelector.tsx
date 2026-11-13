'use client';

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { IMPORT_PROVIDER_UI_OPTIONS } from '@/lib/league-import/provider-ui-config';
import type { ImportProvider } from '@/lib/league-import/types';

interface ImportProviderSelectorProps {
  value: ImportProvider | null;
  onChange: (provider: ImportProvider | null) => void;
  disabled?: boolean;
}

export function ImportProviderSelector({
  value,
  onChange,
  disabled,
}: ImportProviderSelectorProps) {
  return (
    <div className="space-y-2">
      <Label className="text-cyan-300">Import from</Label>
      <Select
        value={value ?? ''}
        onValueChange={(v) => onChange((v || null) as ImportProvider | null)}
        disabled={disabled}
      >
        <SelectTrigger
          className="min-h-[50px] rounded-xl border-cyan-400/35 bg-[#030a20] text-white"
          aria-label="Import provider"
        >
          <SelectValue placeholder="Select platform" />
        </SelectTrigger>
        <SelectContent>
          {IMPORT_PROVIDER_UI_OPTIONS.map((opt) => (
            <SelectItem
              key={opt.provider}
              value={opt.provider}
              disabled={!opt.available}
            >
              {opt.label}
              {!opt.available && ' (coming soon)'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
