import { PROVIDER_IDS, type ProviderId } from '../../shared/types.js';

export { PROVIDER_IDS };
export type { ProviderId };
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
  opts: { stdin?: string; timeoutMs: number; cwd: string },
) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>;

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
export class AiTimeoutError extends Error {
  override name = 'AiTimeoutError';
}
export class AiProviderError extends Error {
  override name = 'AiProviderError';
}
export class AiRefusalError extends Error {
  override name = 'AiRefusalError';
}
