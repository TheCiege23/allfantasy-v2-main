'use client';

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type CreationMode = 'create' | 'import';

export interface LeagueCreationModeSelectorProps {
  value: CreationMode;
  onChange: (mode: CreationMode) => void;
  disabled?: boolean;
}

export function LeagueCreationModeSelector({
  value,
  onChange,
  disabled,
}: LeagueCreationModeSelectorProps) {
  return (
    <div className="space-y-3 rounded-2xl border border-cyan-400/25 bg-[#07122d]/80 p-4">
      <div className="space-y-1">
        <p className="text-xl font-bold text-white">League setup path</p>
        <p className="text-sm text-white/65">Start from scratch or import your existing structure.</p>
      </div>
      <div className="space-y-3">
        <p className="text-sm font-semibold text-white">Start from scratch</p>
        <button
          type="button"
          onClick={() => onChange('create')}
          disabled={disabled}
          className={`w-full rounded-2xl border p-4 text-left transition ${
            value === 'create'
              ? 'border-cyan-300 bg-cyan-400/10'
              : 'border-white/15 bg-black/20 hover:bg-white/10'
          }`}
        >
          <p className="text-2xl font-black text-white">Create New League</p>
          <p className="text-sm text-white/65">Pick your own settings</p>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-white/15" />
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">or</span>
        <span className="h-px flex-1 bg-white/15" />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-white">Copy existing league</p>
        <button
          type="button"
          onClick={() => onChange('import')}
          disabled={disabled}
          className={`w-full rounded-2xl border p-4 text-left transition ${
            value === 'import'
              ? 'border-cyan-300 bg-cyan-400/10'
              : 'border-white/15 bg-black/20 hover:bg-white/10'
          }`}
        >
          <p className="text-xl font-black text-white">Import Existing League</p>
          <p className="text-sm text-white/65">Choose from the supported providers shown in the next step</p>
        </button>
      </div>
      <Label className="text-cyan-300">League creation</Label>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as CreationMode)}
        disabled={disabled}
      >
        <SelectTrigger
          className="min-h-[50px] rounded-xl border-cyan-400/35 bg-[#030a20] text-white"
          aria-label="League creation mode"
          data-testid="league-creation-mode-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="create">Build New League - set sport, scoring, size, and options manually</SelectItem>
          <SelectItem value="import">Import Existing League - choose a supported provider</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
