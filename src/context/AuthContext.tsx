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
import { auth, googleAuthProvider } from '../lib/firebase';
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
  const signingOutRef = useRef(false);

  const syncProfile = useCallback(
    async (silent401 = false) => {
      if (syncInFlightRef.current) {
        return syncInFlightRef.current;
      }

      const promise = (async () => {
        try {
          const data = await apiFetch<{ user: UserProfile }>('/api/me');
          setProfile(data.user);
          applyTheme(data.user.themePreference === 'light' ? 'light' : 'dark');
          setAuthError(null);
        } catch (err) {
          if (err instanceof ApiError && err.status === 401 && silent401) {
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

  useEffect(() => {
    let active = true;

    const init = async () => {
      try {
        const cfg = await apiFetch<AuthConfig>('/api/auth/config');
        if (active) setAuthConfig(cfg);
      } catch {
        // Non-fatal fallback to defaults
      }

      await syncProfile(true);
      if (active) setLoading(false);
    };

    init();

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      setFirebaseUser(user);
      if (user && !signingOutRef.current) {
        try {
          const idToken = await user.getIdToken();
          const data = await apiFetch<{ user: UserProfile }>('/api/auth/google', {
            method: 'POST',
            body: JSON.stringify({ idToken }),
          });
          if (!active) return;
          setProfile(data.user);
          applyTheme(data.user.themePreference === 'light' ? 'light' : 'dark');
          setAuthError(null);
        } catch (err) {
          if (!active) return;
          // Fall back to /api/me if cookie session exists
          await syncProfile(true);
          if (err instanceof ApiError && err.status >= 500) {
            setAuthError(err.message);
          }
        }
      }
    });

    return () => {
      active = false;
      unsub();
    };
  }, [syncProfile, applyTheme]);

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
      setProfile(data.user);
      applyTheme(data.user.themePreference === 'light' ? 'light' : 'dark');
      setAuthError(null);
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
