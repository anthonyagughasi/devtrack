# DevTrack

Project management and team collaboration platform built for software engineering teams, freelancers, and development agencies.

## Architecture

- **Frontend**: React 19, TypeScript (`strict: true`), Tailwind CSS v4, Lucide React, Recharts, React Hook Form, Zod, `@dnd-kit`
- **Backend**: Express + Vite full-stack server (`server.ts`) and Vercel serverless handler (`api/index.mjs`)
- **Database**: **Neon PostgreSQL** via **Drizzle ORM** (`src/db/schema.ts`, `src/db/index.ts`, configured via `DATABASE_URL`)
- **Authentication**: **Firebase Authentication** (Email/Password registration & login, Google OAuth, Password Reset) with server-side ID token verification (`firebase-admin`) and persistent session sync

## Core Capabilities

- **Projects & Dynamic Progress**: Create, search, filter, edit, archive, and delete projects with task-calculated progress percentages.
- **Persistent Kanban Board**: Drag-and-drop tasks across `To Do`, `In Progress`, and `Completed` with optimistic UI updates that revert automatically on server errors.
- **Team & RBAC**: Server-enforced `OWNER`, `ADMINISTRATOR`, and `MEMBER` permissions, in-app invitations, and member workload summaries.
- **Comments, Activity & Notifications**: Persistent task comment threads, chronological server-generated activity audit logs, and in-app notifications including 48-hour approaching deadline alerts.
- **Live Analytics Dashboard**: Real-time PostgreSQL aggregations rendered with Recharts across selectable date windows (`7D`, `14D`, `30D`, `90D`).
- **User Settings**: Profile editing, avatar selection, persisted Dark/Light theme switching, password management, and granular notification preferences.

## Scripts

- `npm run dev` — Run the full-stack Express + Vite server on port `3000`
- `npm run build` — Build frontend bundle (`dist/`), server bundle (`server.js`), and Vercel API bundle (`api/_server.mjs`)
- `npm run start` — Run production server (`node server.js`)
- `npm run db:push` — Push Drizzle PostgreSQL schema to Neon (`DATABASE_URL`)
- `npm run db:generate` — Generate Drizzle SQL migrations
- `npm run lint` — TypeScript strict type-checking (`tsc --noEmit`)
- `npm run test` — Run automated Vitest suite (`vitest run`)
