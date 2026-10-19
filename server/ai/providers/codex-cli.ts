/**
 * codex CLI adapter. Flags (verified with `codex exec --help`, v0.163.0; run with a
 * `timeout` wrapper and `</dev/null` it prints help on stdout):
 *   exec                        non-interactive
 *   -                           read the prompt from stdin
 *   --skip-git-repo-check       cwd is a temp dir, not a git repo
 *   --ephemeral                 do not persist session files
 *   -s read-only                read-only sandbox
 *   --json                      JSON events on stdout, one per line. The answer is the `text` of the last
 *                               `item.completed` event with `item.type === "agent_message"`. Whole items only,
 *                               no text deltas, so this adapter has no `stream`. Failures: `error` and `turn.failed`.
 *   --output-schema <FILE>      JSON Schema of the final answer
 *   -m <MODEL>                  only when a model is set
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { binaryOnPath, cliPrompt, envWithout, realCliRunner, runCli, withTempDir } from '../cli-runner.js';
import { schemaJsonText } from '../json-schema.js';
import { AiProviderError, type AiProvider, type CliRunner } from '../types.js';

const failure = (e: { message?: unknown; error?: { message?: unknown } }): string => {
  const m = e.error?.message ?? e.message;
  return typeof m === 'string' && m ? m : 'unknown error';
};

/** The text of the last agent_message. An `error` event counts only when no message follows it. */
function finalMessage(stdout: string): string {
  let text = '';
  let lastError: string | null = null;
  for (const line of stdout.split('\n')) {
    let event: { type?: string; message?: unknown; error?: { message?: unknown }; item?: { type?: string; text?: unknown } };
    try {
      const v: unknown = JSON.parse(line);
      if (v === null || typeof v !== 'object' || Array.isArray(v)) continue;
      event = v as typeof event;
    } catch {
      continue;
    }
    if (event.type === 'turn.failed') throw new AiProviderError(`codex reported an error: ${failure(event).slice(0, 500)}`);
    if (event.type === 'error') lastError = failure(event);
    else if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
      text = event.item.text;
      lastError = null;
    }
  }
  if (lastError !== null) throw new AiProviderError(`codex reported an error: ${lastError.slice(0, 500)}`);
  if (!text.trim()) throw new AiProviderError('codex wrote no final message.');
  return text;
}

export function createCodexCli(run: CliRunner = realCliRunner, onPath: (bin: string) => Promise<boolean> = binaryOnPath): AiProvider {
  return {
    id: 'codex-cli',
    label: 'Codex CLI',
    async available() {
      return (await onPath('codex')) ? { ok: true } : { ok: false, reason: 'The codex command was not found on PATH.' };
    },
    async complete(req, opts) {
      const stdout = await withTempDir(async (cwd) => {
        const schemaFile = join(cwd, 'schema.json');
        await writeFile(schemaFile, schemaJsonText(req.jsonSchema));
        const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '--output-schema', schemaFile];
        if (opts.model) args.push('-m', opts.model);
        args.push('-');
        return runCli(run, 'codex', 'codex', args, cliPrompt(req), cwd, { env: envWithout('OPENAI_API_KEY'), signal: opts.signal });
      });
      return { text: finalMessage(stdout), model: opts.model ?? 'default' };
    },
  };
}
