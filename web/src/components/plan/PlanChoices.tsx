const LABELS = ['A', 'B', 'C', 'D'];

export interface PlanChoicesProps {
  choices: { uci: string; san: string }[];
  disabled: boolean;
  onPick(uci: string): void;
  /** The choice the owner points at, so the page can highlight its arrow. */
  onHover(uci: string | null): void;
}

/** Buttons A to D for a "find the plan move" card. The arrows on the board are not labelled, so a hover shows which one a button means. */
export function PlanChoices({ choices, disabled, onPick, onHover }: PlanChoicesProps) {
  return (
    <div className="plan-choices" role="group" aria-label="Choices">
      {choices.map((c, i) => (
        <button
          key={c.uci}
          type="button"
          disabled={disabled}
          onClick={() => onPick(c.uci)}
          onMouseEnter={() => onHover(c.uci)}
          onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(c.uci)}
          onBlur={() => onHover(null)}
        >
          {LABELS[i]} {c.san}
        </button>
      ))}
    </div>
  );
}
