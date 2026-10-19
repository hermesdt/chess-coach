# Chat speed spike (M8b Task 1)

Date: 2026-10-19. Script: `scripts/spike-chat-speed.ts` (manual, calls real CLIs, never part of the tests).
Usage: `pnpm tsx scripts/spike-chat-speed.ts <claude-cli|codex-cli|opencode-cli> [model|default] [runs] [saveStreamTo]`.

## Method

- Prompt: the real chat prompt (`CHAT_SYSTEM` + `buildChatPrompt` + `cliPrompt`), question "Can I play Bh6 here?", level 1, rating 550.
- Fact pack: `2026-10-19-chat-speed-spike-factpack.json` in this folder. No real fixture game has this position.
  It is a SPIKE FIXTURE: legal moves from chess.js, hand-written evaluations, for timing only. It never reaches the owner.
  Position: London System, after 1.d4 Nf6 2.Bf4 g6 3.e3 Bg7 4.Nf3 O-O, White to move.
- Timing with `performance.now()` from process spawn. "First answer" is the first non-quote character after `"answer":"` in the decoded text.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `OPENAI_API_KEY` are stripped, as in the adapters.
- Three runs per model. The table shows the median. 19 real model calls in total, plus 3 opencode calls that failed at once (wrong model id).
- Single-machine, single-day numbers. Treat them as relative, not absolute.

## Numbers (median of 3, milliseconds)

| CLI | Model | First byte | First `answer` char | Total | Output tokens (runs) | Follows schema |
|---|---|---|---|---|---|---|
| claude-cli | claude-haiku-5-5 | 303 | 4718 | 7186 | 1031, 1209, 1006 | yes |
| claude-cli | claude-sonnet-5-5 | 296 | 1819 | 5805 | 458, 388, 481 | yes |
| claude-cli | claude-opus-5-5 | 303 | 5126 | 9791 | 703, 725, 701 | yes |
| codex-cli | default (`gpt-6.1-sol`, from `~/.codex/config.toml`) | 155 | 8106 | 8533 | 123, 225, 209 | yes |
| codex-cli | gpt-5.6-luna | 155 | 4815 | 5211 | 238, 214, 287 | yes |
| opencode-cli | openrouter/z-ai/glm-5.3-flash | 5992 | 25381 | 25502 | 228, 264, 248 | NO (extra keys) |

Remarks:
- Haiku is slower than Sonnet to first `answer`. It spends 300 to 400 thinking tokens first (output_tokens_details.thinking_tokens). Sonnet used 0.
- Claude "first byte" is only the `system` init line. It is not useful as a progress signal.
- Claude first answer char to the end is about 4 s with Sonnet: the answer text really streams.
- Codex and opencode emit the whole answer in one event. First answer char equals total time (minus a few ms).
- opencode run times vary a lot (10.5 s, 25.5 s, 47.9 s for the same prompt).
- The model id `openrouter/glm-5.3-flash` from the task text does not exist. The valid id is `openrouter/z-ai/glm-5.3-flash` (`opencode models`). The first three calls failed with `UnknownError`.
- opencode does not enforce the schema (no schema flag). One run returned `answer, judgment, advice, lines, lessonId, rule`. The runner retry must handle it.

## claude: `--json-schema` with `stream-json`

Command (works):
`claude -p --output-format stream-json --verbose --include-partial-messages --tools "" --disable-slash-commands --no-session-persistence --strict-mcp-config --setting-sources "" --json-schema <schema> [--model m]`, prompt on stdin.
(`--verbose` is required with `stream-json` in `-p` mode.)

Findings:
- `--json-schema` still works. All 10 runs returned a schema-valid object.
- The CLI adds a hidden tool `StructuredOutput` (init event: `"tools":["StructuredOutput"]`). The model "calls" it with the JSON.
  So the JSON does NOT arrive as `text_delta`. It arrives as `input_json_delta` events (`partial_json` pieces) of a `tool_use` block.
  `stop_reason` is `tool_use`. This is normal here.
- About 80 to 95 `input_json_delta` events per answer. Pieces are 1 to 3 words. The first piece is an empty string.
- The final `result` event carries both `result` (JSON text, as today) and `structured_output` (the parsed object). Both are present. The `assistant` event also holds the full `tool_use.input` object.
- A model may emit `thinking_delta` and `signature_delta` events first (Haiku, Opus). Ignore them.
- Other events to ignore: `system` (`init`, `status`), `rate_limit_event`, `user` (tool_result), `message_delta`, `message_stop`.

Event shapes (one line each, from `server/ai/providers/__fixtures__/claude-cli-stream.jsonl`):

Delta:
`{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"answer\": \"No,"}},"session_id":"...","parent_tool_use_id":null,"uuid":"...","api_message_id":"..."}`

Final result (keys; long fields cut):
`{"type":"result","subtype":"success","is_error":false,"stop_reason":"tool_use","result":"{\"answer\":\"...\",\"lines\":[...],\"rule\":\"...\",\"lessonId\":null}","structured_output":{"answer":"...","lines":[],"rule":"...","lessonId":null},"usage":{"input_tokens":2,"output_tokens":458,...},"total_cost_usd":...,"duration_ms":...}`

Stream parse rule: concatenate `event.delta.partial_json` of every `stream_event` whose `event.type === "content_block_delta"` and `event.delta.type === "input_json_delta"`. Also accept `text_delta` (`event.delta.text`) for safety. Extract the `answer` string incrementally from that text (partial JSON string decode: handle `\n`, `\"`, `\\`, `\uXXXX`). Final value: `result` event, `structured_output` first, else `JSON.parse(result)`. If `is_error` is true, fail with `result` as message.

## codex: `exec --json`

Command: `codex exec --json --skip-git-repo-check --ephemeral -s read-only --output-schema <file> [-m model] -`, prompt on stdin. Do not pass `-o`: the answer is in the stream.

- No text deltas. Only whole items.
- Events seen: `thread.started`, `turn.started`, optional `item.started`, `item.completed`, `turn.completed`.
- Answer: `{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"{\"answer\":\"...\",\"lines\":[...],\"rule\":\"...\",\"lessonId\":\"blunder-check\"}"}}`. The `text` is the schema JSON.
- Usage: `{"type":"turn.completed","usage":{"input_tokens":20307,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":123,"reasoning_output_tokens":0}}`.
- Schema is enforced (all 6 runs valid).
- Parse rule: last `item.completed` with `item.type === "agent_message"`, take `item.text`. Fixture: `codex-cli-stream.jsonl`.

## opencode: `run --format json`

Command (unchanged): `opencode run --format json --agent plan [-m provider/model]`, prompt on stdin.

- No text deltas. One `text` event holds the whole answer text of a step.
- Events seen: `step_start`, `text`, `step_finish` (and `error`).
- Text: `{"type":"text","part":{"type":"text","messageID":"msg_...","text":"{\"answer\":...}"}}`.
- Usage: `{"type":"step_finish","part":{"reason":"stop","tokens":{"total":27469,"input":27122,"output":228,"reasoning":119,"cache":{...}},"cost":0.0013}}`.
- Error: `{"type":"error","error":{"name":"UnknownError","data":{"message":"..."}}}`.
- Parse rule: as in the existing adapter (concatenate `text` parts of the last `messageID`). Fixture: `opencode-cli-stream.jsonl`.
- Input is large: about 27 k input tokens (the opencode system prompt), so it is slow and variable.

## Fixtures

In `server/ai/providers/__fixtures__/`:
- `claude-cli-stream.jsonl`: Sonnet 5.5 run. The `system/init` line (temp path, plugin list) and `rate_limit_event` are removed. Nothing else is changed.
- `codex-cli-stream.jsonl`: default model run, unchanged.
- `opencode-cli-stream.jsonl`: glm-5.3-flash run, unchanged. Note it has the extra keys (`judgment`, `advice`): it is a schema violation on purpose, kept as real data.
- Checked: no path, token, key or email. They hold chess text only.

## Decisions for Tasks 2 and 4

| Provider | Stream text deltas | Default chat model | Default deep model |
|---|---|---|---|
| claude-cli | yes | `claude-sonnet-5-5` | `claude-opus-5-5` |
| codex-cli | no (whole item) | `gpt-5.6-luna` | `null` (provider default, `gpt-6.1-sol`) |
| opencode-cli | no (whole item) | `openrouter/z-ai/glm-5.3-flash` | `null` (provider default) |
| openrouter | not measured (no key) | keep the current setting | `null` |
| anthropic-api | not measured (no key) | keep the current setting | `null` |

- **claude-cli**: yes. Flags: `-p --output-format stream-json --verbose --include-partial-messages --tools "" --disable-slash-commands --no-session-persistence --strict-mcp-config --setting-sources "" --json-schema <schema> [--model m]`; env without `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`.
  Parse rule: `input_json_delta.partial_json` for live text; the `result` event (`structured_output`, else `result`) for the final value.
  Chat = Sonnet: 1.8 s to the first answer char and 5.8 s total, the fastest of all and schema-valid; Haiku is slower because it thinks first. Deep = Opus: the strongest, 9.8 s total is fine for an opt-in deep answer.
- **codex-cli**: no. Flags: `exec --json --skip-git-repo-check --ephemeral -s read-only --output-schema <file> [-m m] -` (no `-o`).
  Parse rule: last `item.completed` with `item.type === "agent_message"`, field `item.text`; usage in `turn.completed`.
  Chat = `gpt-5.6-luna`: 5.2 s total against 8.5 s for the default, schema-valid. Deep = `null`, the provider default (the owner's configured strongest model). The UI should show a "thinking" state, not live text.
- **opencode-cli**: no. Flags: `run --format json --agent plan [-m m]` (unchanged).
  Parse rule: concatenate `text` parts of the last `messageID`; usage in `step_finish.part.tokens.output`.
  Chat = `openrouter/z-ai/glm-5.3-flash`, the only model tested (25 s median, 10 to 48 s range, schema NOT enforced), so keep it as the opt-in provider and rely on the runner retry. Deep = `null`.
- **Streaming design consequence**: only claude-cli gives true live text. For the other CLIs Task 2 must treat the answer as one event at the end, with status `streaming` until it arrives.
