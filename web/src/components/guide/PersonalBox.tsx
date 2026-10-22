import type { ReactNode } from 'react';

/** A small "Your games" box. The page only renders it when there is data. */
export function PersonalBox({ children }: { children: ReactNode }) {
  return (
    <aside className="guide-personal">
      <h4>Your games</h4>
      {children}
    </aside>
  );
}
