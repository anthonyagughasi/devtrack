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
  recordUserFirestoreSync,
  testFirestoreConnection,
} from '../lib/firebase';
import { ApiError, apiFetch } from '../lib/api';
import type { UserProfile } from '../types/app';

export interface AuthConfig {
  emailConfigured: boolean;
  googleConfigured: boolean;
  emailVerificationEnforced: boolean;
}

export interface RegisterResult {
  user: UserProfile;
  requiresVerification: boolean;
  emailConfigured: boolean;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig>({
    emailConfigured: false,
    googleConfigured: true,
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
  const firebaseSyncInFlightRef = useRef<Promise<void> | null>(null);
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

  const syncFirebaseUser = useCallback(
    async (user: FirebaseUser) => {
      if (firebaseSyncInFlightRef.current) {
        return firebaseSyncInFlightRef.current;
      }

      const promise = (async () => {
        try {
          const idToken = await user.getIdToken();
          const data = await apiFetch<{ user: UserProfile }>('/api/auth/google', {
            method: 'POST',
            body: JSON.stringify({ idToken }),
          });
          markSessionHint();
          setProfile(data.user);
          applyTheme(data.user.themePreference === 'light' ? 'light' : 'dark');
          setAuthError(null);
        } catch (err) {
          if (hasSessionHint()) {
            await syncProfile(true);
          }
          if (err instanceof ApiError && (err.status === 404 || err.status >= 500)) {
            setAuthError(err.message);
          }
        } finally {
          firebaseSyncInFlightRef.current = null;
        }
      })();

      firebaseSyncInFlightRef.current = promise;
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
        // Non-fatal fallback to defaults
      }

      try {
        await auth.authStateReady();
      } catch {
        // Continue with session-hint check if Firebase Auth readiness fails
      }

      if (!active) return;

      const currentUser = auth.currentUser;
      setFirebaseUser(currentUser);

      if (currentUser && !signingOutRef.current) {
        await syncFirebaseUser(currentUser);
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
    void testFirestoreConnection();

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      setFirebaseUser(user);
      if (!initializedRef.current) return;
      if (user && !signingOutRef.current) {
        await syncFirebaseUser(user);
      }
    });

    return () => {
      active = false;
      unsub();
    };
  }, [syncProfile, syncFirebaseUser, applyTheme]);

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
      const idToken = await cred.user.getIdToken();
      const data = await apiFetch<{ user: UserProfile }>('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken }),
      });
      markSessionHint();
      setProfile(data.user);
      applyTheme(data.user.themePreference === 'light' ? 'light' : 'dark');
      setAuthError(null);
      if (cred.user.emailVerified) {
        void recordUserFirestoreSync(cred.user.uid).catch(() => undefined);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Google sign-in was cancelled or failed.';
      setAuthError(msg);
      throw err;
    }
  }, [authConfig.googleConfigured, applyTheme]);

  const loginWithEmail = useCallback(
    async (email: string, password: string): Promise<UserProfile> => {
      setAuthError(null);
      const data = await apiFetch<{ user: UserProfile }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      markSessionHint();
      setProfile(data.user);
      applyTheme(data.user.themePreference === 'light' ? 'light' : 'dark');
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
      const result = await apiFetch<RegisterResult>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      if (!result.requiresVerification) {
        markSessionHint();
        setProfile(result.user);
        applyTheme(result.user.themePreference === 'light' ? 'light' : 'dark');
      }
      return result;
    },
    [applyTheme]
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
