/**
 * MANUAL spike (M8b Task 1). Not a test. It calls the real AI CLIs on the owner's subscriptions.
 * Usage: tsx scripts/spike-chat-speed.ts <claude-cli|codex-cli|opencode-cli> [model|default] [runs] [saveStreamTo]
 * Prompt: the real chat prompt for a fixed, hand-written spike fact pack (timing only).
 * Prints: time to first stdout byte, time to first `answer` character, total time, output tokens (if printed).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FactPack } from '../server/chat/fact-pack.js';
import { CHAT_JSON_SCHEMA } from '../server/ai/chat.js';
import { cliPrompt, envWithout } from '../server/ai/cli-runner.js';
import { schemaJsonText } from '../server/ai/json-schema.js';
import { buildChatPrompt, CHAT_SYSTEM } from '../server/ai/prompts/chat.js';

type Json = Record<string, unknown>;
const provider = process.argv[2] ?? '';
const model = process.argv[3] && process.argv[3] !== 'default' ? process.argv[3] : null;
const runs = Number(process.argv[4] ?? '3');
const savePath = process.argv[5];

const pack = JSON.parse(await readFile(new URL('../docs/superpowers/notes/2026-10-19-chat-speed-spike-factpack.json', import.meta.url), 'utf8')) as FactPack;
const prompt = cliPrompt({
  system: CHAT_SYSTEM,
  user: buildChatPrompt({ pack, question: 'Can I play Bh6 here?', level: 1, rating: 550 }),
  schemaName: 'coach_chat',
  jsonSchema: CHAT_JSON_SCHEMA,
});

/** Text carried by one stream event: a delta (claude) or a whole item (codex, opencode). */
function textOf(provider: string, e: Json): string {
  if (provider === 'claude-cli' && e.type === 'stream_event') {
    const d = (e.event as Json | undefined)?.delta as Json | undefined;
    if (d?.type === 'text_delta') return String(d.text);
    if (d?.type === 'input_json_delta') return String(d.partial_json);
  }
  if (provider === 'codex-cli' && e.type === 'item.completed') {
    const item = e.item as Json | undefined;
    if (item?.type === 'agent_message') return String(item.text);
  }
  if (provider === 'opencode-cli' && e.type === 'text') return String(((e.part as Json | undefined)?.text) ?? '');
  return '';
}

function tokensOf(e: Json): number | null {
  const u = (e.usage ?? (e.message as Json | undefined)?.usage ?? (e.part as Json | undefined)?.tokens) as Json | undefined;
  const n = u?.output_tokens ?? u?.output;
  return typeof n === 'number' ? n : null;
}

async function once(cwd: string): Promise<{ firstByte: number; firstAnswer: number | null; total: number; tokens: number | null; raw: string; types: Set<string> }> {
  let args: string[];
  let env: NodeJS.ProcessEnv = process.env;
  if (provider === 'claude-cli') {
    args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', '', '--disable-slash-commands', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '', '--json-schema', schemaJsonText(CHAT_JSON_SCHEMA)];
    env = envWithout('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN');
  } else if (provider === 'codex-cli') {
    const schemaFile = join(cwd, 'schema.json');
    await writeFile(schemaFile, schemaJsonText(CHAT_JSON_SCHEMA));
    args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '--output-schema', schemaFile];
    env = envWithout('OPENAI_API_KEY');
  } else if (provider === 'opencode-cli') {
    args = ['run', '--format', 'json', '--agent', 'plan'];
  } else throw new Error('unknown provider');
  if (model) args.push(provider === 'codex-cli' ? '-m' : '--model', model);
  if (provider === 'opencode-cli' && model) args.splice(args.indexOf('--model'), 1, '-m');
  if (provider === 'codex-cli') args.push('-');

  const t0 = performance.now();
  const child = spawn(provider.replace('-cli', ''), args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let firstByte = 0;
  let firstAnswer: number | null = null;
  let tokens: number | null = null;
  let raw = '';
  let buf = '';
  let acc = '';
  const types = new Set<string>();
  child.stdout.on('data', (d: Buffer) => {
    const now = performance.now() - t0;
    if (!firstByte) firstByte = now;
    raw += d.toString();
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      let e: Json;
      try { e = JSON.parse(line) as Json; } catch { continue; }
      types.add(String(e.type) + (e.type === 'stream_event' ? ':' + String(((e.event as Json | undefined)?.delta as Json | undefined)?.type ?? (e.event as Json | undefined)?.type) : ''));
      acc += textOf(provider, e);
      if (firstAnswer === null && /"answer"\s*:\s*"[^"]/.test(acc)) firstAnswer = now;
      tokens = tokensOf(e) ?? tokens;
    }
  });
  child.stderr.resume();
  child.stdin.end(prompt);
  await new Promise<void>((resolve) => child.on('close', () => resolve()));
  return { firstByte, firstAnswer, total: performance.now() - t0, tokens, raw, types };
}

const rows = [];
for (let i = 0; i < runs; i++) {
  const cwd = await mkdtemp(join(tmpdir(), 'chess-spike-'));
  try {
    const r = await once(cwd);
    if (i === 0 && savePath) await writeFile(savePath, r.raw);
    rows.push(r);
    console.log(`${provider} ${model ?? 'default'} run ${i + 1}: firstByte=${r.firstByte.toFixed(0)}ms firstAnswer=${r.firstAnswer?.toFixed(0) ?? 'n/a'}ms total=${r.total.toFixed(0)}ms outTokens=${r.tokens ?? 'n/a'} events=${[...r.types].join(',')}`);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
const ans = rows.map((r) => r.firstAnswer).filter((x): x is number => x !== null);
console.log(`MEDIAN ${provider} ${model ?? 'default'}: firstByte=${median(rows.map((r) => r.firstByte)).toFixed(0)}ms firstAnswer=${ans.length ? median(ans).toFixed(0) : 'n/a'}ms total=${median(rows.map((r) => r.total)).toFixed(0)}ms`);
