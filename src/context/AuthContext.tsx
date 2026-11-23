import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  AppError,
  auth,
  formatClientError,
  googleAuthProvider,
  isFirebaseClientConfigured,
} from '../lib/firebase';
import { registerSchema } from '../lib/validations';
import { syncUserProfile } from '../services/users';
import type { UserProfile } from '../types/app';

export interface AuthConfig {
  firebaseConfigured: boolean;
  googleConfigured: boolean;
  emailConfigured: boolean;
  emailVerificationEnforced: boolean;
}

export interface RegisterResult {
  user: UserProfile;
  requiresVerification: boolean;
  message: string;
}

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string | null;
  authConfig: AuthConfig;
  signInWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<UserProfile>;
  registerWithEmail: (input: {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
  }) => Promise<RegisterResult>;
  requestPasswordReset: (email: string) => Promise<string>;
  resetPasswordWithToken: (
    token: string,
    password: string,
    confirmPassword: string
  ) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  applyTheme: (theme: 'dark' | 'light') => void;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function mapFirebaseAuthError(error: unknown, fallback: string): string {
  if (error instanceof AppError) {
    return error.message;
  }

  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';

  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in instead or use Google Sign-In.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password. Please check your credentials and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact support for assistance.';
    case 'auth/weak-password':
      return 'Password does not meet security requirements. Use at least 8 characters with uppercase, lowercase, and numbers.';
    case 'auth/too-many-requests':
      return 'Too many attempts detected. Please wait a moment before trying again.';
    case 'auth/network-request-failed':
      return 'Network error communicating with Firebase Authentication. Check your connection and try again.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in popup was closed before completing.';
    case 'auth/popup-blocked':
      return 'Sign-in popup was blocked by your browser. Allow popups and try again.';
    case 'auth/cancelled-popup-request':
      return 'Google sign-in request was superseded by another popup.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled in Firebase Authentication Console yet.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized in Firebase Authentication. Add this domain under Firebase Console → Authentication → Settings → Authorized domains.';
    case 'auth/expired-action-code':
      return 'This password reset link has expired. Request a new password reset email.';
    case 'auth/invalid-action-code':
      return 'This password reset link is invalid or has already been used.';
    case 'auth/requires-recent-login':
      return 'For security, please sign out and sign back in before performing this sensitive action.';
    default:
      return formatClientError(error, fallback);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const configured = isFirebaseClientConfigured();
  const [authConfig] = useState<AuthConfig>({
    firebaseConfigured: configured,
    googleConfigured: configured,
    emailConfigured: configured,
    emailVerificationEnforced: false,
  });

  const applyTheme = useCallback((theme: 'dark' | 'light') => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, []);

  const syncLockRef = useRef<Promise<UserProfile | null> | null>(null);
  const signingOutRef = useRef(false);

  const hydrateUserProfile = useCallback(
    async (
      user: FirebaseUser,
      overrides?: { displayName?: string; hasPassword?: boolean },
      throwOnError = false
    ): Promise<UserProfile | null> => {
      const task = (async () => {
        try {
          const synced = await syncUserProfile(user, overrides);
          setProfile(synced);
          applyTheme(synced.themePreference === 'light' ? 'light' : 'dark');
          setAuthError(null);
          return synced;
        } catch (err) {
          const msg = mapFirebaseAuthError(err, 'Failed to load workspace profile.');
          setAuthError(msg);
          if (throwOnError) {
            throw new Error(msg);
          }
          return null;
        }
      })();

      syncLockRef.current = task;
      try {
        return await task;
      } finally {
        if (syncLockRef.current === task) {
          syncLockRef.current = null;
        }
      }
    },
    [applyTheme]
  );

  useEffect(() => {
    let active = true;
    let initialResolved = false;

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      setFirebaseUser(user);

      if (!user || signingOutRef.current) {
        setProfile(null);
        applyTheme('dark');
        setAuthError(null);
        if (!initialResolved) {
          initialResolved = true;
          setLoading(false);
        }
        return;
      }

      if (!syncLockRef.current) {
        await hydrateUserProfile(user);
      } else {
        await syncLockRef.current.catch(() => null);
      }

      if (active && !initialResolved) {
        initialResolved = true;
        setLoading(false);
      }
    });

    return () => {
      active = false;
      unsub();
    };
  }, [applyTheme, hydrateUserProfile]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    if (!authConfig.googleConfigured) {
      const msg = 'Firebase client configuration is missing.';
      setAuthError(msg);
      throw new Error(msg);
    }

    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      setFirebaseUser(cred.user);
      await hydrateUserProfile(cred.user, undefined, true);
    } catch (err) {
      const msg = mapFirebaseAuthError(err, 'Google sign-in did not complete.');
      setAuthError(msg);
      throw new Error(msg);
    }
  }, [authConfig.googleConfigured, hydrateUserProfile]);

  const loginWithEmail = useCallback(
    async (email: string, password: string): Promise<UserProfile> => {
      setAuthError(null);
      try {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        setFirebaseUser(cred.user);
        const userProfile = await hydrateUserProfile(cred.user, { hasPassword: true }, true);
        if (!userProfile) {
          throw new Error('Failed to load workspace profile.');
        }
        return userProfile;
      } catch (err) {
        const msg = mapFirebaseAuthError(err, 'Unable to sign in right now.');
        setAuthError(msg);
        throw new Error(msg);
      }
    },
    [hydrateUserProfile]
  );

  const registerWithEmail = useCallback(
    async (input: {
      name: string;
      email: string;
      password: string;
      confirmPassword: string;
    }): Promise<RegisterResult> => {
      setAuthError(null);
      const parsed = registerSchema.safeParse(input);
      if (!parsed.success) {
        const msg = parsed.error.issues[0]?.message || 'Invalid registration input.';
        setAuthError(msg);
        throw new Error(msg);
      }

      try {
        const cred = await createUserWithEmailAndPassword(
          auth,
          parsed.data.email,
          parsed.data.password
        );
        await updateProfile(cred.user, { displayName: parsed.data.name }).catch(
          () => undefined
        );
        setFirebaseUser(cred.user);
        const synced = await hydrateUserProfile(
          cred.user,
          { displayName: parsed.data.name, hasPassword: true },
          true
        );
        if (!synced) {
          throw new Error('Failed to create user profile.');
        }
        return {
          user: synced,
          requiresVerification: false,
          message: 'Account created and signed in.',
        };
      } catch (err) {
        const msg = mapFirebaseAuthError(err, 'Unable to create account.');
        setAuthError(msg);
        throw new Error(msg);
      }
    },
    [hydrateUserProfile]
  );

  const requestPasswordReset = useCallback(async (email: string): Promise<string> => {
    try {
      await sendPasswordResetEmail(auth, email.trim().toLowerCase(), {
        url: `${window.location.origin}/login`,
        handleCodeInApp: false,
      });
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code ?? '')
          : '';
      // Avoid enumerating unregistered accounts while surfacing config errors
      if (code !== 'auth/user-not-found') {
        throw new Error(mapFirebaseAuthError(err, 'Unable to send password reset email.'));
      }
    }
    return 'If an account exists for that email, a password reset link has been sent. Check your inbox and spam folder.';
  }, []);

  const resetPasswordWithToken = useCallback(
    async (token: string, password: string, confirmPassword: string): Promise<void> => {
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match.');
      }
      try {
        await confirmPasswordReset(auth, token.trim(), password);
      } catch (err) {
        throw new Error(
          mapFirebaseAuthError(err, 'Unable to reset password with this link.')
        );
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    signingOutRef.current = true;
    try {
      await firebaseSignOut(auth).catch(() => undefined);
    } finally {
      setProfile(null);
      setFirebaseUser(null);
      setAuthError(null);
      applyTheme('dark');
      signingOutRef.current = false;
    }
  }, [applyTheme]);

  const refreshProfile = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) {
      setProfile(null);
      return;
    }
    await hydrateUserProfile(current, undefined, false);
  }, [hydrateUserProfile]);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        loading,
        authError,
        authConfig,
        signInWithGoogle,
        loginWithEmail,
        registerWithEmail,
        requestPasswordReset,
        resetPasswordWithToken,
        signOut,
        refreshProfile,
        applyTheme,
        clearAuthError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
