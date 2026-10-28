import { applySeverity, countSequenceSentences, loadContentSources, sequenceExitCode, sequenceIssues } from '../server/content/sequences.js';
import { parseCheckArgs } from './validate-args.js';

/** Prints the sequence issues. An illegal sequence is an error and the exit code is 1. */
function main(): number {
  const args = parseCheckArgs(process.argv.slice(2));
  if (args === null) {
    console.log('Usage: pnpm check:sequences [--strict] [file]');
    return 1;
  }
  const sources = loadContentSources(args.file);
  const issues = applySeverity(sequenceIssues(sources), args.strict);
  for (const i of issues) console.log(`${i.file} [${i.severity === 'warning' ? 'warning ' : ''}${i.rule}] ${i.nodeId}: ${i.detail}`);
  const errors = issues.filter((i) => i.severity !== 'warning').length;
  console.log(`${countSequenceSentences(sources)} clause(s) with 2+ moves, ${errors} error(s), ${issues.length - errors} warning(s)`);
  return sequenceExitCode(issues);
}

process.exitCode = main();
