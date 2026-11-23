import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '../..');
const servicesDir = path.join(rootDir, 'src/services');
const rulesContent = fs.readFileSync(path.join(rootDir, 'firestore.rules'), 'utf8');

describe('Firestore security rules & query contract', () => {
  it('never issues unfiltered getDocs(collection(...)) calls in src/services', () => {
    const serviceFiles = fs
      .readdirSync(servicesDir)
      .filter((name) => name.endsWith('.ts'));

    const bareCollectionQueryRegex = /getDocs\(\s*collection\(/g;
    const violations: string[] = [];

    for (const file of serviceFiles) {
      const content = fs.readFileSync(path.join(servicesDir, file), 'utf8');
      if (bareCollectionQueryRegex.test(content)) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });

  it('constrains every projectRefs and notifications list query by userId', () => {
    const targetFiles = ['projects.ts', 'notifications.ts', 'users.ts'];
    for (const file of targetFiles) {
      const content = fs.readFileSync(path.join(servicesDir, file), 'utf8');
      const projectRefsMatches = content.match(
        /collection\(firestoreDb,\s*'users',\s*[^,]+,\s*'projectRefs'\)/g
      );
      if (projectRefsMatches) {
        expect(content).toMatch(/where\('userId',\s*'==',/);
      }
    }

    const notificationsContent = fs.readFileSync(
      path.join(servicesDir, 'notifications.ts'),
      'utf8'
    );
    expect(notificationsContent).not.toMatch(/where\('read',\s*'==',\s*false\)/);
    expect(notificationsContent).not.toMatch(/where\('assigneeId',\s*'==',/);
    expect(notificationsContent).toMatch(/where\('userId',\s*'==',\s*profile\.uid\)/);
    expect(notificationsContent).toMatch(/where\('userId',\s*'==',\s*userId\)/);
  });

  it('constrains every project subcollection list query by projectId', () => {
    const projectScopedFiles = [
      'dashboard.ts',
      'projects.ts',
      'tasks.ts',
      'team.ts',
      'activity.ts',
      'notifications.ts',
    ];

    for (const file of projectScopedFiles) {
      const content = fs.readFileSync(path.join(servicesDir, file), 'utf8');
      expect(content).toMatch(/where\('projectId',\s*'==',/);
    }

    const teamContent = fs.readFileSync(path.join(servicesDir, 'team.ts'), 'utf8');
    expect(teamContent).not.toMatch(/where\('assigneeId',\s*'==',/);
  });

  it('keeps strict owner and project membership checks in firestore.rules', () => {
    expect(rulesContent).toContain(
      'allow list: if isSignedIn() && isOwner(userId) && resource.data.userId == request.auth.uid;'
    );
    expect(rulesContent).toContain(
      'allow list: if isSignedIn() && resource.data.projectId == projectId && isProjectMember(projectId);'
    );
    expect(rulesContent).toContain(
      'allow get: if isSignedIn() && isValidId(projectId) && isValidId(memberId) && (isProjectMember(projectId) || memberId == request.auth.uid);'
    );
    expect(rulesContent).not.toMatch(/allow read, write:\s*if true/);
  });
});
