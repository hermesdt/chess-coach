import type { Level } from '../level.js';
import { loadLessons } from '../course/load.js';

let levels: Map<string, number> | undefined;

function lessonLevels(): Map<string, number> {
  levels ??= new Map(loadLessons(undefined, () => undefined).map((l) => [l.id, l.level]));
  return levels;
}

/**
 * The one place that keeps AI answers inside the owner's level. A lesson above `level` becomes null.
 * The JSON schema enum stays static (all lesson ids), so this runs after validation.
 */
export function capLessonId<T extends string>(lessonId: T | null, level: Level): T | null {
  if (lessonId === null) return null;
  return (lessonLevels().get(lessonId) ?? 1) > level ? null : lessonId;
}
