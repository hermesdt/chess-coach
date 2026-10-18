import type { AiProviderSetting, ProviderId } from '../../../shared/types';
import type { ProviderInfo } from '../api';

/** The provider that runs when the user does not pick one: the setting itself, or the first available for `auto`. */
export function defaultProviderId(providers: ProviderInfo[], setting: AiProviderSetting): ProviderId | null {
  if (setting === 'none') return null;
  if (setting !== 'auto') return providers.find((p) => p.id === setting && p.ok)?.id ?? null;
  return providers.find((p) => p.ok)?.id ?? null;
}

interface Props {
  providers: ProviderInfo[];
  defaultSetting: AiProviderSetting;
  value: ProviderId | '';
  onChange: (id: ProviderId) => void;
  label?: string;
}

/** A select with the available providers only. The default one is marked. */
export function ProviderSelect({ providers, defaultSetting, value, onChange, label = 'Provider' }: Props) {
  const available = providers.filter((p) => p.ok);
  const def = defaultProviderId(providers, defaultSetting);
  return (
    <select
      aria-label={label}
      value={value || def || ''}
      disabled={available.length === 0}
      onChange={(e) => onChange(e.target.value as ProviderId)}
    >
      {available.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}{p.id === def ? ' (default)' : ''}
        </option>
      ))}
    </select>
  );
}
