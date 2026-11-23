/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { AppShell, type NavRoute } from './components/layout/AppShell';
import { LandingPage } from './components/marketing/LandingPage';
import { AuthViews, type AuthRoute } from './components/auth/AuthViews';
import { DashboardView } from './components/dashboard/DashboardView';
import { ProjectsView } from './components/projects/ProjectsView';
import { ProjectDetailView } from './components/projects/ProjectDetailView';
import { ProjectFormModal } from './components/projects/ProjectFormModal';
import { TasksView } from './components/tasks/TasksView';
import { TeamView } from './components/team/TeamView';
import { ActivityView } from './components/activity/ActivityView';
import { SettingsView } from './components/settings/SettingsView';
import { Skeleton } from './components/ui/Skeleton';

const PATH_TO_AUTH_ROUTE: Record<string, AuthRoute> = {
  '/login': 'login',
  '/register': 'register',
  '/forgot-password': 'forgot-password',
  '/reset-password': 'reset-password',
};

function parseAuthLocation(): { route: AuthRoute; token?: string } {
  if (typeof window === 'undefined') {
    return { route: 'landing' };
  }

  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token')?.trim() || params.get('oobCode')?.trim() || undefined;
  const viewParam = params.get('view')?.trim();
  const modeParam = params.get('mode')?.trim();

  if (pathname in PATH_TO_AUTH_ROUTE) {
    return { route: PATH_TO_AUTH_ROUTE[pathname], token };
  }

  if (modeParam === 'resetPassword' && token) {
    return { route: 'reset-password', token };
  }

  if (
    viewParam === 'login' ||
    viewParam === 'register' ||
    viewParam === 'forgot-password' ||
    viewParam === 'reset-password'
  ) {
    return { route: viewParam, token };
  }

  return { route: 'landing', token };
}

function authRouteToPath(route: AuthRoute, token?: string): string {
  const base = route === 'landing' ? '/' : `/${route}`;
  if (token) {
    return `${base}?token=${encodeURIComponent(token)}`;
  }
  return base;
}

function WorkspaceRouter() {
  const { profile, loading, authError, refreshProfile, signOut, clearAuthError } = useAuth();
  const [route, setRoute] = useState<NavRoute>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [initialTaskId, setInitialTaskId] = useState<string | undefined>(undefined);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [authLoc, setAuthLoc] = useState<{ route: AuthRoute; token?: string }>(() =>
    parseAuthLocation()
  );

  useEffect(() => {
    const onPopState = () => {
      setAuthLoc(parseAuthLocation());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateAuth = useCallback((next: AuthRoute, token?: string) => {
    clearAuthError();
    const nextUrl = authRouteToPath(next, token);
    if (window.location.pathname + window.location.search !== nextUrl) {
      window.history.pushState({}, '', nextUrl);
    }
    setAuthLoc({ route: next, token });
  }, [clearAuthError]);

  // Normalize /login, /register, /forgot-password URL once authenticated
  useEffect(() => {
    if (
      profile &&
      (authLoc.route === 'login' ||
        authLoc.route === 'register' ||
        authLoc.route === 'forgot-password')
    ) {
      window.history.replaceState({}, '', '/');
      setAuthLoc({ route: 'landing' });
    }
  }, [profile, authLoc.route]);

  const bumpRefresh = useCallback(() => {
    setRefreshTrigger((n) => n + 1);
  }, []);

  const handleNavigate = useCallback(
    (nextRoute: NavRoute, projectId?: string, taskId?: string) => {
      setRoute(nextRoute);
      if (nextRoute === 'projects' && projectId) {
        setSelectedProjectId(projectId);
        setInitialTaskId(taskId);
      } else if (nextRoute !== 'projects') {
        setSelectedProjectId(null);
        setInitialTaskId(undefined);
      } else {
        setSelectedProjectId(null);
        setInitialTaskId(undefined);
      }
    },
    []
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090A0D] flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4">
          <Skeleton className="h-8 w-36 mx-auto" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  // Allow password reset links to render even if another session was active
  if (authLoc.route === 'reset-password' && (authLoc.token || !profile)) {
    return (
      <AuthViews
        route={authLoc.route}
        initialToken={authLoc.token}
        onNavigate={navigateAuth}
        onCompleteAuth={() => navigateAuth('landing')}
      />
    );
  }

  if (!profile && authError && authLoc.route === 'landing') {
    return (
      <div className="min-h-screen bg-[#090A0D] text-neutral-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border border-neutral-800 bg-[#111318] p-6 space-y-4 text-center">
          <h2 className="font-display text-lg font-semibold">
            Unable to load workspace profile
          </h2>
          <p className="text-xs text-neutral-400">{authError}</p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => refreshProfile()}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-500 cursor-pointer"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => signOut()}
              className="px-4 py-2 rounded-md border border-neutral-700 text-xs font-medium text-neutral-300 hover:text-white cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    if (authLoc.route !== 'landing') {
      return (
        <AuthViews
          route={authLoc.route}
          initialToken={authLoc.token}
          onNavigate={navigateAuth}
          onCompleteAuth={() => navigateAuth('landing')}
        />
      );
    }
    return <LandingPage onNavigateAuth={navigateAuth} />;
  }

  const breadcrumbMap: Record<NavRoute, string> = {
    dashboard: 'Dashboard',
    projects: selectedProjectId ? 'Projects / Overview' : 'My Projects',
    tasks: 'Tasks',
    team: 'Team',
    activity: 'Activity',
    settings: 'Settings',
  };

  return (
    <AppShell
      activeRoute={route}
      breadcrumb={breadcrumbMap[route]}
      onNavigate={handleNavigate}
      onNewProject={() => setNewProjectOpen(true)}
      refreshTrigger={refreshTrigger}
    >
      {route === 'dashboard' && (
        <DashboardView
          onNewProject={() => setNewProjectOpen(true)}
          onOpenProject={(projectId, taskId) =>
            handleNavigate('projects', projectId, taskId)
          }
          refreshTrigger={refreshTrigger}
          onDataChanged={bumpRefresh}
        />
      )}

      {route === 'projects' && selectedProjectId && (
        <ProjectDetailView
          projectId={selectedProjectId}
          initialTaskId={initialTaskId}
          onBack={() => {
            setSelectedProjectId(null);
            setInitialTaskId(undefined);
          }}
          refreshTrigger={refreshTrigger}
          onDataChanged={bumpRefresh}
        />
      )}

      {route === 'projects' && !selectedProjectId && (
        <ProjectsView
          onSelectProject={(id) => {
            setSelectedProjectId(id);
            setInitialTaskId(undefined);
          }}
          onNewProject={() => setNewProjectOpen(true)}
          refreshTrigger={refreshTrigger}
          onDataChanged={bumpRefresh}
        />
      )}

      {route === 'tasks' && (
        <TasksView
          onNewProject={() => setNewProjectOpen(true)}
          refreshTrigger={refreshTrigger}
          onDataChanged={bumpRefresh}
        />
      )}

      {route === 'team' && (
        <TeamView
          onOpenProject={(projectId) => handleNavigate('projects', projectId)}
          refreshTrigger={refreshTrigger}
          onDataChanged={bumpRefresh}
        />
      )}

      {route === 'activity' && (
        <ActivityView
          onOpenProject={(projectId) => handleNavigate('projects', projectId)}
          refreshTrigger={refreshTrigger}
        />
      )}

      {route === 'settings' && <SettingsView />}

      <ProjectFormModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onSaved={(projectId) => {
          bumpRefresh();
          handleNavigate('projects', projectId);
        }}
      />
    </AppShell>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <WorkspaceRouter />
      </AuthProvider>
    </ToastProvider>
  );
}
