import React, { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ApiError, apiFetch } from '../../lib/api';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  strongPasswordSchema,
} from '../../lib/validations';
import { Button } from '../ui/Button';

export type AuthRoute =
  | 'landing'
  | 'login'
  | 'register'
  | 'forgot-password'
  | 'reset-password'
  | 'verify-email';

interface AuthViewsProps {
  route: Exclude<AuthRoute, 'landing'>;
  initialToken?: string;
  onNavigate: (next: AuthRoute, token?: string) => void;
  onCompleteAuth?: () => void;
}

type LoginFormValues = z.infer<typeof loginSchema>;
type RegisterFormValues = z.infer<typeof registerSchema>;
type ForgotFormValues = z.infer<typeof forgotPasswordSchema>;
type ResendFormValues = z.infer<typeof resendVerificationSchema>;

const resetFormSchema = z
  .object({
    password: strongPasswordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
type ResetFormValues = z.infer<typeof resetFormSchema>;

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
      />
    </svg>
  );
}

function PasswordInput({
  id,
  label,
  placeholder,
  autoComplete,
  error,
  registration,
}: {
  id: string;
  label: string;
  placeholder?: string;
  autoComplete: string;
  error?: string;
  registration: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-neutral-300 mb-1.5"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder={placeholder}
          {...registration}
          className="w-full h-10 rounded-md border border-neutral-800 bg-[#0D0F14] pl-3 pr-10 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-200 p-1 rounded cursor-pointer"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}

function EmailConfigBanner() {
  return (
    <div className="rounded-lg border border-amber-800/70 bg-amber-950/30 p-3.5 text-xs text-amber-200 space-y-1.5">
      <div className="flex items-center gap-2 font-semibold text-amber-300">
        <Mail className="h-3.5 w-3.5 shrink-0" />
        <span>Email delivery is not configured</span>
      </div>
      <p className="text-amber-200/80 leading-relaxed">
        No email provider credentials are configured in this environment. Set{' '}
        <code className="font-mono text-[11px] bg-black/40 px-1 py-0.5 rounded">
          SMTP_HOST
        </code>
        ,{' '}
        <code className="font-mono text-[11px] bg-black/40 px-1 py-0.5 rounded">
          SMTP_PORT
        </code>
        ,{' '}
        <code className="font-mono text-[11px] bg-black/40 px-1 py-0.5 rounded">
          SMTP_USER
        </code>
        ,{' '}
        <code className="font-mono text-[11px] bg-black/40 px-1 py-0.5 rounded">
          SMTP_PASS
        </code>
        , and{' '}
        <code className="font-mono text-[11px] bg-black/40 px-1 py-0.5 rounded">
          EMAIL_FROM
        </code>{' '}
        (or{' '}
        <code className="font-mono text-[11px] bg-black/40 px-1 py-0.5 rounded">
          RESEND_API_KEY
        </code>{' '}
        and{' '}
        <code className="font-mono text-[11px] bg-black/40 px-1 py-0.5 rounded">
          EMAIL_FROM
        </code>
        ) to enable outbound verification and reset emails.
      </p>
    </div>
  );
}

export function AuthViews({
  route,
  initialToken,
  onNavigate,
  onCompleteAuth,
}: AuthViewsProps) {
  const {
    profile,
    authConfig,
    loginWithEmail,
    registerWithEmail,
    signInWithGoogle,
    refreshProfile,
  } = useAuth();
  const { showToast } = useToast();
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      showToast('Signed in with Google.', 'success');
      onCompleteAuth?.();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Google sign-in did not complete.';
      showToast(msg, 'error');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090A0D] text-neutral-100 flex flex-col">
      <header className="border-b border-neutral-800/80 bg-[#090A0D]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <button
            type="button"
            onClick={() => onNavigate('landing')}
            className="font-display text-lg font-bold tracking-tight text-white hover:text-blue-400 transition-colors cursor-pointer"
          >
            DevTrack
          </button>

          <button
            type="button"
            onClick={() => onNavigate('landing')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to home</span>
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-[#111318] p-7 sm:p-8 shadow-2xl">
          {route === 'login' && (
            <LoginCard
              authConfigGoogle={authConfig.googleConfigured}
              googleLoading={googleLoading}
              onGoogleSignIn={handleGoogleSignIn}
              onLogin={async (email, password) => {
                await loginWithEmail(email, password);
                showToast('Welcome back to DevTrack.', 'success');
                onCompleteAuth?.();
              }}
              onNavigate={onNavigate}
            />
          )}

          {route === 'register' && (
            <RegisterCard
              authConfigGoogle={authConfig.googleConfigured}
              googleLoading={googleLoading}
              onGoogleSignIn={handleGoogleSignIn}
              onRegister={async (values) => {
                const res = await registerWithEmail(values);
                if (!res.requiresVerification) {
                  showToast(
                    res.emailConfigured
                      ? 'Account created and signed in.'
                      : 'Account created and signed in (email delivery is not configured in this environment).',
                    'success'
                  );
                  onCompleteAuth?.();
                }
                return res;
              }}
              onNavigate={onNavigate}
            />
          )}

          {route === 'forgot-password' && (
            <ForgotPasswordCard
              emailConfigured={authConfig.emailConfigured}
              onNavigate={onNavigate}
            />
          )}

          {route === 'reset-password' && (
            <ResetPasswordCard token={initialToken} onNavigate={onNavigate} />
          )}

          {route === 'verify-email' && (
            <VerifyEmailCard
              token={initialToken}
              emailConfigured={authConfig.emailConfigured}
              isSignedIn={Boolean(profile)}
              onVerified={async () => {
                if (profile) {
                  await refreshProfile().catch(() => undefined);
                }
              }}
              onNavigate={onNavigate}
              onContinueWorkspace={onCompleteAuth}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function LoginCard({
  authConfigGoogle,
  googleLoading,
  onGoogleSignIn,
  onLogin,
  onNavigate,
}: {
  authConfigGoogle: boolean;
  googleLoading: boolean;
  onGoogleSignIn: () => Promise<void>;
  onLogin: (email: string, password: string) => Promise<void>;
  onNavigate: (next: AuthRoute) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitting(true);
    setServerError(null);
    setNeedsVerification(false);
    try {
      await onLogin(values.email, values.password);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to sign in right now.';
      setServerError(msg);
      if (err instanceof ApiError && err.status === 403) {
        setNeedsVerification(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Sign in to DevTrack
        </h1>
        <p className="text-xs text-neutral-400 mt-1.5">
          Enter your credentials or continue with Google to open your workspace.
        </p>
      </div>

      {serverError && (
        <div
          role="alert"
          className="rounded-lg border border-red-900/70 bg-red-950/40 p-3 text-xs text-red-300 space-y-1.5"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <span>{serverError}</span>
          </div>
          {needsVerification && (
            <button
              type="button"
              onClick={() => onNavigate('verify-email')}
              className="text-blue-400 hover:underline font-medium cursor-pointer block pl-6"
            >
              Resend verification email
            </button>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label
            htmlFor="login-email"
            className="block text-xs font-medium text-neutral-300 mb-1.5"
          >
            Email Address
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            {...register('email')}
            className="w-full h-10 rounded-md border border-neutral-800 bg-[#0D0F14] px-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.email && (
            <p className="text-xs text-red-400 mt-1">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <PasswordInput
            id="login-password"
            label="Password"
            placeholder="Enter your password"
            autoComplete="current-password"
            error={errors.password?.message}
            registration={register('password')}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => onNavigate('forgot-password')}
              className="text-xs text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
            >
              Forgot password?
            </button>
          </div>
        </div>

        <Button type="submit" className="w-full h-10" loading={submitting}>
          Sign in with Email
        </Button>
      </form>

      <div className="relative flex items-center py-1">
        <div className="flex-1 border-t border-neutral-800" />
        <span className="px-3 text-[11px] uppercase tracking-wider text-neutral-500">
          or
        </span>
        <div className="flex-1 border-t border-neutral-800" />
      </div>

      <Button
        variant="secondary"
        className="w-full h-10"
        onClick={onGoogleSignIn}
        loading={googleLoading}
        disabled={!authConfigGoogle}
      >
        <GoogleIcon />
        <span>Continue with Google</span>
      </Button>

      <p className="text-center text-xs text-neutral-400">
        New to DevTrack?{' '}
        <button
          type="button"
          onClick={() => onNavigate('register')}
          className="text-blue-400 hover:text-blue-300 font-medium hover:underline cursor-pointer"
        >
          Create an account
        </button>
      </p>
    </div>
  );
}

function RegisterCard({
  authConfigGoogle,
  googleLoading,
  onGoogleSignIn,
  onRegister,
  onNavigate,
}: {
  authConfigGoogle: boolean;
  googleLoading: boolean;
  onGoogleSignIn: () => Promise<void>;
  onRegister: (values: RegisterFormValues) => Promise<{
    requiresVerification: boolean;
    emailConfigured: boolean;
    message: string;
  }>;
  onNavigate: (next: AuthRoute) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [verificationSentMsg, setVerificationSentMsg] = useState<string | null>(
    null
  );

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  });

  const passwordValue = watch('password') || '';

  const onSubmit = async (values: RegisterFormValues) => {
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await onRegister(values);
      if (res.requiresVerification) {
        setVerificationSentMsg(res.message);
      }
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : 'Unable to create account.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (verificationSentMsg) {
    return (
      <div className="space-y-5 text-center">
        <div className="h-11 w-11 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto">
          <Mail className="h-5 w-5 text-emerald-400" />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold text-white">
            Verify your email
          </h1>
          <p className="text-xs text-neutral-400 mt-2 leading-relaxed">
            {verificationSentMsg}
          </p>
        </div>
        <div className="flex flex-col gap-2.5 pt-2">
          <Button onClick={() => onNavigate('login')} className="w-full h-10">
            Go to sign in
          </Button>
          <button
            type="button"
            onClick={() => onNavigate('verify-email')}
            className="text-xs text-blue-400 hover:underline cursor-pointer"
          >
            Need to resend the verification email?
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Create your account
        </h1>
        <p className="text-xs text-neutral-400 mt-1.5">
          Set up your DevTrack profile with email and password or Google.
        </p>
      </div>

      {serverError && (
        <div
          role="alert"
          className="rounded-lg border border-red-900/70 bg-red-950/40 p-3 text-xs text-red-300 flex items-start gap-2"
        >
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <span>{serverError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label
            htmlFor="register-name"
            className="block text-xs font-medium text-neutral-300 mb-1.5"
          >
            Full Name
          </label>
          <input
            id="register-name"
            type="text"
            autoComplete="name"
            placeholder="Alex Rivera"
            {...register('name')}
            className="w-full h-10 rounded-md border border-neutral-800 bg-[#0D0F14] px-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.name && (
            <p className="text-xs text-red-400 mt-1">{errors.name.message}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="register-email"
            className="block text-xs font-medium text-neutral-300 mb-1.5"
          >
            Work Email
          </label>
          <input
            id="register-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            {...register('email')}
            className="w-full h-10 rounded-md border border-neutral-800 bg-[#0D0F14] px-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.email && (
            <p className="text-xs text-red-400 mt-1">{errors.email.message}</p>
          )}
        </div>

        <div>
          <PasswordInput
            id="register-password"
            label="Password"
            placeholder="Minimum 8 characters"
            autoComplete="new-password"
            error={errors.password?.message}
            registration={register('password')}
          />
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            {[
              { ok: passwordValue.length >= 8, label: '8+ characters' },
              { ok: /[A-Z]/.test(passwordValue), label: 'Uppercase letter' },
              { ok: /[a-z]/.test(passwordValue), label: 'Lowercase letter' },
              { ok: /[0-9]/.test(passwordValue), label: 'One number' },
            ].map((rule) => (
              <div
                key={rule.label}
                className={
                  rule.ok ? 'text-emerald-400' : 'text-neutral-500'
                }
              >
                {rule.ok ? '✓ ' : '· '}
                {rule.label}
              </div>
            ))}
          </div>
        </div>

        <PasswordInput
          id="register-confirm-password"
          label="Confirm Password"
          placeholder="Re-enter your password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          registration={register('confirmPassword')}
        />

        <Button type="submit" className="w-full h-10" loading={submitting}>
          Create Account
        </Button>
      </form>

      <div className="relative flex items-center py-1">
        <div className="flex-1 border-t border-neutral-800" />
        <span className="px-3 text-[11px] uppercase tracking-wider text-neutral-500">
          or
        </span>
        <div className="flex-1 border-t border-neutral-800" />
      </div>

      <Button
        variant="secondary"
        className="w-full h-10"
        onClick={onGoogleSignIn}
        loading={googleLoading}
        disabled={!authConfigGoogle}
      >
        <GoogleIcon />
        <span>Continue with Google</span>
      </Button>

      <p className="text-center text-xs text-neutral-400">
        Already have an account?{' '}
        <button
          type="button"
          onClick={() => onNavigate('login')}
          className="text-blue-400 hover:text-blue-300 font-medium hover:underline cursor-pointer"
        >
          Sign in
        </button>
      </p>
    </div>
  );
}

function ForgotPasswordCard({
  emailConfigured,
  onNavigate,
}: {
  emailConfigured: boolean;
  onNavigate: (next: AuthRoute) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: ForgotFormValues) => {
    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await apiFetch<{ message: string; emailConfigured: boolean }>(
        '/api/auth/forgot-password',
        {
          method: 'POST',
          body: JSON.stringify(values),
        }
      );
      setSuccessMsg(res.message);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Failed to request password reset.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Reset your password
        </h1>
        <p className="text-xs text-neutral-400 mt-1.5">
          Enter your email address to receive a single-use password reset link.
        </p>
      </div>

      {!emailConfigured && <EmailConfigBanner />}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-red-900/70 bg-red-950/40 p-3 text-xs text-red-300 flex items-start gap-2"
        >
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="rounded-lg border border-emerald-900/70 bg-emerald-950/40 p-3 text-xs text-emerald-300 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label
            htmlFor="forgot-email"
            className="block text-xs font-medium text-neutral-300 mb-1.5"
          >
            Account Email
          </label>
          <input
            id="forgot-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            {...register('email')}
            className="w-full h-10 rounded-md border border-neutral-800 bg-[#0D0F14] px-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.email && (
            <p className="text-xs text-red-400 mt-1">{errors.email.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full h-10" loading={submitting}>
          Send Reset Instructions
        </Button>
      </form>

      <div className="text-center">
        <button
          type="button"
          onClick={() => onNavigate('login')}
          className="text-xs text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
}

function ResetPasswordCard({
  token,
  onNavigate,
}: {
  token?: string;
  onNavigate: (next: AuthRoute) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetFormValues>({
    resolver: zodResolver(resetFormSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  if (!token) {
    return (
      <div className="space-y-5 text-center">
        <AlertCircle className="h-9 w-9 text-amber-400 mx-auto" />
        <div>
          <h1 className="font-display text-xl font-bold text-white">
            Invalid reset link
          </h1>
          <p className="text-xs text-neutral-400 mt-2">
            This password reset link is missing a valid token. Please request a new reset link.
          </p>
        </div>
        <Button
          onClick={() => onNavigate('forgot-password')}
          className="w-full h-10"
        >
          Request New Reset Link
        </Button>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="space-y-5 text-center">
        <CheckCircle2 className="h-9 w-9 text-emerald-400 mx-auto" />
        <div>
          <h1 className="font-display text-xl font-bold text-white">
            Password updated
          </h1>
          <p className="text-xs text-neutral-400 mt-2">
            Your password has been changed and all previous sessions have been signed out.
          </p>
        </div>
        <Button onClick={() => onNavigate('login')} className="w-full h-10">
          Sign in with new password
        </Button>
      </div>
    );
  }

  const onSubmit = async (values: ResetFormValues) => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          token,
          password: values.password,
          confirmPassword: values.confirmPassword,
        }),
      });
      setCompleted(true);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Unable to reset password with this link.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Set a new password
        </h1>
        <p className="text-xs text-neutral-400 mt-1.5">
          Choose a strong password for your DevTrack account.
        </p>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-red-900/70 bg-red-950/40 p-3 text-xs text-red-300 space-y-2"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('forgot-password')}
            className="text-blue-400 hover:underline font-medium pl-6 cursor-pointer block"
          >
            Request a fresh reset link
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <PasswordInput
          id="reset-password"
          label="New Password"
          placeholder="Minimum 8 characters"
          autoComplete="new-password"
          error={errors.password?.message}
          registration={register('password')}
        />
        <PasswordInput
          id="reset-confirm-password"
          label="Confirm New Password"
          placeholder="Re-enter your new password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          registration={register('confirmPassword')}
        />
        <Button type="submit" className="w-full h-10" loading={submitting}>
          Reset Password
        </Button>
      </form>
    </div>
  );
}

function VerifyEmailCard({
  token,
  emailConfigured,
  isSignedIn,
  onVerified,
  onNavigate,
  onContinueWorkspace,
}: {
  token?: string;
  emailConfigured: boolean;
  isSignedIn: boolean;
  onVerified: () => Promise<void>;
  onNavigate: (next: AuthRoute) => void;
  onContinueWorkspace?: () => void;
}) {
  const [verifying, setVerifying] = useState(Boolean(token));
  const [verifiedSuccess, setVerifiedSuccess] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const attemptedTokensRef = useRef<Set<string>>(new Set());

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResendFormValues>({
    resolver: zodResolver(resendVerificationSchema),
    defaultValues: { email: '' },
  });

  useEffect(() => {
    if (!token || attemptedTokensRef.current.has(token)) return;
    attemptedTokensRef.current.add(token);

    let active = true;
    (async () => {
      setVerifying(true);
      setVerifyError(null);
      try {
        await apiFetch('/api/auth/verify-email', {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
        if (!active) return;
        setVerifiedSuccess(true);
        await onVerified();
      } catch (err) {
        if (!active) return;
        setVerifyError(
          err instanceof Error
            ? err.message
            : 'Unable to verify your email address.'
        );
      } finally {
        if (active) setVerifying(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [token, onVerified]);

  const onResend = async (values: ResendFormValues) => {
    setResending(true);
    setResendMessage(null);
    setResendError(null);
    try {
      const res = await apiFetch<{ message: string }>(
        '/api/auth/resend-verification',
        {
          method: 'POST',
          body: JSON.stringify(values),
        }
      );
      setResendMessage(res.message);
    } catch (err) {
      setResendError(
        err instanceof Error
          ? err.message
          : 'Unable to resend verification email.'
      );
    } finally {
      setResending(false);
    }
  };

  if (verifying) {
    return (
      <div className="py-8 text-center space-y-3">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto" />
        <p className="text-sm text-neutral-300">Verifying your email address...</p>
      </div>
    );
  }

  if (verifiedSuccess) {
    return (
      <div className="space-y-5 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto" />
        <div>
          <h1 className="font-display text-xl font-bold text-white">
            Email verified
          </h1>
          <p className="text-xs text-neutral-400 mt-2">
            Your email address has been verified. You can now continue to your DevTrack workspace.
          </p>
        </div>
        {isSignedIn ? (
          <Button
            onClick={() => onContinueWorkspace?.()}
            className="w-full h-10"
          >
            Continue to Dashboard
          </Button>
        ) : (
          <Button onClick={() => onNavigate('login')} className="w-full h-10">
            Sign in to DevTrack
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Email Verification
        </h1>
        <p className="text-xs text-neutral-400 mt-1.5">
          Confirm your email address or request a fresh verification link.
        </p>
      </div>

      {verifyError && (
        <div
          role="alert"
          className="rounded-lg border border-red-900/70 bg-red-950/40 p-3 text-xs text-red-300 flex items-start gap-2"
        >
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <span>{verifyError}</span>
        </div>
      )}

      {!emailConfigured && <EmailConfigBanner />}

      {resendError && (
        <div
          role="alert"
          className="rounded-lg border border-red-900/70 bg-red-950/40 p-3 text-xs text-red-300 flex items-start gap-2"
        >
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <span>{resendError}</span>
        </div>
      )}

      {resendMessage && (
        <div className="rounded-lg border border-emerald-900/70 bg-emerald-950/40 p-3 text-xs text-emerald-300 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>{resendMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onResend)} className="space-y-4">
        <div>
          <label
            htmlFor="verify-email-input"
            className="block text-xs font-medium text-neutral-300 mb-1.5"
          >
            Email Address
          </label>
          <input
            id="verify-email-input"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            {...register('email')}
            className="w-full h-10 rounded-md border border-neutral-800 bg-[#0D0F14] px-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.email && (
            <p className="text-xs text-red-400 mt-1">{errors.email.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full h-10" loading={resending}>
          Resend Verification Email
        </Button>
      </form>

      <div className="text-center">
        {isSignedIn ? (
          <button
            type="button"
            onClick={() => onContinueWorkspace?.()}
            className="text-xs text-blue-400 hover:underline cursor-pointer"
          >
            Continue to Dashboard
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="text-xs text-blue-400 hover:underline cursor-pointer"
          >
            Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}
