import React, { useState } from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FolderKanban,
  Lock,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../ui/Button';
import type { AuthRoute } from '../auth/AuthViews';

const PREVIEW_TASKS = [
  {
    id: 'DT-104',
    title: 'Finalize checkout webhook retry schedule',
    status: 'IN_PROGRESS',
    priority: 'Urgent',
    team: 'Backend',
    due: 'Nov 22',
  },
  {
    id: 'DT-105',
    title: 'Ship dark-mode sprint board keyboard shortcuts',
    status: 'COMPLETED',
    priority: 'High',
    team: 'Frontend',
    due: 'Nov 20',
  },
  {
    id: 'DT-106',
    title: 'Prepare Q4 release readiness checklist',
    status: 'TODO',
    priority: 'Medium',
    team: 'Platform',
    due: 'Nov 25',
  },
  {
    id: 'DT-107',
    title: 'Audit onboarding flow copy and empty states',
    status: 'COMPLETED',
    priority: 'High',
    team: 'Product',
    due: 'Nov 19',
  },
];

interface LandingPageProps {
  onNavigateAuth: (route: AuthRoute) => void;
}

export function LandingPage({ onNavigateAuth }: LandingPageProps) {
  const { signInWithGoogle, authConfig, authError } = useAuth();
  const { showToast } = useToast();
  const [signingIn, setSigningIn] = useState(false);
  const [previewFilter, setPreviewFilter] = useState<
    'ALL' | 'TODO' | 'IN_PROGRESS' | 'COMPLETED'
  >('ALL');
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
      showToast('Signed in to DevTrack.', 'success');
    } catch {
      showToast(
        'Sign-in did not complete. Please try again or sign in with email.',
        'error'
      );
    } finally {
      setSigningIn(false);
    }
  };

  const filteredPreview =
    previewFilter === 'ALL'
      ? PREVIEW_TASKS
      : PREVIEW_TASKS.filter((t) => t.status === previewFilter);

  return (
    <div className="min-h-screen bg-[#090A0D] text-neutral-100 flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 border-b border-neutral-800/80 bg-[#090A0D]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            DevTrack
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-neutral-400">
            <a
              href="#overview"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Overview
            </a>
            <a
              href="#workflow"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Workflow
            </a>
            <a
              href="#analytics"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Analytics
            </a>
            <a
              href="#collaboration"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Teams
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigateAuth('login')}
              className="whitespace-nowrap shrink-0"
            >
              Sign in
            </Button>
            <Button
              size="sm"
              onClick={() => onNavigateAuth('register')}
              className="whitespace-nowrap shrink-0"
            >
              Get started
            </Button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* Hero Split */}
        <section
          id="overview"
          className="max-w-7xl mx-auto px-6 pt-16 pb-20 lg:pt-24 lg:pb-28"
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-medium tracking-wide text-blue-400 mb-4">
                Engineering Project Management
              </p>
              <h1
                className="font-display font-bold tracking-tight text-white leading-[1.08] text-balance"
                style={{ fontSize: 'clamp(2.25rem, 4vw, 3.75rem)' }}
              >
                Ship software milestones with clarity and focus
              </h1>
              <p className="mt-6 text-base text-neutral-400 leading-relaxed max-w-xl">
                DevTrack brings Kanban boards, structured team permissions, live delivery analytics, and shared activity timelines into one distraction-free workspace for software teams and agencies.
              </p>

              {authError && (
                <p className="mt-4 text-xs text-red-400 border border-red-900/60 bg-red-950/30 rounded-md px-3 py-2 max-w-md">
                  {authError}
                </p>
              )}

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button size="lg" onClick={() => onNavigateAuth('register')}>
                  <span>Create free account</span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => onNavigateAuth('login')}
                >
                  Sign in with email
                </Button>
                {authConfig.googleConfigured && (
                  <Button
                    variant="ghost"
                    size="lg"
                    onClick={handleGoogleSignIn}
                    loading={signingIn}
                  >
                    Continue with Google
                  </Button>
                )}
              </div>

              <div className="mt-10 pt-8 border-t border-neutral-800/80 grid grid-cols-3 gap-6 max-w-lg">
                <div>
                  <div className="font-mono text-xl font-semibold text-white tabular-nums">
                    3 Roles
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Owner, Admin &amp; Member
                  </div>
                </div>
                <div>
                  <div className="font-mono text-xl font-semibold text-white tabular-nums">
                    Kanban
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Drag-and-drop sprint flow
                  </div>
                </div>
                <div>
                  <div className="font-mono text-xl font-semibold text-white tabular-nums">
                    Live Insights
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Velocity &amp; workload charts
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 flex">
              <div className="w-full rounded-xl border border-neutral-800 bg-[#111318] overflow-hidden flex flex-col">
                {!heroImgFailed ? (
                  <img
                    src="/src/assets/images/hero_devtrack_workspace_1795167302744.jpg"
                    alt="Engineering team collaborating on DevTrack project workspace"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgFailed(true)}
                    className="w-full h-72 lg:h-full min-h-[320px] object-cover"
                  />
                ) : (
                  <div className="w-full h-full min-h-[320px] bg-gradient-to-br from-[#111318] to-[#171A21] flex items-center justify-center p-8">
                    <FolderKanban className="h-12 w-12 text-blue-500/60" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Interactive Application Preview */}
        <section
          id="workflow"
          className="border-t border-neutral-800/80 bg-[#0C0E13] py-20"
        >
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
              <div>
                <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white">
                  Interactive Sprint &amp; Task Queue
                </h2>
                <p className="text-sm text-neutral-400 mt-2 max-w-2xl">
                  Filter deliverables by execution state, review priority signals, and keep every team assignment accountable to a clear due date.
                </p>
              </div>
              <div className="inline-flex items-center gap-1 p-1 rounded-lg border border-neutral-800 bg-[#111318] self-start">
                {(['ALL', 'TODO', 'IN_PROGRESS', 'COMPLETED'] as const).map(
                  (tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setPreviewFilter(tab)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        previewFilter === tab
                          ? 'bg-blue-600 text-white'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      {tab === 'ALL'
                        ? 'All Tasks'
                        : tab === 'TODO'
                          ? 'To Do'
                          : tab === 'IN_PROGRESS'
                            ? 'In Progress'
                            : 'Completed'}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-[#111318] overflow-hidden">
              <div className="grid grid-cols-12 px-5 py-3 border-b border-neutral-800 text-xs font-medium text-neutral-500">
                <div className="col-span-2">Key</div>
                <div className="col-span-5">Deliverable</div>
                <div className="col-span-2">Priority</div>
                <div className="col-span-2 hidden sm:block">Workstream</div>
                <div className="col-span-3 sm:col-span-1 text-right">Due</div>
              </div>
              <div className="divide-y divide-neutral-800/70">
                {filteredPreview.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-12 items-center px-5 py-3.5 text-sm hover:bg-[#161922] transition-colors"
                  >
                    <div className="col-span-2 font-mono text-xs text-neutral-400 tabular-nums">
                      {item.id}
                    </div>
                    <div className="col-span-5 font-medium text-neutral-100 pr-4 truncate">
                      {item.title}
                    </div>
                    <div className="col-span-2 text-xs text-neutral-300">
                      {item.priority}
                    </div>
                    <div className="col-span-2 hidden sm:block text-xs text-neutral-400 truncate">
                      {item.team}
                    </div>
                    <div className="col-span-3 sm:col-span-1 text-right font-mono text-xs text-neutral-400 tabular-nums">
                      {item.due}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Core Capabilities */}
        <section id="analytics" className="max-w-7xl mx-auto px-6 py-20">
          <div className="max-w-2xl mb-12">
            <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white">
              Built for engineering precision
            </h2>
            <p className="text-sm text-neutral-400 mt-2">
              Project progress, completion trends, and team notifications stay synchronized as your team moves work forward.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 rounded-xl border border-neutral-800 bg-[#111318]">
              <FolderKanban className="h-5 w-5 text-blue-400 mb-4" />
              <h3 className="font-display text-lg font-semibold text-white">
                01. Kanban &amp; Sprint Execution
              </h3>
              <p className="text-sm text-neutral-400 mt-2 leading-relaxed">
                Move tasks smoothly across To Do, In Progress, and Completed columns with clear priority levels, due dates, and threaded discussions.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-neutral-800 bg-[#111318]">
              <Users className="h-5 w-5 text-blue-400 mb-4" />
              <h3 className="font-display text-lg font-semibold text-white">
                02. Structured Team Permissions
              </h3>
              <p className="text-sm text-neutral-400 mt-2 leading-relaxed">
                Invite teammates and external collaborators with clear Owner, Administrator, and Member permissions tailored to each project.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-neutral-800 bg-[#111318]">
              <BarChart3 className="h-5 w-5 text-blue-400 mb-4" />
              <h3 className="font-display text-lg font-semibold text-white">
                03. Live Delivery Telemetry
              </h3>
              <p className="text-sm text-neutral-400 mt-2 leading-relaxed">
                Track project completion percentages, 7-day to 90-day velocity trends, priority breakdowns, and team workload in one dashboard.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-neutral-800 bg-[#111318]">
              <Activity className="h-5 w-5 text-blue-400 mb-4" />
              <h3 className="font-display text-lg font-semibold text-white">
                04. Shared Activity &amp; Alerts
              </h3>
              <p className="text-sm text-neutral-400 mt-2 leading-relaxed">
                Stay informed with chronological workspace activity and timely notifications for assignments, comments, invitations, and upcoming deadlines.
              </p>
            </div>
          </div>
        </section>

        {/* Customer-Focused Collaboration & Access */}
        <section
          id="collaboration"
          className="border-t border-neutral-800/80 bg-[#0C0E13] py-20"
        >
          <div className="max-w-7xl mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
              <div className="lg:col-span-5">
                <div className="inline-flex items-center gap-2 text-xs font-medium text-emerald-400 mb-3">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Secure Team Collaboration</span>
                </div>
                <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white">
                  Designed for distributed product teams
                </h2>
                <p className="text-sm text-neutral-400 mt-3 leading-relaxed">
                  Keep projects organized with secure and convenient account access across email and Google sign-in.
                </p>
                <div className="mt-6 space-y-2.5 text-sm text-neutral-300">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>Reliable project updates and team collaboration</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Lock className="h-4 w-4 text-blue-400 shrink-0" />
                    <span>Your workspace and account are protected</span>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-5 rounded-xl border border-neutral-800 bg-[#111318] space-y-2.5">
                  <div className="text-xs font-mono text-blue-400">01</div>
                  <h3 className="font-display text-sm font-semibold text-white">
                    Engineering Leads
                  </h3>
                  <p className="text-xs text-neutral-400 leading-relaxed">
                    Balance sprint workloads, flag overdue deliverables early, and keep release milestones visible across every active repository.
                  </p>
                </div>

                <div className="p-5 rounded-xl border border-neutral-800 bg-[#111318] space-y-2.5">
                  <div className="text-xs font-mono text-blue-400">02</div>
                  <h3 className="font-display text-sm font-semibold text-white">
                    Product &amp; Delivery
                  </h3>
                  <p className="text-xs text-neutral-400 leading-relaxed">
                    Keep requirements, task priorities, and comment threads connected to real due dates so nothing gets lost between handoffs.
                  </p>
                </div>

                <div className="p-5 rounded-xl border border-neutral-800 bg-[#111318] space-y-2.5">
                  <div className="text-xs font-mono text-blue-400">03</div>
                  <h3 className="font-display text-sm font-semibold text-white">
                    Agencies &amp; Partners
                  </h3>
                  <p className="text-xs text-neutral-400 leading-relaxed">
                    Collaborate with clients and external contributors using project invitations and role-appropriate workspace permissions.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-800/80 py-8 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-500">
          <div className="flex items-center gap-4">
            <span className="font-display font-semibold text-neutral-300">
              DevTrack
            </span>
            <span>Engineering Project Management</span>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <a
              href="#overview"
              className="hover:text-neutral-300 transition-colors"
            >
              Overview
            </a>
            <a
              href="#workflow"
              className="hover:text-neutral-300 transition-colors"
            >
              Workflow
            </a>
            <a
              href="#analytics"
              className="hover:text-neutral-300 transition-colors"
            >
              Analytics
            </a>
            <button
              type="button"
              onClick={() => onNavigateAuth('login')}
              className="text-neutral-300 hover:text-white font-medium cursor-pointer"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => onNavigateAuth('register')}
              className="text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
            >
              Create account
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
