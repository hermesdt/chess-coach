/**
 * claude CLI adapter. Flags (verified with `claude --help`, v2.1.300):
 *   -p / --print                 non-interactive; prompt read from stdin
 *   --output-format json         one JSON result object: { is_error, result, ... }
 *   --model <m>                  only when a model is set
 *   --tools ""                   disables all built-in tools
 *   --disable-slash-commands     disables skills
 *   --no-session-persistence     nothing saved to disk
 *   --strict-mcp-config          no --mcp-config is given, so no MCP server loads
 *   --setting-sources ""          no user/project/local settings, hooks or CLAUDE.md
 * Not used: --bare. It skips OAuth and keychain, so it would break subscription logins.
 *   --json-schema <schema>       structured output; `result` still holds the JSON text
 */
import { binaryOnPath, cliPrompt, envWithout, realCliRunner, runCli, withTempDir } from '../cli-runner.js';
import { schemaJsonText } from '../json-schema.js';
import { AiParseError, AiProviderError, type AiProvider, type CliRunner } from '../types.js';

type ClaudeResult = { is_error?: boolean; result?: unknown };

const asObject = (text: string): ClaudeResult | null => {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as ClaudeResult) : null;
  } catch {
    return null;
  }
};

/** The whole output, or else the last line that parses as an object. */
function parseResultObject(stdout: string): ClaudeResult | null {
  const whole = asObject(stdout);
  if (whole) return whole;
  for (const line of stdout.split('\n').reverse()) {
    const obj = asObject(line);
    if (obj) return obj;
  }
  return null;
}

export function createClaudeCli(run: CliRunner = realCliRunner, onPath: (bin: string) => Promise<boolean> = binaryOnPath): AiProvider {
  return {
    id: 'claude-cli',
    label: 'Claude Code CLI',
    async available() {
      return (await onPath('claude')) ? { ok: true } : { ok: false, reason: 'The claude command was not found on PATH.' };
    },
    async complete(req, opts) {
      const args = ['-p', '--output-format', 'json', '--tools', '', '--disable-slash-commands', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '', '--json-schema', schemaJsonText(req.jsonSchema)];
      if (opts.model) args.push('--model', opts.model);
      const stdout = await withTempDir((cwd) => runCli(run, 'claude', 'claude', args, cliPrompt(req), cwd, { env: envWithout('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'), signal: opts.signal }));
      const parsed = parseResultObject(stdout);
      if (!parsed) throw new AiParseError('claude printed output that is not JSON.');
      if (parsed.is_error) throw new AiProviderError(`claude reported an error: ${String(parsed.result).slice(0, 500)}`);
      if (typeof parsed.result !== 'string') throw new AiProviderError('claude returned no result text.');
      return { text: parsed.result, model: opts.model ?? 'default' };
    },
  };
}
