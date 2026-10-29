import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { Link, useParams } from 'react-router';
import type { CourseLessonDetail } from '../../../shared/types';
import { api } from '../api';
import { ExerciseBoard } from '../components/ExerciseBoard';

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

export function LessonPage() {
  const { id = '' } = useParams();
  const [lesson, setLesson] = useState<CourseLessonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [created, setCreated] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let stale = false;
    setLesson(null);
    setError(null);
    setIndex(0);
    setFinished(false);
    setCreated(null);
    api.getLesson(id).then(
      (l) => {
        if (!stale) setLesson(l);
      },
      (e: Error) => {
        if (!stale) setError(e.message);
      },
    );
    return () => {
      stale = true;
    };
  }, [id]);

  if (!lesson) {
    return <section>{error ? <p className="error">{error}</p> : <p>Loading...</p>}<Link to="/course">Back to the course</Link></section>;
  }
  if (lesson.status === 'locked') {
    return <section><h1>{lesson.title}</h1><p className="muted">This lesson is locked.</p><Link to="/course">Back to the course</Link></section>;
  }

  const complete = async () => {
    setSaving(true);
    setError(null);
    try {
      setCreated((await api.completeLesson(lesson.id)).created);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const exercise = lesson.exercises[index];
  const last = index === lesson.exercises.length - 1;
  return (
    <section className="lesson">
      <p><Link to="/course">Back to the course</Link></p>
      <h1>{lesson.title}</h1>
      <div className="lesson-body"><Markdown skipHtml>{lesson.body}</Markdown></div>
      {lesson.links.length > 0 && (
        <ul>
          {lesson.links.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noreferrer">{l.title}</a></li>)}
        </ul>
      )}
      {lesson.relatedPlans.length > 0 && (
        <>
          <h2>Related plans</h2>
          <ul>{lesson.relatedPlans.map((p) => <li key={p.id}><Link to={`/plans/${p.id}`}>{p.title}</Link></li>)}</ul>
        </>
      )}
      {exercise && !finished && (
        <>
          <h2>Exercise {index + 1} of {lesson.exercises.length}</h2>
          <ExerciseBoard
            key={exercise.id}
            exercise={exercise}
            nextLabel={last ? 'Finish exercises' : 'Next exercise'}
            onNext={() => (last ? setFinished(true) : setIndex(index + 1))}
          />
        </>
      )}
      {(finished || lesson.exercises.length === 0) && (
        <div className="lesson-done">
          {lesson.status === 'done' ? (
            <p role="status">You finished this lesson. <Link to="/course">Back to the course</Link></p>
          ) : created === null ? (
            <button type="button" className="big" disabled={saving} onClick={() => void complete()}>Mark lesson done</button>
          ) : (
            <p role="status">
              Added {created} {plural(created, 'card')} to your review queue. <Link to="/course">Back to the course</Link>
            </p>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
