import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  auth,
  googleAuthProvider,
  isFirebaseClientConfigured,
  recordUserFirestoreSync,
} from '../lib/firebase';
import { ApiError, apiFetch } from '../lib/api';
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
  resetPasswordWithToken: (token: string, password: string, confirmPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  applyTheme: (theme: 'dark' | 'light') => void;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_HINT_KEY = 'devtrack_session_hint';

function hasSessionHint(): boolean {
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function markSessionHint(): void {
  try {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
  } catch {
    // Ignore storage errors in restricted private browsing modes
  }
}

function clearSessionHint(): void {
  try {
    window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Ignore storage errors in restricted private browsing modes
  }
}

export function mapFirebaseAuthError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';

  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Google sign-in popup was closed before completing.';
    case 'auth/popup-blocked':
      return 'Sign-in popup was blocked by your browser. Please allow popups and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method.';
    case 'auth/operation-not-allowed':
      return 'Google Sign-In is not enabled in Firebase Authentication yet.';
    default:
      return error instanceof Error && error.message ? error.message : fallback;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig>({
    firebaseConfigured: isFirebaseClientConfigured(),
    googleConfigured: isFirebaseClientConfigured(),
    emailConfigured: false,
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

  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const googleSyncInFlightRef = useRef<Promise<UserProfile | null> | null>(null);
  const initializedRef = useRef(false);
  const signingOutRef = useRef(false);

  const syncProfile = useCallback(
    async (silent401 = false) => {
      if (syncInFlightRef.current) {
        return syncInFlightRef.current;
      }

      const promise = (async () => {
        try {
          const data = await apiFetch<{ user: UserProfile }>('/api/me');
          markSessionHint();
          setProfile(data.user);
          applyTheme(data.user.themePreference === 'light' ? 'light' : 'dark');
          setAuthError(null);
        } catch (err) {
          if (err instanceof ApiError && err.status === 401 && silent401) {
            clearSessionHint();
            setProfile(null);
            applyTheme('dark');
            setAuthError(null);
          } else {
            console.error('Failed to sync profile:', err);
            setAuthError(
              err instanceof Error ? err.message : 'Failed to load user profile.'
            );
          }
        } finally {
          syncInFlightRef.current = null;
        }
      })();

      syncInFlightRef.current = promise;
      return promise;
    },
    [applyTheme]
  );

  const syncGoogleSession = useCallback(
    async (
      user: FirebaseUser,
      options?: { forceTokenRefresh?: boolean; throwOnError?: boolean }
    ): Promise<UserProfile | null> => {
      if (googleSyncInFlightRef.current && !options?.throwOnError) {
        return googleSyncInFlightRef.current;
      }

      const promise = (async () => {
        try {
          const idToken = await user.getIdToken(Boolean(options?.forceTokenRefresh));
          const data = await apiFetch<{ user: UserProfile }>('/api/auth/google', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ idToken }),
          });
          markSessionHint();
          setProfile(data.user);
          applyTheme(data.user.themePreference === 'light' ? 'light' : 'dark');
          setAuthError(null);
          void recordUserFirestoreSync(user, 'active');
          return data.user;
        } catch (err) {
          if (options?.throwOnError) {
            throw err;
          }
          if (hasSessionHint()) {
            await syncProfile(true);
          }
          if (err instanceof ApiError && (err.status === 404 || err.status === 409 || err.status >= 500)) {
            setAuthError(err.message);
          }
          return null;
        } finally {
          googleSyncInFlightRef.current = null;
        }
      })();

      googleSyncInFlightRef.current = promise;
      return promise;
    },
    [applyTheme, syncProfile]
  );

  useEffect(() => {
    let active = true;

    const init = async () => {
      try {
        const cfg = await apiFetch<AuthConfig>('/api/auth/config');
        if (active) setAuthConfig(cfg);
      } catch {
        // Non-fatal fallback to client Firebase config
      }

      try {
        await auth.authStateReady();
      } catch {
        // Continue with cookie session check if Firebase readiness fails
      }

      if (!active) return;

      const currentUser = auth.currentUser;
      setFirebaseUser(currentUser);

      if (currentUser && !signingOutRef.current) {
        await syncGoogleSession(currentUser);
      } else if (hasSessionHint()) {
        await syncProfile(true);
      } else {
        setProfile(null);
        applyTheme('dark');
        setAuthError(null);
      }

      if (active) {
        initializedRef.current = true;
        setLoading(false);
      }
    };

    init();

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      setFirebaseUser(user);
      if (!initializedRef.current) return;
      if (user && !signingOutRef.current) {
        await syncGoogleSession(user);
      }
    });

    return () => {
      active = false;
      unsub();
    };
  }, [syncProfile, syncGoogleSession, applyTheme]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    if (!authConfig.googleConfigured) {
      const msg =
        'Google Sign-In is not configured for this workspace. Use email and password sign-in instead.';
      setAuthError(msg);
      throw new Error(msg);
    }

    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      await syncGoogleSession(cred.user, { throwOnError: true });
    } catch (err: unknown) {
      const msg = mapFirebaseAuthError(err, 'Google sign-in was cancelled or failed.');
      setAuthError(msg);
      throw new Error(msg);
    }
  }, [authConfig.googleConfigured, syncGoogleSession]);

  const loginWithEmail = useCallback(
    async (email: string, password: string): Promise<UserProfile> => {
      setAuthError(null);
      const data = await apiFetch<{ user: UserProfile }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      markSessionHint();
      setProfile(data.user);
      applyTheme(data.user.themePreference === 'light' ? 'light' : 'dark');
      setAuthError(null);
      return data.user;
    },
    [applyTheme]
  );

  const registerWithEmail = useCallback(
    async (input: {
      name: string;
      email: string;
      password: string;
      confirmPassword: string;
    }): Promise<RegisterResult> => {
      setAuthError(null);
      const data = await apiFetch<RegisterResult>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: input.name.trim(),
          email: input.email.trim(),
          password: input.password,
          confirmPassword: input.confirmPassword,
        }),
      });
      markSessionHint();
      setProfile(data.user);
      applyTheme(data.user.themePreference === 'light' ? 'light' : 'dark');
      setAuthError(null);
      return data;
    },
    [applyTheme]
  );

  const requestPasswordReset = useCallback(async (email: string): Promise<string> => {
    const res = await apiFetch<{ message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim() }),
    });
    return res.message;
  }, []);

  const resetPasswordWithToken = useCallback(
    async (token: string, password: string, confirmPassword: string): Promise<void> => {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: token.trim(), password, confirmPassword }),
      });
    },
    []
  );

  const signOut = useCallback(async () => {
    signingOutRef.current = true;
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      if (auth.currentUser) {
        await firebaseSignOut(auth).catch(() => undefined);
      }
    } finally {
      clearSessionHint();
      setProfile(null);
      setFirebaseUser(null);
      setAuthError(null);
      applyTheme('dark');
      signingOutRef.current = false;
    }
  }, [applyTheme]);

  const refreshProfile = useCallback(async () => {
    await syncProfile(false);
  }, [syncProfile]);

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
