/**
 * codex CLI adapter. Flags (verified with `codex exec --help`, v0.163.0; run with a
 * `timeout` wrapper and `</dev/null` it prints help on stdout):
 *   exec                        non-interactive
 *   -                           read the prompt from stdin
 *   --skip-git-repo-check       cwd is a temp dir, not a git repo
 *   --ephemeral                 do not persist session files
 *   -s read-only                read-only sandbox
 *   --output-schema <FILE>      JSON Schema of the final answer
 *   -o <FILE>                   write the last agent message to FILE (we read this file)
 *   -m <MODEL>                  only when a model is set
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { binaryOnPath, envWithout, realCliRunner, runCli, withTempDir } from '../cli-runner.js';
import { schemaJsonText } from '../json-schema.js';
import { AiProviderError, type AiProvider, type CliRunner } from '../types.js';

export function createCodexCli(run: CliRunner = realCliRunner, onPath: (bin: string) => Promise<boolean> = binaryOnPath): AiProvider {
  return {
    id: 'codex-cli',
    label: 'Codex CLI',
    async available() {
      return (await onPath('codex')) ? { ok: true } : { ok: false, reason: 'The codex command was not found on PATH.' };
    },
    async complete(req, opts) {
      const text = await withTempDir(async (cwd) => {
        const schemaFile = join(cwd, 'schema.json');
        const outFile = join(cwd, 'last-message.txt');
        await writeFile(schemaFile, schemaJsonText(req.jsonSchema));
        const args = ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '--output-schema', schemaFile, '-o', outFile];
        if (opts.model) args.push('-m', opts.model);
        args.push('-');
        await runCli(run, 'codex', 'codex', args, `${req.system}\n\n${req.user}`, cwd, { env: envWithout('OPENAI_API_KEY'), signal: opts.signal });
        return readFile(outFile, 'utf8').catch(() => '');
      });
      if (!text.trim()) throw new AiProviderError('codex wrote no final message.');
      return { text, model: opts.model ?? 'default' };
    },
  };
}
