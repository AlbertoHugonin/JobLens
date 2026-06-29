import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { AppShell } from './components/Layout/AppShell';
import { AppStatusProvider } from './contexts/AppStatusContext';
import { DebugModeProvider } from './contexts/DebugModeContext';
import { ActivitiesPage } from './pages/ActivitiesPage';
import { DashboardPage } from './pages/DashboardPage';
import { JobsPage } from './pages/JobsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SearchesPage } from './pages/SearchesPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  return (
    <BrowserRouter>
      <DebugModeProvider>
        <AppStatusProvider>
          <AppShell>
            <Routes>
              <Route element={<DashboardPage />} path="/" />
              <Route element={<JobsPage />} path="/jobs" />
              <Route element={<SearchesPage />} path="/searches" />
              <Route element={<ActivitiesPage />} path="/activities" />
              <Route element={<SettingsPage />} path="/settings" />
              <Route element={<NotFoundPage />} path="*" />
            </Routes>
          </AppShell>
        </AppStatusProvider>
      </DebugModeProvider>
    </BrowserRouter>
  );
}
