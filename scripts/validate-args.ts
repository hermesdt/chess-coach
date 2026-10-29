export interface ValidateArgs {
  lessons: boolean;
  repertoires: boolean;
  plans: boolean;
  /** Validate just this lesson, repertoire, guide or plan file. */
  file: string | null;
}

export function parseValidateArgs(argv: string[]): ValidateArgs {
  let lessons = false;
  let repertoires = false;
  let plans = false;
  let file: string | null = null;
  for (const a of argv) {
    if (a === '--lessons') lessons = true;
    else if (a === '--repertoires') repertoires = true;
    else if (a === '--plans') plans = true;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else if (file === null) file = a;
    else throw new Error('Only one file path is allowed');
  }
  if (file !== null) return { lessons: false, repertoires: false, plans: false, file };
  if (!lessons && !repertoires && !plans) return { lessons: true, repertoires: true, plans: true, file: null };
  return { lessons, repertoires, plans, file: null };
}

/** Arguments of `pnpm check:sequences`: one optional file; `--strict` is accepted and is the default. Null means a usage error. */
export function parseCheckArgs(argv: string[]): { strict: boolean; file: string | null } | null {
  const files = argv.filter((a) => !a.startsWith('--'));
  if (files.length > 1 || argv.some((a) => a.startsWith('--') && a !== '--strict')) return null;
  return { strict: true, file: files[0] ?? null };
}
