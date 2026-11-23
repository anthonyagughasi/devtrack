import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  LogOut,
  Moon,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import { cn, formatDate } from '../../lib/utils';
import { strongPasswordSchema } from '../../lib/validations';
import type { UserProfile } from '../../types/app';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';

const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export function SettingsView() {
  const { profile, refreshProfile, applyTheme, signOut } = useAuth();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [themePreference, setThemePreference] = useState<'dark' | 'light'>('dark');
  const [notifyOnAssign, setNotifyOnAssign] = useState(true);
  const [notifyOnComment, setNotifyOnComment] = useState(true);
  const [notifyOnInvite, setNotifyOnInvite] = useState(true);
  const [notifyOnDeadline, setNotifyOnDeadline] = useState(true);
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setThemePreference(profile.themePreference === 'light' ? 'light' : 'dark');
    setNotifyOnAssign(profile.notifyOnAssign);
    setNotifyOnComment(profile.notifyOnComment);
    setNotifyOnInvite(profile.notifyOnInvite);
    setNotifyOnDeadline(profile.notifyOnDeadline);
  }, [profile]);

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setAvatarError(null);
    const normalizedType = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
    if (!ALLOWED_AVATAR_TYPES.has(normalizedType)) {
      const msg = 'Please select a JPEG, PNG, or WebP image.';
      setAvatarError(msg);
      showToast(msg, 'error');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      const msg = 'Profile picture must be 2 MB or smaller.';
      setAvatarError(msg);
      showToast(msg, 'error');
      return;
    }

    setUploadingAvatar(true);
    try {
      await apiFetch<{ user: UserProfile }>('/api/me/avatar', {
        method: 'POST',
        headers: {
          'Content-Type': normalizedType,
        },
        body: file,
      });
      await refreshProfile();
      showToast('Profile picture updated.', 'success');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to upload profile picture.';
      setAvatarError(msg);
      showToast(msg, 'error');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setAvatarError(null);
    setRemovingAvatar(true);
    try {
      await apiFetch<{ user: UserProfile }>('/api/me/avatar', {
        method: 'DELETE',
      });
      await refreshProfile();
      showToast('Profile picture removed.', 'success');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to remove profile picture.';
      setAvatarError(msg);
      showToast(msg, 'error');
    } finally {
      setRemovingAvatar(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      showToast('Display name must be at least 2 characters.', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          themePreference,
          notifyOnAssign,
          notifyOnComment,
          notifyOnInvite,
          notifyOnDeadline,
        }),
      });
      applyTheme(themePreference);
      await refreshProfile();
      showToast('Preferences saved.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    const strengthCheck = strongPasswordSchema.safeParse(newPassword);
    if (!strengthCheck.success) {
      showToast(
        strengthCheck.error.issues[0]?.message ||
          'Password does not meet security requirements.',
        'error'
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match.', 'error');
      return;
    }
    if (!profile) return;

    setSavingPassword(true);
    try {
      await apiFetch('/api/me/password', {
        method: 'PATCH',
        body: JSON.stringify({
          currentPassword: profile.hasPassword ? currentPassword : '',
          newPassword,
          confirmPassword,
        }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refreshProfile();
      showToast(
        profile.hasPassword ? 'Password updated.' : 'Password set for email sign-in.',
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update password.', 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  if (!profile) return null;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight">Settings</h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          Manage your profile, interface theme, password, and notification preferences.
        </p>
      </div>

      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* Profile */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-6 space-y-5">
          <h3 className="font-display text-sm font-semibold">Profile</h3>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <Avatar src={profile.avatar} name={name || profile.name} size="lg" />
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarFileChange}
                className="hidden"
                aria-label="Upload profile picture"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={uploadingAvatar}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>{profile.avatar ? 'Replace Picture' : 'Upload Picture'}</span>
                </Button>
                {profile.avatar && !profile.avatar.includes('avatar_engineer_') && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    loading={removingAvatar}
                    onClick={handleRemoveAvatar}
                    className="text-red-500 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Remove</span>
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-neutral-500">
                Supports JPEG, PNG, or WebP up to 2 MB. When removed, your initials are shown.
              </p>
              {avatarError && (
                <p className="text-xs text-red-500">{avatarError}</p>
              )}
            </div>
          </div>

          <div className="max-w-sm">
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
              Display Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Appearance */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-6 space-y-4">
          <h3 className="font-display text-sm font-semibold">Appearance</h3>
          <div className="grid grid-cols-2 gap-3 max-w-sm">
            <button
              type="button"
              onClick={() => {
                setThemePreference('dark');
                applyTheme('dark');
              }}
              className={cn(
                'flex items-center justify-center gap-2 h-10 rounded-lg border text-xs font-medium transition-colors cursor-pointer',
                themePreference === 'dark'
                  ? 'border-blue-500 bg-blue-600/10 text-blue-500'
                  : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400'
              )}
            >
              <Moon className="h-4 w-4" />
              <span>Dark Mode</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setThemePreference('light');
                applyTheme('light');
              }}
              className={cn(
                'flex items-center justify-center gap-2 h-10 rounded-lg border text-xs font-medium transition-colors cursor-pointer',
                themePreference === 'light'
                  ? 'border-blue-500 bg-blue-600/10 text-blue-600'
                  : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400'
              )}
            >
              <Sun className="h-4 w-4" />
              <span>Light Mode</span>
            </button>
          </div>
        </div>

        {/* Notification Preferences */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-6 space-y-4">
          <h3 className="font-display text-sm font-semibold">
            Notification Preferences
          </h3>
          <div className="space-y-3 text-sm">
            {[
              {
                label: 'Task assignments',
                desc: 'Notify me when a teammate assigns a task to me',
                checked: notifyOnAssign,
                onChange: setNotifyOnAssign,
              },
              {
                label: 'Task comments',
                desc: 'Notify me when someone comments on tasks I own or am assigned to',
                checked: notifyOnComment,
                onChange: setNotifyOnComment,
              },
              {
                label: 'Project invitations',
                desc: 'Notify me when I am invited to collaborate on a project',
                checked: notifyOnInvite,
                onChange: setNotifyOnInvite,
              },
              {
                label: 'Approaching deadlines',
                desc: 'Alert me 48 hours before assigned task deadlines',
                checked: notifyOnDeadline,
                onChange: setNotifyOnDeadline,
              },
            ].map((pref) => (
              <label
                key={pref.label}
                className="flex items-center justify-between gap-4 py-1.5 cursor-pointer"
              >
                <div>
                  <div className="text-xs font-medium">{pref.label}</div>
                  <div className="text-[11px] text-neutral-500">{pref.desc}</div>
                </div>
                <input
                  type="checkbox"
                  checked={pref.checked}
                  onChange={(e) => pref.onChange(e.target.checked)}
                  className="h-4 w-4 accent-blue-600 rounded cursor-pointer"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end">
          <Button type="submit" loading={saving}>
            Save Preferences
          </Button>
        </div>
      </form>

      {/* Password & Sign-in Security */}
      <form
        onSubmit={handlePasswordUpdate}
        className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-6 space-y-4"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-blue-500" />
          <h3 className="font-display text-sm font-semibold">
            {profile.hasPassword ? 'Change Password' : 'Set Account Password'}
          </h3>
        </div>
        <p className="text-xs text-neutral-500">
          {profile.hasPassword
            ? 'Update the password used for email sign-in. Passwords must be at least 8 characters and include uppercase, lowercase, and numeric characters.'
            : 'Add a password so you can also sign in directly with your email address.'}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {profile.hasPassword && (
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
                Current Password
              </label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
              New Password
            </label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1.5">
              Confirm Password
            </label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0D0F14] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" variant="secondary" loading={savingPassword}>
            {profile.hasPassword ? 'Update Password' : 'Set Password'}
          </Button>
        </div>
      </form>

      {/* Account Summary */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800/80 bg-white dark:bg-[#111318] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <h3 className="font-display text-sm font-semibold">Account</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span>
              Signed in as{' '}
              <span className="font-medium text-neutral-800 dark:text-neutral-200">
                {profile.email}
              </span>
            </span>
            {profile.emailVerified && (
              <span className="inline-flex items-center gap-1 text-emerald-500 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Verified
              </span>
            )}
          </div>
          <p className="font-mono text-[11px] text-neutral-400 tabular-nums">
            Member since {formatDate(profile.createdAt)}
          </p>
        </div>

        <Button
          variant="secondary"
          onClick={() => signOut()}
          className="text-red-500 hover:text-red-400"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Sign Out</span>
        </Button>
      </div>
    </div>
  );
}
