import { useState, type ReactNode } from 'react';

interface Props {
  moves: ReactNode;
  chat: ReactNode;
  /** Tab shown first. */
  initial?: 'chat';
}

const TABS = ['Moves', 'Coach chat'] as const;

/** Right-hand column of the game page: the move list and the coach chat. */
export function GameTabs({ moves, chat, initial }: Props) {
  const [active, setActive] = useState<(typeof TABS)[number]>(initial === 'chat' ? 'Coach chat' : 'Moves');
  return (
    <div className="game-tabs">
      <div className="tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={tab === active}
            className={tab === active ? 'tab active' : 'tab'}
            onClick={() => setActive(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      {/* Both panels stay mounted so the chat keeps its draft and pending job while the Moves tab is open. */}
      <div role="tabpanel" hidden={active !== 'Moves'}>{moves}</div>
      <div role="tabpanel" hidden={active !== 'Coach chat'}>{chat}</div>
    </div>
  );
}
