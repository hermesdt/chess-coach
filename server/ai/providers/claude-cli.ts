/**
 * claude CLI adapter. Flags (verified with `claude --help`, v2.1.300):
 *   -p / --print                 non-interactive; prompt read from stdin
 *   --output-format json         one JSON result object: { is_error, result, ... }
 *   --model <m>                  only when a model is set
 *   --tools ""                   disables all built-in tools
 *   --disable-slash-commands     disables skills
 *   --no-session-persistence     nothing saved to disk
 *   --json-schema <schema>       structured output; `result` still holds the JSON text
 */
import { binaryOnPath, realCliRunner, runCli, withTempDir } from '../cli-runner.js';
import { AiParseError, AiProviderError, type AiProvider, type CliRunner } from '../types.js';

export function createClaudeCli(run: CliRunner = realCliRunner, onPath: (bin: string) => Promise<boolean> = binaryOnPath): AiProvider {
  return {
    id: 'claude-cli',
    label: 'Claude Code CLI',
    async available() {
      return (await onPath('claude')) ? { ok: true } : { ok: false, reason: 'The claude command was not found on PATH.' };
    },
    async complete(req, opts) {
      const args = ['-p', '--output-format', 'json', '--tools', '', '--disable-slash-commands', '--no-session-persistence', '--json-schema', JSON.stringify(req.jsonSchema)];
      if (opts.model) args.push('--model', opts.model);
      const stdout = await withTempDir((cwd) => runCli(run, 'claude', 'claude', args, `${req.system}\n\n${req.user}`, cwd));
      let parsed: { is_error?: boolean; result?: unknown };
      try {
        parsed = JSON.parse(stdout) as typeof parsed;
      } catch {
        throw new AiParseError('claude printed output that is not JSON.');
      }
      if (parsed.is_error) throw new AiProviderError(`claude reported an error: ${String(parsed.result).slice(0, 500)}`);
      if (typeof parsed.result !== 'string') throw new AiProviderError('claude returned no result text.');
      return { text: parsed.result, model: opts.model ?? 'default' };
    },
  };
}
