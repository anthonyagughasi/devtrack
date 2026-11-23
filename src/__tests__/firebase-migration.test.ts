import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapFirebaseAuthError } from '../context/AuthContext';
import { AppError, formatClientError } from '../lib/firebase';
import { generateSecureToken, normalizeDateIsoInput } from '../services/firestore-helpers';

describe('Firebase auth and error handling utilities', () => {
  it('maps Firebase Auth error codes to user-friendly messages', () => {
    expect(
      mapFirebaseAuthError({ code: 'auth/email-already-in-use' }, 'fallback')
    ).toContain('already exists');

    expect(
      mapFirebaseAuthError({ code: 'auth/wrong-password' }, 'fallback')
    ).toContain('Invalid email or password');

    expect(
      mapFirebaseAuthError({ code: 'auth/unauthorized-domain' }, 'fallback')
    ).toContain('Authorized domains');

    expect(
      mapFirebaseAuthError({ code: 'auth/expired-action-code' }, 'fallback')
    ).toContain('expired');
  });

  it('formats structured Firestore and AppError messages safely', () => {
    expect(formatClientError(new AppError(403, 'Custom forbidden'), 'fallback')).toBe(
      'Custom forbidden'
    );
    expect(
      formatClientError(
        new Error(
          JSON.stringify({
            error: 'Missing or insufficient permissions.',
            operationType: 'get',
            path: 'projects/abc',
          })
        ),
        'fallback'
      )
    ).toBe('You do not have permission to perform this action.');
  });

  it('generates cryptographically sized hex tokens and normalizes ISO dates', () => {
    const token = generateSecureToken(24);
    expect(token).toMatch(/^[a-f0-9]{48}$/);

    expect(normalizeDateIsoInput('2026-12-01T12:00:00Z')).toBe('2026-12-01T12:00:00.000Z');
    expect(normalizeDateIsoInput('not-a-date')).toBeNull();
    expect(normalizeDateIsoInput(null)).toBeNull();
  });
});

describe('Firebase migration & Vercel SPA hygiene', () => {
  const rootDir = path.resolve(__dirname, '../..');

  it('configures Vercel as a static SPA without PostgreSQL or Drizzle dependencies', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps).not.toContain('drizzle-orm');
    expect(deps).not.toContain('pg');
    expect(deps).not.toContain('@google-cloud/cloud-sql-connector');
    expect(deps).not.toContain('firebase-admin');
    expect(deps).not.toContain('express');
    expect(pkg.scripts?.build).toBe('vite build');

    const vercelConfig = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf8')
    ) as { outputDirectory?: string; rewrites?: Array<{ source: string; destination: string }> };
    expect(vercelConfig.outputDirectory).toBe('dist');
    expect(vercelConfig.rewrites?.[0]?.destination).toBe('/index.html');
  });

  it('contains no legacy SQL or server files', () => {
    expect(fs.existsSync(path.join(rootDir, 'server.ts'))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, 'src/db'))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, 'src/server'))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, 'src/lib/api.ts'))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, 'firestore.rules'))).toBe(true);
  });
});
