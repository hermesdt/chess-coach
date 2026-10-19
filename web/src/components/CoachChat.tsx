import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { ChatLineDTO, ChatMessageDTO } from '../../../shared/types';
import { LESSON_TITLES } from '../../../shared/lessons';
import { api } from '../api';
import { useJob } from '../hooks/useJob';

export interface ChatAnchor {
  ply: number;
  path: string[];
  describe: string;
}

interface Props {
  gameId: number;
  analysed: boolean;
  anchor: ChatAnchor;
  onShowLine: (line: ChatLineDTO, anchor: ChatAnchor) => void;
  onShowAnchor: (anchor: ChatAnchor) => void;
  onAnalyse: () => void;
  /** Whether the Coach chat tab is shown. Defaults to true. */
  visible?: boolean;
}

const MAX_PLIES = 8;
const POLL_MS = 2000;
const PREFETCH_DEBOUNCE_MS = 500;

const paragraphs = (text: string): ReactNode =>
  text.split(/\n\s*\n/).map((para, i) => (
    <p key={i}>{para.trim()}</p>
  ));

/** The answer text of a pending message, read from its SSE stream. Closes the stream when it ends or unmounts. */
function PendingAnswer({ id, onEnd }: { id: number; onEnd: () => void }) {
  const [text, setText] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const end = useRef(onEnd);
  end.current = onEnd;

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/chat/${id}/stream`);
    const finish = () => {
      source.close();
      end.current();
    };
    source.addEventListener('delta', (e) => {
      setCorrecting(false);
      setText((JSON.parse((e as MessageEvent<string>).data) as { text: string }).text);
    });
    source.addEventListener('retry', () => {
      setText('');
      setCorrecting(true);
    });
    source.addEventListener('done', finish);
    // "error" is also the name of the connection error. Only a server event carries data.
    source.addEventListener('error', (e) => {
      if (typeof (e as MessageEvent).data === 'string') finish();
    });
    return () => source.close();
  }, [id]);

  return (
    <div className="chat-answer chat-streaming">
      {text ? (
        <>
          {paragraphs(text)}
          <span className="muted chat-checking">checking…</span>
        </>
      ) : (
        <p className="muted">{correcting ? 'The coach is correcting its answer…' : 'The coach is thinking…'}</p>
      )}
    </div>
  );
}

/** "10. Nge2 Nf5 11. O-O" with move numbers taken from the line's start position. */
function lineText(line: ChatLineDTO, plies: number): string {
  const [, turn = 'w', , , , full = '1'] = line.startFen.split(' ');
  let white = turn === 'w';
  let n = Number(full);
  return line.san
    .slice(0, plies)
    .map((san, i) => {
      const text = white ? `${n}. ${san}` : i === 0 ? `${n}...${san}` : san;
      if (!white) n++;
      white = !white;
      return text;
    })
    .join(' ');
}

function errorText(text: string): ReactNode {
  const parts = text.split('Settings');
  if (parts.length < 2) return text;
  return (
    <>
      {parts[0]}
      <Link to="/settings">Settings</Link>
      {parts.slice(1).join('Settings')}
    </>
  );
}

function LineButton({ line, onClick }: { line: ChatLineDTO; onClick: () => void }) {
  const [all, setAll] = useState(false);
  const cut = !all && line.san.length > MAX_PLIES;
  return (
    <div className="chat-line">
      <button type="button" className="chat-line-button" onClick={onClick}>
        {line.label}: {lineText(line, all ? line.san.length : MAX_PLIES)}
        {cut ? ' …' : ''}
      </button>{' '}
      <span className="muted" title="Stockfish estimate of your winning chances after this line">
        Your chances: {Math.round(line.winPctForUser)} %
      </span>
      {cut && (
        <>
          {' '}
          <button type="button" className="link-button" onClick={() => setAll(true)}>show more</button>
        </>
      )}
      {line.why && <p className="chat-why">{line.why}</p>}
    </div>
  );
}

function Answer({
  message, props, added, onAdd, onDeeper, canDeeper,
}: { message: ChatMessageDTO; props: Props; added: boolean; onAdd: () => void; onDeeper: () => void; canDeeper: boolean }) {
  const answer = message.answer!;
  const lesson = answer.lessonId;
  return (
    <div className="chat-answer">
      {paragraphs(answer.text)}
      {answer.lines.map((l) => (
        <LineButton key={l.id} line={l} onClick={() => props.onShowLine(l, message.anchor)} />
      ))}
      {answer.rule && <p className="muted">{answer.rule}</p>}
      {lesson && (
        <p>
          <Link to={`/course/${lesson}`}>{LESSON_TITLES[lesson]}</Link>
        </p>
      )}
      {answer.lines.length > 0 &&
        (added ? <span className="muted">Added to review</span> : <button type="button" onClick={onAdd}>Add to review</button>)}
      {canDeeper && (
        <>
          {' '}
          <button type="button" onClick={onDeeper}>Go deeper</button>
        </>
      )}
    </div>
  );
}

/** The "Coach chat" tab: ask about the position on the board, read answers, open their lines on the board. */
export function CoachChat(props: Props) {
  const { gameId, analysed, anchor, visible = true } = props;
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [draft, setDraft] = useState('');
  const [jobId, setJobId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const { job, error: pollError } = useJob(jobId);
  const end = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    api.getChat(gameId).then(setMessages, (e: Error) => setSendError(e.message));
  }, [gameId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Keep the newest message in view after a question, an answer or an error.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messages]);

  const finished = job?.status === 'done' || job?.status === 'error' || pollError !== null;
  useEffect(() => {
    if (jobId === null || !finished) return;
    setJobId(null);
    reload();
  }, [jobId, finished, reload]);

  // A message left pending by an earlier page load has no job to follow here, so poll the list.
  // The poll also backs up the SSE stream if it drops.
  const orphan = jobId === null && messages.some((m) => m.status === 'pending');
  useEffect(() => {
    if (!orphan) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [orphan, reload]);

  const pending = sending || jobId !== null || orphan;

  // Warm the engine cache for the anchor: when the tab is shown, and when the owner starts to type.
  const anchorKey = `${anchor.ply}|${anchor.path.join(',')}`;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const hasDraft = draft.trim() !== '';
  const prefetchOn = visible && analysed;
  /** Debounced prefetch for the current anchor. Returns the cleanup. */
  const schedulePrefetch = useCallback(() => {
    const timer = setTimeout(() => {
      const { ply, path } = anchorRef.current;
      void api.prefetchChat(gameId, { ply, path }).catch(() => {});
    }, PREFETCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [gameId]);
  useEffect(() => (prefetchOn ? schedulePrefetch() : undefined), [prefetchOn, schedulePrefetch, anchorKey]);
  useEffect(() => (prefetchOn && hasDraft ? schedulePrefetch() : undefined), [prefetchOn, hasDraft, schedulePrefetch]);

  const send = async () => {
    const question = draft.trim();
    if (!question || pending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await api.sendChat(gameId, { question, anchor: { ply: anchor.ply, path: anchor.path } });
      setDraft('');
      setJobId(res.jobId);
      reload();
    } catch (e) {
      setSendError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const retry = async (id: number) => {
    setSendError(null);
    try {
      setJobId((await api.retryChat(id)).jobId);
      reload();
    } catch (e) {
      setSendError((e as Error).message);
    }
  };

  const deeper = async (id: number) => {
    setSendError(null);
    try {
      setJobId((await api.deeperChat(id)).jobId);
      reload();
    } catch (e) {
      setSendError((e as Error).message);
    }
  };

  const addToReview = async (id: number) => {
    try {
      await api.chatReviewCard(id);
      setAdded((s) => new Set(s).add(id));
    } catch (e) {
      setSendError((e as Error).message);
    }
  };

  if (!analysed) {
    return (
      <div className="coach-chat">
        <p>Analyse this game first</p>
        <button type="button" onClick={props.onAnalyse}>Analyse this game</button>
      </div>
    );
  }

  const deepOf = new Map<number, ChatMessageDTO[]>();
  const top: ChatMessageDTO[] = [];
  const ids = new Set(messages.map((m) => m.id));
  for (const m of messages) {
    if (m.deep && m.parentId !== null && ids.has(m.parentId)) deepOf.set(m.parentId, [...(deepOf.get(m.parentId) ?? []), m]);
    else top.push(m);
  }
  const hasDeep = new Set(deepOf.keys());
  const anyPending = messages.some((m) => m.status === 'pending');

  /** The body of one message: its stream, answer or error. A message with a deep child has no "Go deeper". */
  const body = (m: ChatMessageDTO, noDeeper: boolean): ReactNode => (
    <>
      {m.status === 'pending' && <PendingAnswer id={m.id} onEnd={reload} />}
      {m.status === 'done' && m.answer && (
        <Answer
          message={m}
          props={props}
          added={added.has(m.id)}
          onAdd={() => void addToReview(m.id)}
          canDeeper={m.deeperAvailable && !m.deep && !noDeeper}
          onDeeper={() => void deeper(m.id)}
        />
      )}
      {m.status === 'error' && (
        <p className="error">
          {errorText(m.error ?? 'The coach could not answer.')}{' '}
          <button type="button" disabled={pending} onClick={() => void retry(m.id)}>Try again</button>
        </p>
      )}
    </>
  );

  return (
    <div className="coach-chat">
      <div className="chat-messages">
        {top.map((m) => (
          <div key={m.id} className="chat-message">
            <button type="button" className="link-button chat-context" onClick={() => props.onShowAnchor(m.anchor)}>
              About {m.anchor.describe}
            </button>
            <p className="chat-question">{m.question}</p>
            {body(m, hasDeep.has(m.id))}
            {(deepOf.get(m.id) ?? []).map((d) => (
              <div key={d.id} className="chat-deep">
                <p className="chat-deep-label">
                  <strong>Deeper answer</strong>
                  {d.provider && <small className="muted"> {[d.provider, d.model].filter(Boolean).join(' · ')}</small>}
                </p>
                {body(d, true)}
              </div>
            ))}
          </div>
        ))}
        <div ref={end} />
      </div>
      {pending && !anyPending && <p className="muted">The coach is thinking…</p>}
      {sendError && <p className="error">{sendError}</p>}
      <p className="muted chat-anchor">About {anchor.describe}</p>
      <div className="chat-input">
        <input
          type="text"
          value={draft}
          placeholder="Ask about this position…"
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
        />
        <button type="button" disabled={pending || !draft.trim()} onClick={() => void send()}>Send</button>
      </div>
    </div>
  );
}
