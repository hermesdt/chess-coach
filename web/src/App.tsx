import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router';
import { api } from './api';
import { REVIEW_FINISHED } from './lib/events';
import { CoachPage } from './pages/CoachPage';
import { CoursePage } from './pages/CoursePage';
import { DashboardPage } from './pages/DashboardPage';
import { GuidePage } from './pages/GuidePage';
import { GamesPage } from './pages/GamesPage';
import { GameViewerPage } from './pages/GameViewerPage';
import { LessonPage } from './pages/LessonPage';
import { InsightsPage } from './pages/InsightsPage';
import { OpeningsPage } from './pages/OpeningsPage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';

function ReviewLink() {
  const { pathname } = useLocation();
  const [due, setDue] = useState(0);
  const [refresh, setRefresh] = useState(0);
  // The review page announces when a session is finished, so the badge drops without a navigation.
  useEffect(() => {
    const onFinished = () => setRefresh((n) => n + 1);
    window.addEventListener(REVIEW_FINISHED, onFinished);
    return () => window.removeEventListener(REVIEW_FINISHED, onFinished);
  }, []);
  // Refresh the badge on every navigation, so it follows the reviews the user just did.
  useEffect(() => {
    let stale = false;
    api.getReviewStats().then(
      (s) => {
        if (!stale) setDue(s.sessionSize);
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [pathname, refresh]);
  return (
    <NavLink to="/review">
      Review{due > 0 && <span className="nav-badge" aria-label={`${due} due`}>{due}</span>}
    </NavLink>
  );
}

export function App() {
  return (
    <>
      <nav className="nav">
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/games">Games</NavLink>
        <ReviewLink />
        <NavLink to="/insights">Insights</NavLink>
        <NavLink to="/openings">Openings</NavLink>
        <NavLink to="/course">Course</NavLink>
        <NavLink to="/coach">Coach</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/games/:id" element={<GameViewerPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/openings" element={<OpeningsPage />} />
          <Route path="/openings/:id/guide" element={<GuidePage />} />
          <Route path="/course" element={<CoursePage />} />
          <Route path="/course/:id" element={<LessonPage />} />
          <Route path="/coach" element={<CoachPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </>
  );
}
