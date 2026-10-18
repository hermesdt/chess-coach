import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { CourseLesson } from '../../../shared/types';
import { api } from '../api';
import { lessonForTag } from '../lib/lesson-links';

export function CoursePage() {
  const [lessons, setLessons] = useState<CourseLesson[] | null>(null);
  const [recommended, setRecommended] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    api.listCourse().then(
      (l) => {
        if (!stale) setLessons(l);
      },
      (e: Error) => {
        if (!stale) setError(e.message);
      },
    );
    api.getDashboard().then(
      (d) => {
        if (!stale && d.topTag) setRecommended(lessonForTag(d.topTag.tag));
      },
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, []);

  if (!lessons) return <section><h1>Course</h1>{error ? <p className="error">{error}</p> : <p>Loading...</p>}</section>;
  return (
    <section>
      <h1>Course</h1>
      {lessons.length === 0 && <p className="muted">No lessons yet.</p>}
      <ol className="course-list">
        {lessons.map((l) => {
          const locked = l.status === 'locked';
          return (
            <li key={l.id} className={`course-item ${l.status}${l.id === recommended ? ' recommended' : ''}`}>
              <span className="course-status" aria-label={l.status}>{l.status === 'done' ? '✓' : locked ? '🔒' : '○'}</span>
              <div>
                <h2>
                  {locked ? <span>{l.title}</span> : <Link to={`/course/${l.id}`}>{l.title}</Link>}
                  {l.id === recommended && <span className="badge recommended-badge">Recommended for you</span>}
                </h2>
                <p>{l.summary}</p>
                <p className="muted">
                  {locked ? `Unlocks at level ${l.level}` : `${l.exercises} exercises`}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
