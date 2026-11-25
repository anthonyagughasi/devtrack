import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Bell,
  CheckCheck,
  CheckSquare,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  RotateCcw,
  Settings,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatClientError } from '../../lib/firebase';
import { cn, formatRelativeTime } from '../../lib/utils';
import {
  getUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../services/notifications';
import type { NotificationItem } from '../../types/app';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';

export type NavRoute =
  | 'dashboard'
  | 'projects'
  | 'tasks'
  | 'team'
  | 'activity'
  | 'settings';

interface AppShellProps {
  activeRoute: NavRoute;
  breadcrumb: string;
  onNavigate: (route: NavRoute, projectId?: string, taskId?: string) => void;
  onNewProject: () => void;
  onResetDemo?: () => void;
  onExitDemo?: () => void;
  children: React.ReactNode;
  refreshTrigger?: number;
}

const NAV_ITEMS: Array<{ id: NavRoute; label: string; icon: React.ElementType }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'projects', label: 'My Projects', icon: FolderKanban },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function AppShell({
  activeRoute,
  breadcrumb,
  onNavigate,
  onNewProject,
  onResetDemo,
  onExitDemo,
  children,
  refreshTrigger = 0,
}: AppShellProps) {
  const { profile, isDemoMode, signOut } = useAuth();
  const { showToast } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);

  const loadNotifications = async () => {
    if (!profile) return;
    try {
      const data = await getUserNotifications(profile);
      setNotifications(data.items);
      setUnreadCount(data.unreadCount);
    } catch {
      // Quietly handle notification polling errors
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [refreshTrigger, activeRoute, profile]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkRead = async (notif: NotificationItem) => {
    if (!profile) return;
    try {
      if (!notif.read) {
        await markNotificationRead(profile.uid, notif.id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      }
      setNotifOpen(false);
      if (notif.link) {
        const projectMatch = notif.link.match(
          /^\/projects\/([a-zA-Z0-9_-]+)(?:\?task=([a-zA-Z0-9_-]+))?/
        );
        if (projectMatch) {
          onNavigate('projects', projectMatch[1], projectMatch[2] || undefined);
          return;
        }
        if (notif.link.startsWith('/team')) {
          onNavigate('team');
        }
      }
    } catch (err) {
      showToast(formatClientError(err, 'Failed to update notification.'), 'error');
    }
  };

  const handleMarkAllRead = async () => {
    if (!profile) return;
    try {
      await markAllNotificationsRead(profile.uid);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
      showToast('All notifications marked as read.', 'success');
    } catch (err) {
      showToast(formatClientError(err, 'Failed to update notifications.'), 'error');
    }
  };

  const handleSignOut = async () => {
    if (isDemoMode) {
      onExitDemo?.();
      return;
    }
    try {
      await signOut();
      showToast('Signed out cleanly.', 'info');
    } catch {
      showToast('Failed to sign out.', 'error');
    }
  };

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex flex-col h-full bg-white dark:bg-[#0D0F14] border-r border-neutral-200 dark:border-neutral-800/80">
      <div className="h-14 px-5 flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800/80 shrink-0">
        <button
          type="button"
          onClick={() => {
            onNavigate('dashboard');
            if (isMobile) setMobileOpen(false);
          }}
          className="font-display text-base font-bold tracking-tight text-neutral-900 dark:text-white cursor-pointer"
        >
          DevTrack
        </button>
        {isMobile && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="p-2 text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeRoute === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onNavigate(item.id);
                if (isMobile) setMobileOpen(false);
              }}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer whitespace-nowrap',
                active
                  ? 'bg-blue-600/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800/50'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-neutral-200 dark:border-neutral-800/80">
        {isDemoMode && (
          <div className="mb-2 px-2 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-[10px] font-mono font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-300 flex items-center justify-between">
            <span>Demo Mode</span>
            <span>Local Only</span>
          </div>
        )}
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar src={profile?.avatar} name={profile?.name ?? 'User'} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
              {profile?.name ?? 'Loading...'}
            </div>
            <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
              {isDemoMode ? 'Sample workspace' : profile?.email ?? ''}
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            title={isDemoMode ? 'Exit Demo' : 'Sign out'}
            aria-label={isDemoMode ? 'Exit Demo' : 'Sign out'}
            className="p-1.5 rounded-md text-neutral-400 hover:text-red-500 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition-colors cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-neutral-50 dark:bg-[#090A0D] text-neutral-900 dark:text-neutral-100">
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:block w-60 shrink-0 sticky top-0 h-screen">
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-72 max-w-[80vw] h-full z-10">
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 border-b border-neutral-200 dark:border-neutral-800/80 bg-white/90 dark:bg-[#090A0D]/90 backdrop-blur-md flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-2 rounded-md text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="font-display text-sm sm:text-base font-semibold tracking-tight truncate">
              {breadcrumb}
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Notifications Dropdown */}
            <div className="relative" ref={notifRef}>
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                aria-label="Notifications"
                className="relative p-2 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111318] text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-white font-mono text-[10px] font-semibold flex items-center justify-center tabular-nums">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111318] shadow-2xl overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                    <span className="text-xs font-semibold">
                      Notifications ({unreadCount} unread)
                    </span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={handleMarkAllRead}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        <CheckCheck className="h-3.5 w-3.5" />
                        <span>Mark all read</span>
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800/60">
                    {notifications.length === 0 ? (
                      <div className="py-8 px-4 text-center text-xs text-neutral-500">
                        You have no notifications yet.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => handleMarkRead(n)}
                          className={cn(
                            'w-full text-left px-4 py-3 hover:bg-neutral-50 dark:hover:bg-[#161922] transition-colors cursor-pointer',
                            !n.read && 'bg-blue-50/40 dark:bg-blue-950/20'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                              {n.title}
                            </span>
                            <span className="font-mono text-[11px] text-neutral-400 shrink-0 tabular-nums">
                              {formatRelativeTime(n.createdAt)}
                            </span>
                          </div>
                          <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 line-clamp-2">
                            {n.message}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <Button size="sm" onClick={onNewProject}>
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">New Project</span>
              <span className="sm:hidden">New</span>
            </Button>
          </div>
        </header>

        {isDemoMode && (
          <div
            role="region"
            aria-label="Demo mode controls"
            className="border-b border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/35 px-4 sm:px-6 py-2.5"
          >
            <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 font-mono text-[11px] font-semibold tracking-wider text-amber-700 dark:text-amber-300 shrink-0">
                  <Sparkles className="h-3 w-3" />
                  <span>DEMO MODE</span>
                </span>
                <p className="text-xs text-neutral-700 dark:text-neutral-300 truncate">
                  Interactive sample workspace saved locally in your browser — no account required.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {onResetDemo && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={onResetDemo}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reset Demo</span>
                  </Button>
                )}
                {onExitDemo && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onExitDemo}
                    className="border border-neutral-300 dark:border-neutral-700"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Exit Demo</span>
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
