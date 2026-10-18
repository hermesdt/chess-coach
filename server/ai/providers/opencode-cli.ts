/**
 * opencode CLI adapter. Flags (verified with `opencode run --help`, v1.19.2):
 *   run                 non-interactive; the message is read from stdin when no positional is given
 *   --format json       raw JSON events, one per line:
 *                       { type: "text", part: { type: "text", text } }, { type: "error", error }, ...
 *   --agent plan        built-in primary agent that denies file edits (`opencode agent list`)
 *   -m provider/model   only when a model is set
 * Tools cannot be fully disabled: `plan` can still read files and run restricted commands. The run
 * is confined to a fresh empty temp dir (cwd) that is deleted afterwards.
 * The assistant answer is the concatenation of the `text` events.
 */
import { binaryOnPath, realCliRunner, runCli, withTempDir } from '../cli-runner.js';
import { AiProviderError, type AiProvider, type CliRunner } from '../types.js';

interface OpencodeEvent {
  type?: string;
  part?: { type?: string; messageID?: string; text?: unknown };
  error?: { name?: string; message?: string; data?: { message?: string } };
}

export function createOpencodeCli(run: CliRunner = realCliRunner, onPath: (bin: string) => Promise<boolean> = binaryOnPath): AiProvider {
  return {
    id: 'opencode-cli',
    label: 'opencode CLI',
    async available() {
      return (await onPath('opencode')) ? { ok: true } : { ok: false, reason: 'The opencode command was not found on PATH.' };
    },
    async complete(req, opts) {
      const args = ['run', '--format', 'json', '--agent', 'plan'];
      if (opts.model) args.push('-m', opts.model);
      const stdout = await withTempDir((cwd) => runCli(run, 'opencode', 'opencode', args, `${req.system}\n\n${req.user}`, cwd, { signal: opts.signal }));
      const texts: { messageID: string | undefined; text: string }[] = [];
      for (const line of stdout.split('\n')) {
        let event: OpencodeEvent;
        try {
          const v: unknown = JSON.parse(line);
          if (v === null || typeof v !== 'object' || Array.isArray(v)) continue;
          event = v as OpencodeEvent;
        } catch {
          continue;
        }
        if (event.type === 'error') {
          const msg = event.error?.data?.message ?? event.error?.message ?? event.error?.name ?? 'unknown error';
          throw new AiProviderError(`opencode reported an error: ${msg.slice(0, 500)}`);
        }
        if (event.type === 'text' && event.part?.type === 'text' && typeof event.part.text === 'string') {
          texts.push({ messageID: event.part.messageID, text: event.part.text });
        }
      }
      // Only the final assistant message; earlier steps are intermediate narration.
      const last = texts.at(-1)?.messageID;
      const text = texts.filter((t) => t.messageID === last).map((t) => t.text).join('');
      if (!text.trim()) throw new AiProviderError('opencode returned no text.');
      return { text, model: opts.model ?? 'default' };
    },
  };
}
