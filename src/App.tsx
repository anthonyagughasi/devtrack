/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { isDemoPath } from './demo/demo-session';
import { loadDemoWorkspace } from './demo/demo-store';
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

function parseDemoLocation(): {
  route: NavRoute;
  projectId: string | null;
  taskId?: string;
} {
  if (typeof window === 'undefined') {
    return { route: 'dashboard', projectId: null };
  }
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(window.location.search);
  const taskId = params.get('task')?.trim() || undefined;

  if (pathname === '/demo') {
    return { route: 'dashboard', projectId: null };
  }
  const projectDetailMatch = pathname.match(/^\/demo\/projects\/([^/]+)$/);
  if (projectDetailMatch) {
    return {
      route: 'projects',
      projectId: decodeURIComponent(projectDetailMatch[1]),
      taskId,
    };
  }
  if (pathname === '/demo/projects') {
    return { route: 'projects', projectId: null };
  }
  if (pathname === '/demo/tasks') {
    return { route: 'tasks', projectId: null };
  }
  if (pathname === '/demo/team') {
    return { route: 'team', projectId: null };
  }
  if (pathname === '/demo/activity') {
    return { route: 'activity', projectId: null };
  }
  if (pathname === '/demo/settings') {
    return { route: 'settings', projectId: null };
  }
  return { route: 'dashboard', projectId: null };
}

function demoRouteToUrl(route: NavRoute, projectId?: string | null, taskId?: string): string {
  let base = '/demo';
  if (route === 'projects') {
    base = projectId ? `/demo/projects/${encodeURIComponent(projectId)}` : '/demo/projects';
  } else if (route !== 'dashboard') {
    base = `/demo/${route}`;
  }
  if (route === 'projects' && projectId && taskId) {
    return `${base}?task=${encodeURIComponent(taskId)}`;
  }
  return base;
}

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
  const {
    firebaseUser,
    profile,
    isDemoMode,
    loading,
    authError,
    enterDemoMode,
    exitDemoMode,
    resetDemoMode,
    refreshProfile,
    signOut,
    clearAuthError,
  } = useAuth();
  const { showToast } = useToast();

  const initialDemo = isDemoPath() ? parseDemoLocation() : null;
  const [route, setRoute] = useState<NavRoute>(() => initialDemo?.route ?? 'dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => initialDemo?.projectId ?? null
  );
  const [initialTaskId, setInitialTaskId] = useState<string | undefined>(
    () => initialDemo?.taskId
  );
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [authLoc, setAuthLoc] = useState<{ route: AuthRoute; token?: string }>(() =>
    parseAuthLocation()
  );

  useEffect(() => {
    const onPopState = () => {
      setAuthLoc(parseAuthLocation());
      if (isDemoPath()) {
        if (!firebaseUser) {
          enterDemoMode();
          const parsedDemo = parseDemoLocation();
          setRoute(parsedDemo.route);
          setSelectedProjectId(parsedDemo.projectId);
          setInitialTaskId(parsedDemo.taskId);
        }
      } else if (isDemoMode && !firebaseUser) {
        exitDemoMode();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [enterDemoMode, exitDemoMode, firebaseUser, isDemoMode]);

  const navigateAuth = useCallback((next: AuthRoute, token?: string) => {
    clearAuthError();
    const nextUrl = authRouteToPath(next, token);
    if (window.location.pathname + window.location.search !== nextUrl) {
      window.history.pushState({}, '', nextUrl);
    }
    setAuthLoc({ route: next, token });
  }, [clearAuthError]);

  // Normalize /login, /register, /forgot-password (or /demo* for real authenticated accounts)
  useEffect(() => {
    if (
      profile &&
      (authLoc.route === 'login' ||
        authLoc.route === 'register' ||
        authLoc.route === 'forgot-password')
    ) {
      const targetUrl = isDemoMode ? '/demo' : '/';
      window.history.replaceState({}, '', targetUrl);
      setAuthLoc({ route: 'landing' });
    } else if (firebaseUser && !isDemoMode && isDemoPath()) {
      window.history.replaceState({}, '', '/');
    }
  }, [profile, firebaseUser, isDemoMode, authLoc.route]);

  // Ensure Demo Mode URL stays under /demo while active
  useEffect(() => {
    if (isDemoMode && !isDemoPath()) {
      const targetUrl = demoRouteToUrl(route, selectedProjectId, initialTaskId);
      window.history.replaceState({}, '', targetUrl);
    }
  }, [isDemoMode, route, selectedProjectId, initialTaskId]);

  const bumpRefresh = useCallback(() => {
    setRefreshTrigger((n) => n + 1);
  }, []);

  const handleNavigate = useCallback(
    (nextRoute: NavRoute, projectId?: string, taskId?: string) => {
      setRoute(nextRoute);
      const nextProj = nextRoute === 'projects' && projectId ? projectId : null;
      const nextTask = nextRoute === 'projects' && projectId ? taskId : undefined;
      setSelectedProjectId(nextProj);
      setInitialTaskId(nextTask);

      if (isDemoMode && typeof window !== 'undefined') {
        const nextUrl = demoRouteToUrl(nextRoute, nextProj, nextTask);
        if (window.location.pathname + window.location.search !== nextUrl) {
          window.history.pushState({}, '', nextUrl);
        }
      }
    },
    [isDemoMode]
  );

  const handleExploreDemo = useCallback(() => {
    clearAuthError();
    enterDemoMode();
    setRoute('dashboard');
    setSelectedProjectId(null);
    setInitialTaskId(undefined);
    setAuthLoc({ route: 'landing' });
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/demo');
    }
    bumpRefresh();
    showToast('Entered interactive Demo Mode. Changes are saved locally in your browser.', 'info');
  }, [bumpRefresh, clearAuthError, enterDemoMode, showToast]);

  const handleExitDemo = useCallback(() => {
    exitDemoMode();
    setRoute('dashboard');
    setSelectedProjectId(null);
    setInitialTaskId(undefined);
    setNewProjectOpen(false);
    setAuthLoc({ route: 'landing' });
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
    }
    showToast('Exited Demo Mode.', 'info');
  }, [exitDemoMode, showToast]);

  const handleResetDemo = useCallback(() => {
    resetDemoMode();
    const freshWorkspace = loadDemoWorkspace();
    if (
      selectedProjectId &&
      !freshWorkspace.projects.some((p) => p.id === selectedProjectId)
    ) {
      setSelectedProjectId(null);
      setInitialTaskId(undefined);
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/demo/projects');
      }
    }
    bumpRefresh();
    showToast('Demo workspace restored to original sample data.', 'success');
  }, [bumpRefresh, resetDemoMode, selectedProjectId, showToast]);

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
        onExploreDemo={handleExploreDemo}
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
          onExploreDemo={handleExploreDemo}
          onCompleteAuth={() => navigateAuth('landing')}
        />
      );
    }
    return <LandingPage onNavigateAuth={navigateAuth} onExploreDemo={handleExploreDemo} />;
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
      onResetDemo={handleResetDemo}
      onExitDemo={handleExitDemo}
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
          onBack={() => handleNavigate('projects')}
          refreshTrigger={refreshTrigger}
          onDataChanged={bumpRefresh}
        />
      )}

      {route === 'projects' && !selectedProjectId && (
        <ProjectsView
          onSelectProject={(id) => handleNavigate('projects', id)}
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

      {route === 'settings' && (
        <SettingsView onResetDemo={handleResetDemo} onExitDemo={handleExitDemo} />
      )}

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
