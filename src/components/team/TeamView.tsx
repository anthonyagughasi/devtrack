import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, MailPlus, Trash2, Users, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatClientError } from '../../lib/firebase';
import { formatDate } from '../../lib/utils';
import { listUserProjects } from '../../services/projects';
import {
  acceptInvitation,
  declineInvitation,
  inviteMember,
  listIncomingInvitations,
  listWorkspaceTeam,
  revokeInvitation,
  type TeamMemberSummary,
} from '../../services/team';
import type { InvitationItem, ProjectSummary } from '../../types/app';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';

interface TeamViewProps {
  onOpenProject: (projectId: string) => void;
  refreshTrigger: number;
  onDataChanged: () => void;
}

export function TeamView({
  onOpenProject,
  refreshTrigger,
  onDataChanged,
}: TeamViewProps) {
  const { profile, isDemoMode } = useAuth();
  const { showToast } = useToast();
  const [members, setMembers] = useState<TeamMemberSummary[]>([]);
  const [outgoingInvites, setOutgoingInvites] = useState<InvitationItem[]>([]);
  const [incomingInvites, setIncomingInvites] = useState<InvitationItem[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteProjectId, setInviteProjectId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'MEMBER' | 'ADMINISTRATOR'>('MEMBER');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [tokenInput, setTokenInput] = useState('');
  const [acceptingToken, setAcceptingToken] = useState(false);
  const [decliningToken, setDecliningToken] = useState(false);

  const loadTeam = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const [teamRes, incomingList, projectsList] = await Promise.all([
        listWorkspaceTeam(profile.uid),
        listIncomingInvitations(profile.email),
        listUserProjects(profile.uid),
      ]);
      setMembers(teamRes.members);
      setOutgoingInvites(teamRes.invitations);
      setIncomingInvites(incomingList);
      const manageable = projectsList.filter(
        (p) => p.role === 'OWNER' || p.role === 'ADMINISTRATOR'
      );
      setProjects(manageable);
      if (manageable.length > 0 && !inviteProjectId) {
        setInviteProjectId(manageable[0].id);
      }
    } catch (err) {
      showToast(formatClientError(err, 'Failed to load team data.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [profile, showToast, inviteProjectId]);

  useEffect(() => {
    loadTeam();
  }, [loadTeam, refreshTrigger]);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !inviteProjectId || !inviteEmail.trim()) return;
    setSendingInvite(true);
    setInviteFeedback(null);
    const recipient = inviteEmail.trim();
    try {
      await inviteMember(profile, inviteProjectId, {
        email: recipient,
        role: inviteRole,
      });

      const statusText = isDemoMode
        ? 'Simulated invitation created locally in Demo Mode (no email is sent). You can copy the sample invite token or revoke it below.'
        : "Invitation created. It will appear in the recipient's DevTrack account when they sign in with that email, or you can copy the invite token below.";

      setInviteFeedback({ type: 'success', text: statusText });
      showToast(statusText, 'success');
      setInviteEmail('');
      loadTeam();
      onDataChanged();
    } catch (err) {
      const msg = formatClientError(err, 'Failed to create invitation.');
      setInviteFeedback({ type: 'error', text: msg });
      showToast(msg, 'error');
    } finally {
      setSendingInvite(false);
    }
  };

  const handleAcceptInvite = async (token: string) => {
    if (!profile) return;
    setAcceptingToken(true);
    try {
      const res = await acceptInvitation(profile, token);
      showToast('Invitation accepted. You joined the project.', 'success');
      setTokenInput('');
      loadTeam();
      onDataChanged();
      onOpenProject(res.projectId);
    } catch (err) {
      showToast(formatClientError(err, 'Failed to accept invitation.'), 'error');
    } finally {
      setAcceptingToken(false);
    }
  };

  const handleDeclineInvite = async (token: string) => {
    if (!profile) return;
    setDecliningToken(true);
    try {
      await declineInvitation(profile, token);
      showToast('Invitation declined.', 'info');
      loadTeam();
      onDataChanged();
    } catch (err) {
      showToast(formatClientError(err, 'Failed to decline invitation.'), 'error');
    } finally {
      setDecliningToken(false);
    }
  };

  const handleRevokeInvite = async (id: string) => {
    if (!profile) return;
    try {
      await revokeInvitation(profile, id);
      showToast('Invitation revoked.', 'success');
      loadTeam();
    } catch (err) {
      showToast(formatClientError(err, 'Failed to revoke invitation.'), 'error');
    }
  };

  const handleCopyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      showToast('Invitation token copied.', 'success');
    } catch {
      showToast('Copy failed. Select the token manually.', 'info');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Team & Collaborators
        </h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          Manage project memberships, track individual workloads, and accept single-use invitations.
        </p>
      </div>

      {/* Incoming Invitations & Token Redemption */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-5 space-y-4">
          <h3 className="font-display text-sm font-semibold flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-blue-500" />
            <span>Accept Invitation</span>
          </h3>

          {incomingInvites.length > 0 && (
            <div className="space-y-2.5">
              {incomingInvites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border border-blue-500/30 bg-blue-500/5"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">
                      {inv.projectName ?? 'Project Invitation'}
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      Invited by {inv.invitedByName} · Role: {inv.role}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleDeclineInvite(inv.token)}
                      loading={decliningToken}
                      disabled={acceptingToken}
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Decline</span>
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleAcceptInvite(inv.token)}
                      loading={acceptingToken}
                      disabled={decliningToken}
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>Accept</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (tokenInput.trim()) handleAcceptInvite(tokenInput.trim());
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Paste invitation token..."
              className="flex-1 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Button
              type="submit"
              size="sm"
              loading={acceptingToken}
              disabled={!tokenInput.trim()}
            >
              Join Project
            </Button>
          </form>
        </div>

        {/* Send Invitation */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-5 space-y-4">
          <h3 className="font-display text-sm font-semibold flex items-center gap-2">
            <MailPlus className="h-4 w-4 text-neutral-400" />
            <span>Invite Collaborator</span>
          </h3>

          {projects.length === 0 ? (
            <p className="text-xs text-neutral-500">
              You need Owner or Administrator permissions on a project to invite team members.
            </p>
          ) : (
            <form onSubmit={handleSendInvite} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <select
                value={inviteProjectId}
                onChange={(e) => setInviteProjectId(e.target.value)}
                className="sm:col-span-4 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="engineer@team.com"
                className="sm:col-span-4 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              <select
                value={inviteRole}
                onChange={(e) =>
                  setInviteRole(e.target.value as 'MEMBER' | 'ADMINISTRATOR')
                }
                className="sm:col-span-2 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="MEMBER">Member</option>
                <option value="ADMINISTRATOR">Admin</option>
              </select>

              <Button
                type="submit"
                size="sm"
                loading={sendingInvite}
                className="sm:col-span-2 h-9"
              >
                Invite
              </Button>
            </form>
          )}
          {inviteFeedback && (
            <p
              className={`text-xs leading-relaxed ${
                inviteFeedback.type === 'error'
                  ? 'text-red-500'
                  : 'text-emerald-500'
              }`}
            >
              {inviteFeedback.text}
            </p>
          )}
        </div>
      </div>

      {/* Team Directory */}
      {loading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No team members yet"
          description="Create a project or accept an invitation to collaborate with your engineering team."
        />
      ) : (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[680px]">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800 text-xs font-medium text-neutral-500">
                <th className="py-3 px-4">Member</th>
                <th className="py-3 px-4">Projects & Roles</th>
                <th className="py-3 px-4 text-right">Active Tasks</th>
                <th className="py-3 px-4 text-right">Completed</th>
                <th className="py-3 px-4 text-right">Overdue</th>
                <th className="py-3 px-4 text-right">Activity Events</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/60 text-sm">
              {members.map((m) => (
                <tr
                  key={m.userId}
                  className="hover:bg-neutral-50 dark:hover:bg-[#161922] transition-colors"
                >
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <Avatar src={m.avatar} name={m.name} size="sm" />
                      <div>
                        <div className="font-medium text-xs sm:text-sm">{m.name}</div>
                        <div className="text-[11px] text-neutral-500">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-xs">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {m.projects.map((p) => (
                        <button
                          key={`${m.userId}-${p.projectId}`}
                          type="button"
                          onClick={() => onOpenProject(p.projectId)}
                          className="text-neutral-700 dark:text-neutral-300 hover:text-blue-500 transition-colors cursor-pointer"
                        >
                          {p.projectName}{' '}
                          <span className="font-mono text-[11px] text-neutral-500">
                            ({p.role})
                          </span>
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-xs tabular-nums">
                    {m.taskStats.active}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-xs text-emerald-500 tabular-nums">
                    {m.taskStats.completed}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-xs text-red-500 tabular-nums">
                    {m.taskStats.overdue}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-xs text-neutral-500 tabular-nums">
                    {m.activityCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pending Outgoing Invitations */}
      {outgoingInvites.length > 0 && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-5 space-y-3">
          <h3 className="font-display text-sm font-semibold">
            Pending Project Invitations
          </h3>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
            {outgoingInvites.map((inv) => (
              <div
                key={inv.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div>
                  <span className="font-medium">{inv.email}</span>
                  <span className="text-neutral-500">
                    {' '}
                    · {inv.projectName} · {inv.role} · Expires {formatDate(inv.expiresAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleCopyToken(inv.token)}
                  >
                    <Copy className="h-3 w-3" />
                    <span>Copy Token</span>
                  </Button>
                  <button
                    type="button"
                    onClick={() => handleRevokeInvite(inv.id)}
                    aria-label="Revoke invitation"
                    className="p-1.5 text-neutral-400 hover:text-red-500 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
