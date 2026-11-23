# DevTrack

Project management and team collaboration platform built for software engineering teams, freelancers, and development agencies.

## Architecture

- **Frontend**: React 19, TypeScript (`strict: true`), Tailwind CSS v4, Lucide React, Recharts, React Hook Form, Zod, `@dnd-kit`
- **Authentication**: **Firebase Authentication** (`firebase-applet-config.json`) supporting Email/Password registration & login, Google Sign-In, persistent sessions, and password reset emails
- **Database**: **Cloud Firestore** (`ai-studio-4e7b9940-78ae-415f-b5d7-c78ccb48710d` in project `spatial-campaign-nlvvl`) secured by hardened `firestore.rules`
- **Hosting**: Static Vite SPA deployed on **Vercel** (`dist/` + `vercel.json` SPA rewrites)

## Core Capabilities

- **Projects & Dynamic Progress**: Create, search, filter, edit, archive, and delete projects with task-calculated progress percentages.
- **Persistent Kanban Board**: Drag-and-drop tasks across `To Do`, `In Progress`, and `Completed` with optimistic UI updates that revert cleanly on errors.
- **Team & RBAC**: Enforced `OWNER`, `ADMINISTRATOR`, and `MEMBER` permissions, in-app project invitations, and member workload summaries.
- **Comments, Activity & Notifications**: Persistent task comment threads, chronological activity audit logs, and in-app notifications including 48-hour approaching deadline alerts.
- **Live Analytics Dashboard**: Workspace aggregations rendered with Recharts across selectable date windows (`7D`, `14D`, `30D`, `90D`).
- **User Settings**: Profile editing, client-side compressed avatar upload, persisted Dark/Light theme switching, password management, and granular notification preferences.

## Scripts

- `npm run dev` — Run Vite development server on port `3000`
- `npm run build` — Build production bundle in `dist/`
- `npm run start` — Preview production bundle on port `3000`
- `npm run lint` — TypeScript strict type-checking (`tsc --noEmit`)
- `npm run lint:rules` — Validate `firestore.rules` with `@firebase/eslint-plugin-security-rules`
- `npm run test` — Run automated Vitest suite (`vitest run`)
