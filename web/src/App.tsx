import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router';
import { api } from './api';
import { DashboardPage } from './pages/DashboardPage';
import { GamesPage } from './pages/GamesPage';
import { GameViewerPage } from './pages/GameViewerPage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';

function ReviewLink() {
  const { pathname } = useLocation();
  const [due, setDue] = useState(0);
  // Refresh the badge on every navigation, so it follows the reviews the user just did.
  useEffect(() => {
    let stale = false;
    api.getReviewStats().then(
      (s) => {
        if (!stale) setDue(s.dueNow);
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [pathname]);
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
        <NavLink to="/settings">Settings</NavLink>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/games/:id" element={<GameViewerPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </>
  );
}
