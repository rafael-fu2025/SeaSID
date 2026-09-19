import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import { AuthGate, AuthProvider } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
import { SkeletonChart } from './components/Skeleton';

// Audit F-F1-03: route-level code splitting — Leaflet (~150 KB gz) and
// Recharts (~100 KB gz) no longer land in the initial bundle; each page
// loads on first navigation.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Forecast = lazy(() => import('./pages/Forecast'));
const MapPage = lazy(() => import('./pages/MapPage'));
const Experiments = lazy(() => import('./pages/Experiments'));
const Verify = lazy(() => import('./pages/Verify'));
const Settings = lazy(() => import('./pages/Settings'));
const Profile = lazy(() => import('./pages/Profile'));
const Agent = lazy(() => import('./pages/Agent'));

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <SkeletonChart />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate fallback={<LoginPage />}>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Suspense fallback={<RouteFallback />}><Dashboard /></Suspense>} />
              <Route path="/forecast" element={<Suspense fallback={<RouteFallback />}><Forecast /></Suspense>} />
              <Route path="/map" element={<Suspense fallback={<RouteFallback />}><MapPage /></Suspense>} />
              <Route path="/experiments" element={<Suspense fallback={<RouteFallback />}><Experiments /></Suspense>} />
              <Route path="/verify" element={<Suspense fallback={<RouteFallback />}><Verify /></Suspense>} />
              <Route path="/settings" element={<Suspense fallback={<RouteFallback />}><Settings /></Suspense>} />
              <Route path="/profile" element={<Suspense fallback={<RouteFallback />}><Profile /></Suspense>} />
              <Route path="/agent" element={<Suspense fallback={<RouteFallback />}><Agent /></Suspense>} />
              {/* Audit F-F1-05: unknown URLs get a real 404 instead of the
                  bare Layout chrome. */}
              <Route
                path="*"
                element={
                  <div className="flex flex-col items-center gap-3 p-12 text-center">
                    <p className="text-3xl font-semibold tracking-tight text-foreground">404</p>
                    <p className="text-sm text-muted-foreground">
                      That page doesn't exist. Head back to the dashboard.
                    </p>
                  </div>
                }
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthGate>
    </AuthProvider>
  );
}
