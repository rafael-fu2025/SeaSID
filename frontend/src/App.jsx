import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Forecast from './pages/Forecast';
import MapPage from './pages/MapPage';
import Experiments from './pages/Experiments';
import Verify from './pages/Verify';
import Settings from './pages/Settings';
import Agent from './pages/Agent';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/forecast" element={<Forecast />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/experiments" element={<Experiments />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/agent" element={<Agent />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
