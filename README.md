# DevTrack

Project management and team collaboration platform built for software engineering teams, freelancers, and development agencies.

## Architecture (Native AI Studio Stack)

- **Frontend**: React 19, TypeScript (`strict: true`), Tailwind CSS v4, Lucide React, Recharts, React Hook Form, Zod, `@dnd-kit`
- **Backend**: Express + Vite full-stack server (`server.ts`)
- **Database**: PostgreSQL (Google Cloud SQL) via **Drizzle ORM** (`src/db/schema.ts`, `src/db/index.ts`)
- **Authentication**: Firebase Authentication (Google Sign-In) with server-side ID token verification (`firebase-admin`)

## Core Capabilities

- **Projects & Dynamic Progress**: Create, search, filter, edit, archive, and delete projects with task-calculated progress percentages.
- **Persistent Kanban Board**: Drag-and-drop tasks across `To Do`, `In Progress`, and `Completed` with optimistic UI updates that revert automatically on server errors.
- **Team & RBAC**: Server-enforced `OWNER`, `ADMINISTRATOR`, and `MEMBER` permissions, single-use expiring invitation tokens, and member workload summaries.
- **Comments, Activity & Notifications**: Persistent task comment threads, chronological server-generated activity audit logs, and in-app notifications including 48-hour approaching deadline alerts.
- **Live Analytics Dashboard**: Real-time PostgreSQL aggregations rendered with Recharts across selectable date windows (`7D`, `14D`, `30D`, `90D`).
- **User Settings**: Profile editing, avatar selection, persisted Dark/Light theme switching, and granular notification preferences.

## Scripts

- `npm run dev` — Run the full-stack Express + Vite server on port `3000`
- `npm run build` — Build frontend bundle (`dist/`) and server bundle (`server.js`)
- `npm run start` — Run production server (`node server.js`)
- `npm run lint` — TypeScript strict type-checking (`tsc --noEmit`)
- `npm run test` — Run automated Vitest suite (`vitest run`)
