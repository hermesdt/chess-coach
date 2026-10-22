import { countSequenceSentences, loadContentSources, sequenceIssues } from '../server/content/sequences.js';
import type { ValidationIssue } from '../server/repertoire/types.js';

/** Prints the sequence issues. Without --strict an error prints as a warning and the exit code stays 0. */
function main(): number {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length > 1 || args.some((a) => a.startsWith('--') && a !== '--strict')) {
    console.log('Usage: pnpm check:sequences [--strict] [file]');
    return 1;
  }
  const sources = loadContentSources(files[0] ?? null);
  const issues: ValidationIssue[] = sequenceIssues(sources).map((i) => (strict ? i : { ...i, severity: 'warning' as const }));
  const errors = issues.filter((i) => i.severity !== 'warning');
  for (const i of issues) console.log(`${i.file} [${i.severity === 'warning' ? 'warning ' : ''}${i.rule}] ${i.nodeId}: ${i.detail}`);
  console.log(`${countSequenceSentences(sources)} sentence(s) with 2+ moves, ${errors.length} error(s), ${issues.length - errors.length} warning(s)`);
  return errors.length === 0 ? 0 : 1;
}

process.exitCode = main();
