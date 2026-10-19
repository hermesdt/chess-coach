import { useState, type ReactNode } from 'react';

interface Props {
  moves: ReactNode;
  chat: ReactNode;
}

const TABS = ['Moves', 'Coach chat'] as const;

/** Right-hand column of the game page: the move list and the coach chat. */
export function GameTabs({ moves, chat }: Props) {
  const [active, setActive] = useState<(typeof TABS)[number]>('Moves');
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
      <div role="tabpanel">{active === 'Moves' ? moves : chat}</div>
    </div>
  );
}
