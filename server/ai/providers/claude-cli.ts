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
 * `stream` uses `--output-format stream-json --verbose --include-partial-messages` instead. The CLI adds a hidden
 * `StructuredOutput` tool and the JSON arrives as `input_json_delta` pieces of that tool_use block; the final
 * `result` event carries `structured_output`.
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

const BASE_ARGS = ['--tools', '', '--disable-slash-commands', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', ''];

const parseLine = (line: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(line);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const rec = (v: unknown): Record<string, unknown> | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

/** Collects the StructuredOutput JSON pieces of a stream-json run, line by line, across chunk borders. */
function structuredOutputFeed(onText: (raw: string) => void): (chunk: string) => void {
  let pending = '';
  let raw = '';
  let blockIndex: number | null = null;
  const handle = (line: string): void => {
    const obj = parseLine(line);
    if (obj?.type !== 'stream_event') return;
    const event = rec(obj.event);
    if (!event) return;
    if (event.type === 'content_block_start') {
      const block = rec(event.content_block);
      if (block?.type === 'tool_use' && block.name === 'StructuredOutput' && typeof event.index === 'number') blockIndex = event.index;
    } else if (event.type === 'content_block_delta' && event.index === blockIndex && blockIndex !== null) {
      const delta = rec(event.delta);
      if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string' && delta.partial_json !== '') {
        raw += delta.partial_json;
        onText(raw);
      }
    }
  };
  return (chunk) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) handle(line);
  };
}

export function createClaudeCli(run: CliRunner = realCliRunner, onPath: (bin: string) => Promise<boolean> = binaryOnPath): AiProvider {
  return {
    id: 'claude-cli',
    label: 'Claude Code CLI',
    async available() {
      return (await onPath('claude')) ? { ok: true } : { ok: false, reason: 'The claude command was not found on PATH.' };
    },
    async complete(req, opts) {
      const args = ['-p', '--output-format', 'json', ...BASE_ARGS, '--json-schema', schemaJsonText(req.jsonSchema)];
      if (opts.model) args.push('--model', opts.model);
      const stdout = await withTempDir((cwd) => runCli(run, 'claude', 'claude', args, cliPrompt(req), cwd, { env: envWithout('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'), signal: opts.signal }));
      const parsed = parseResultObject(stdout);
      if (!parsed) throw new AiParseError('claude printed output that is not JSON.');
      if (parsed.is_error) throw new AiProviderError(`claude reported an error: ${String(parsed.result).slice(0, 500)}`);
      if (typeof parsed.result !== 'string') throw new AiProviderError('claude returned no result text.');
      return { text: parsed.result, model: opts.model ?? 'default' };
    },
    async stream(req, opts) {
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', ...BASE_ARGS, '--json-schema', schemaJsonText(req.jsonSchema)];
      if (opts.model) args.push('--model', opts.model);
      const onData = structuredOutputFeed(opts.onText);
      const stdout = await withTempDir((cwd) => runCli(run, 'claude', 'claude', args, cliPrompt(req), cwd, { env: envWithout('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'), signal: opts.signal, onData }));
      let result: Record<string, unknown> | null = null;
      for (const line of stdout.split('\n')) {
        const obj = parseLine(line);
        if (obj?.type === 'result') result = obj;
      }
      if (!result) throw new AiProviderError('claude ended the stream with no result.');
      if (result.is_error) throw new AiProviderError(`claude reported an error: ${String(result.result).slice(0, 500)}`);
      const text = result.structured_output !== undefined && result.structured_output !== null ? JSON.stringify(result.structured_output) : result.result;
      if (typeof text !== 'string' || text === '') throw new AiProviderError('claude returned no result text.');
      return { text, model: opts.model ?? 'default' };
    },
  };
}
