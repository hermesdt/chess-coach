import type { ProviderId } from '../../shared/types.js';

export type { ProviderId };
export const PROVIDER_IDS: readonly ProviderId[] = ['claude-cli', 'codex-cli', 'anthropic-api', 'openrouter', 'opencode-cli'];
/** Order used by `auto`. */
export const AUTO_ORDER = PROVIDER_IDS;

export interface AiRequest { system: string; user: string; schemaName: string; jsonSchema: object }
export interface AiProvider {
  id: ProviderId;
  label: string;
  available(): Promise<{ ok: boolean; reason?: string }>;
  complete(req: AiRequest, opts: { model: string | null; signal?: AbortSignal }): Promise<{ text: string; model: string }>;
}

/** Runs a CLI without a shell. Injected so tests never spawn real processes. */
export type CliRunner = (
  cmd: string,
  args: string[],
  opts: { input?: string; cwd?: string; timeoutMs?: number; signal?: AbortSignal },
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

export class AiParseError extends Error {
  override name = 'AiParseError';
}
export class AiValidationError extends Error {
  override name = 'AiValidationError';
}
export class AiGroundingError extends Error {
  override name = 'AiGroundingError';
  constructor(public readonly moves: string[]) {
    super(`The coach answer mentioned moves I could not verify: ${moves.join(', ')}`);
  }
}
