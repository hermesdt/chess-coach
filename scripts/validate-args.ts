export interface ValidateArgs {
  lessons: boolean;
  repertoires: boolean;
  /** Validate just this lesson or repertoire file. */
  file: string | null;
}

export function parseValidateArgs(argv: string[]): ValidateArgs {
  let lessons = false;
  let repertoires = false;
  let file: string | null = null;
  for (const a of argv) {
    if (a === '--lessons') lessons = true;
    else if (a === '--repertoires') repertoires = true;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else if (file === null) file = a;
    else throw new Error('Only one file path is allowed');
  }
  if (file !== null) return { lessons: false, repertoires: false, file };
  if (!lessons && !repertoires) return { lessons: true, repertoires: true, file: null };
  return { lessons, repertoires, file: null };
}

/** Arguments of `pnpm check:sequences`: one optional file; `--strict` is accepted and is the default. Null means a usage error. */
export function parseCheckArgs(argv: string[]): { strict: boolean; file: string | null } | null {
  const files = argv.filter((a) => !a.startsWith('--'));
  if (files.length > 1 || argv.some((a) => a.startsWith('--') && a !== '--strict')) return null;
  return { strict: true, file: files[0] ?? null };
}
