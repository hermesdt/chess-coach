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
}

const MAX_PLIES = 8;
const POLL_MS = 2000;

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
      <button type="button" onClick={onClick}>
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

function Answer({ message, props, added, onAdd }: { message: ChatMessageDTO; props: Props; added: boolean; onAdd: () => void }) {
  const answer = message.answer!;
  const lesson = answer.lessonId;
  return (
    <div className="chat-answer">
      <p>{answer.text}</p>
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
    </div>
  );
}

/** The "Coach chat" tab: ask about the position on the board, read answers, open their lines on the board. */
export function CoachChat(props: Props) {
  const { gameId, analysed, anchor } = props;
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
  const orphan = jobId === null && messages.some((m) => m.status === 'pending');
  useEffect(() => {
    if (!orphan) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [orphan, reload]);

  const pending = sending || jobId !== null || orphan;

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

  return (
    <div className="coach-chat">
      <div className="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className="chat-message">
            <button type="button" className="link-button chat-context" onClick={() => props.onShowAnchor(m.anchor)}>
              About {m.anchor.describe}
            </button>
            <p className="chat-question">{m.question}</p>
            {m.status === 'done' && m.answer && (
              <Answer message={m} props={props} added={added.has(m.id)} onAdd={() => void addToReview(m.id)} />
            )}
            {m.status === 'error' && (
              <p className="error">
                {errorText(m.error ?? 'The coach could not answer.')}{' '}
                <button type="button" disabled={pending} onClick={() => void retry(m.id)}>Try again</button>
              </p>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      {pending && <p className="muted">The coach is thinking…</p>}
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
