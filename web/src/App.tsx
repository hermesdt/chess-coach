import { NavLink, Route, Routes } from 'react-router';
import { DashboardPage } from './pages/DashboardPage';

function Placeholder({ title }: { title: string }) {
  return (
    <section>
      <h1>{title}</h1>
      <p>Coming soon.</p>
    </section>
  );
}

export function App() {
  return (
    <>
      <nav className="nav">
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/games">Games</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/games" element={<Placeholder title="Games" />} />
          <Route path="/settings" element={<Placeholder title="Settings" />} />
        </Routes>
      </main>
    </>
  );
}
