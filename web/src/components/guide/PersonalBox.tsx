import type { ReactNode } from 'react';

/** A small "Your games" box. The page only renders it when there is data. */
export function PersonalBox({ children }: { children: ReactNode }) {
  return (
    <aside className="guide-personal">
      <h3>Your games</h3>
      {children}
    </aside>
  );
}
