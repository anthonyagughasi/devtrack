var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server.ts
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import fs2 from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ZodError } from "zod";

// src/db/index.ts
import fs from "fs";
import {
  AuthTypes,
  Connector,
  GoogleAuth,
  IpAddressTypes
} from "@google-cloud/cloud-sql-connector";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// src/db/schema.ts
var schema_exports = {};
__export(schema_exports, {
  activityLogs: () => activityLogs,
  activityLogsRelations: () => activityLogsRelations,
  emailVerificationTokens: () => emailVerificationTokens,
  invitations: () => invitations,
  invitationsRelations: () => invitationsRelations,
  notifications: () => notifications,
  notificationsRelations: () => notificationsRelations,
  oauthAccounts: () => oauthAccounts,
  oauthAccountsRelations: () => oauthAccountsRelations,
  passwordResetTokens: () => passwordResetTokens,
  projectMembers: () => projectMembers,
  projectMembersRelations: () => projectMembersRelations,
  projects: () => projects,
  projectsRelations: () => projectsRelations,
  sessions: () => sessions,
  sessionsRelations: () => sessionsRelations,
  taskComments: () => taskComments,
  taskCommentsRelations: () => taskCommentsRelations,
  tasks: () => tasks,
  tasksRelations: () => tasksRelations,
  users: () => users,
  usersRelations: () => usersRelations
});
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";
var users = pgTable("users", {
  id: serial("id").primaryKey(),
  uid: text("uid").notNull().unique(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  emailVerifiedAt: timestamp("email_verified_at"),
  avatar: text("avatar"),
  role: text("role").notNull().default("USER"),
  themePreference: text("theme_preference").notNull().default("dark"),
  notifyOnAssign: boolean("notify_on_assign").notNull().default(true),
  notifyOnComment: boolean("notify_on_comment").notNull().default(true),
  notifyOnInvite: boolean("notify_on_invite").notNull().default(true),
  notifyOnDeadline: boolean("notify_on_deadline").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    provider: text("provider").notNull(),
    // 'google'
    providerAccountId: text("provider_account_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("oauth_accounts_provider_account_idx").on(
      table.provider,
      table.providerAccountId
    ),
    index("oauth_accounts_user_idx").on(table.userId)
  ]
);
var sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
    index("sessions_expires_idx").on(table.expiresAt)
  ]
);
var passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("password_reset_tokens_user_idx").on(table.userId),
    index("password_reset_tokens_expires_idx").on(table.expiresAt)
  ]
);
var emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("email_verification_tokens_user_idx").on(table.userId),
    index("email_verification_tokens_expires_idx").on(table.expiresAt)
  ]
);
var projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("PLANNING"),
    // PLANNING | ACTIVE | ON_HOLD | COMPLETED | ARCHIVED
    startDate: timestamp("start_date"),
    deadline: timestamp("deadline"),
    ownerId: integer("owner_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("projects_owner_idx").on(table.ownerId),
    index("projects_status_idx").on(table.status)
  ]
);
var projectMembers = pgTable(
  "project_members",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    role: text("role").notNull().default("MEMBER"),
    // OWNER | ADMINISTRATOR | MEMBER
    joinedAt: timestamp("joined_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("project_members_project_user_idx").on(table.projectId, table.userId),
    index("project_members_user_idx").on(table.userId),
    index("project_members_project_idx").on(table.projectId)
  ]
);
var tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("TODO"),
    // TODO | IN_PROGRESS | COMPLETED
    priority: text("priority").notNull().default("MEDIUM"),
    // LOW | MEDIUM | HIGH | URGENT
    position: integer("position").notNull().default(0),
    dueDate: timestamp("due_date"),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
    assigneeId: integer("assignee_id").references(() => users.id, {
      onDelete: "set null"
    }),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at")
  },
  (table) => [
    index("tasks_project_idx").on(table.projectId),
    index("tasks_assignee_idx").on(table.assigneeId),
    index("tasks_status_idx").on(table.status),
    index("tasks_due_date_idx").on(table.dueDate)
  ]
);
var taskComments = pgTable(
  "task_comments",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "cascade" }).notNull(),
    authorId: integer("author_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("task_comments_task_idx").on(table.taskId),
    index("task_comments_author_idx").on(table.authorId)
  ]
);
var activityLogs = pgTable(
  "activity_logs",
  {
    id: serial("id").primaryKey(),
    actorId: integer("actor_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "cascade"
    }),
    taskId: integer("task_id").references(() => tasks.id, {
      onDelete: "set null"
    }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    // PROJECT | TASK | COMMENT | MEMBER | INVITATION
    resourceName: text("resource_name").notNull(),
    details: text("details"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("activity_logs_project_idx").on(table.projectId),
    index("activity_logs_actor_idx").on(table.actorId),
    index("activity_logs_created_idx").on(table.createdAt)
  ]
);
var invitations = pgTable(
  "invitations",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
    email: text("email").notNull(),
    role: text("role").notNull().default("MEMBER"),
    // ADMINISTRATOR | MEMBER
    token: text("token").notNull().unique(),
    invitedById: integer("invited_by_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    status: text("status").notNull().default("PENDING"),
    // PENDING | ACCEPTED | REVOKED | EXPIRED
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("invitations_project_idx").on(table.projectId),
    index("invitations_email_idx").on(table.email),
    uniqueIndex("invitations_token_idx").on(table.token)
  ]
);
var notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    type: text("type").notNull(),
    // TASK_ASSIGNED | TASK_UPDATED | TASK_COMMENT | PROJECT_INVITATION | DEADLINE_APPROACHING
    title: text("title").notNull(),
    message: text("message").notNull(),
    link: text("link"),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("notifications_user_idx").on(table.userId),
    index("notifications_read_idx").on(table.read)
  ]
);
var usersRelations = relations(users, ({ many }) => ({
  ownedProjects: many(projects),
  memberships: many(projectMembers),
  assignedTasks: many(tasks, { relationName: "taskAssignee" }),
  createdTasks: many(tasks, { relationName: "taskCreator" }),
  comments: many(taskComments),
  activities: many(activityLogs),
  notifications: many(notifications),
  oauthAccounts: many(oauthAccounts),
  sessions: many(sessions)
}));
var oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({
  user: one(users, {
    fields: [oauthAccounts.userId],
    references: [users.id]
  })
}));
var sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id]
  })
}));
var projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.id]
  }),
  members: many(projectMembers),
  tasks: many(tasks),
  activities: many(activityLogs),
  invitations: many(invitations)
}));
var projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id]
  }),
  user: one(users, {
    fields: [projectMembers.userId],
    references: [users.id]
  })
}));
var tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id]
  }),
  assignee: one(users, {
    fields: [tasks.assigneeId],
    references: [users.id],
    relationName: "taskAssignee"
  }),
  createdBy: one(users, {
    fields: [tasks.createdById],
    references: [users.id],
    relationName: "taskCreator"
  }),
  comments: many(taskComments),
  activities: many(activityLogs)
}));
var taskCommentsRelations = relations(taskComments, ({ one }) => ({
  task: one(tasks, {
    fields: [taskComments.taskId],
    references: [tasks.id]
  }),
  author: one(users, {
    fields: [taskComments.authorId],
    references: [users.id]
  })
}));
var activityLogsRelations = relations(activityLogs, ({ one }) => ({
  actor: one(users, {
    fields: [activityLogs.actorId],
    references: [users.id]
  }),
  project: one(projects, {
    fields: [activityLogs.projectId],
    references: [projects.id]
  }),
  task: one(tasks, {
    fields: [activityLogs.taskId],
    references: [tasks.id]
  })
}));
var invitationsRelations = relations(invitations, ({ one }) => ({
  project: one(projects, {
    fields: [invitations.projectId],
    references: [projects.id]
  }),
  invitedBy: one(users, {
    fields: [invitations.invitedById],
    references: [users.id]
  })
}));
var notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id]
  })
}));

// src/server/errors.ts
var AppError = class extends Error {
  constructor(statusCode, message, options) {
    super(message, options);
    this.statusCode = statusCode;
    this.name = "AppError";
  }
};
function isAppError(error) {
  return error instanceof AppError;
}
function extractDatabaseErrorDetails(error) {
  const queue = [error];
  const seen = /* @__PURE__ */ new Set();
  let fallbackMessage = error instanceof Error ? error.message : String(error ?? "");
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const record = current;
    if (typeof record.message === "string" && record.message.trim() && !fallbackMessage) {
      fallbackMessage = record.message.trim();
    }
    if (typeof record.code === "string" && record.code.trim()) {
      return {
        code: record.code.trim(),
        constraint: typeof record.constraint === "string" ? record.constraint : void 0,
        message: typeof record.message === "string" ? record.message : fallbackMessage
      };
    }
    if (record.cause) queue.push(record.cause);
    if (Array.isArray(record.errors)) {
      for (const inner of record.errors) {
        queue.push(inner);
      }
    }
  }
  return { message: fallbackMessage };
}
function mapDatabaseError(error, options) {
  if (isAppError(error)) return error;
  const details = extractDatabaseErrorDetails(error);
  const code = details.code ?? "";
  const lowerMsg = details.message.toLowerCase();
  if (code === "23505") {
    return new AppError(
      409,
      options?.duplicateMessage ?? "A record with this unique value already exists.",
      { cause: error }
    );
  }
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT" || code === "ECONNRESET" || code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "ENOENT" || code === "57P01" || code === "57P03" || lowerMsg.includes("connection terminated") || lowerMsg.includes("timeout exceeded when trying to connect")) {
    return new AppError(
      503,
      "Cloud SQL database is unavailable. Verify CLOUD_SQL_CONNECTION_NAME / SQL_HOST, network access, and SSL configuration.",
      { cause: error }
    );
  }
  if (code === "28P01" || code === "28000") {
    return new AppError(
      503,
      "Database authentication failed. Check SQL_USER and SQL_PASSWORD in server environment variables.",
      { cause: error }
    );
  }
  if (code === "3D000") {
    return new AppError(
      503,
      "Configured database does not exist. Verify SQL_DB_NAME in server environment variables.",
      { cause: error }
    );
  }
  if (code === "42P01") {
    return new AppError(
      503,
      "Database tables are not initialized. Push the schema to the configured Cloud SQL database.",
      { cause: error }
    );
  }
  return null;
}

// src/db/index.ts
function readEnv(key) {
  const val = process.env[key]?.trim();
  return val || void 0;
}
function normalizePem(raw) {
  return raw.replace(/\\n/g, "\n").trim();
}
function getCloudSqlConnectionName() {
  return readEnv("CLOUD_SQL_CONNECTION_NAME") ?? readEnv("SQL_INSTANCE_CONNECTION_NAME");
}
function resolveConnectorIpType() {
  const raw = readEnv("CLOUD_SQL_IP_TYPE")?.toUpperCase();
  switch (raw) {
    case "PRIVATE":
      return IpAddressTypes.PRIVATE;
    case "PSC":
      return IpAddressTypes.PSC;
    case "SQL_DATA":
      return IpAddressTypes.SQL_DATA;
    default:
      return IpAddressTypes.PUBLIC;
  }
}
function parseServiceAccountCredentials(rawJson) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("GCP_SERVICE_ACCOUNT_KEY is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
    throw new Error(
      'GCP_SERVICE_ACCOUNT_KEY must include valid service account "client_email" and "private_key" fields.'
    );
  }
  const record = { ...parsed };
  record.private_key = normalizePem(String(record.private_key));
  return record;
}
function isUnixSocketHost(host) {
  return Boolean(host && host.startsWith("/"));
}
function getDatabaseConfigurationError() {
  const connectionName = getCloudSqlConnectionName();
  const sqlHost = readEnv("SQL_HOST");
  const sqlUser = readEnv("SQL_USER");
  const sqlPassword = readEnv("SQL_PASSWORD");
  const sqlDbName = readEnv("SQL_DB_NAME");
  const missingCreds = [];
  if (!sqlUser) missingCreds.push("SQL_USER");
  if (!sqlPassword) missingCreds.push("SQL_PASSWORD");
  if (!sqlDbName) missingCreds.push("SQL_DB_NAME");
  if (!connectionName && !sqlHost) {
    missingCreds.unshift("CLOUD_SQL_CONNECTION_NAME (or SQL_HOST)");
    return `Cloud SQL database is not configured. Missing server environment variables: ${missingCreds.join(", ")}.`;
  }
  if (missingCreds.length > 0) {
    return `Cloud SQL database configuration is incomplete. Missing server environment variables: ${missingCreds.join(", ")}.`;
  }
  if (connectionName) {
    if (!/^[^:\s]+:[^:\s]+:[^:\s]+$/.test(connectionName)) {
      return 'CLOUD_SQL_CONNECTION_NAME must use the format "<project-id>:<region>:<instance-name>".';
    }
    const saJson = readEnv("GCP_SERVICE_ACCOUNT_KEY");
    if (saJson) {
      try {
        parseServiceAccountCredentials(saJson);
      } catch (err) {
        return err instanceof Error ? err.message : "GCP_SERVICE_ACCOUNT_KEY is invalid.";
      }
    }
    return null;
  }
  if (isUnixSocketHost(sqlHost)) {
    if (process.env.VERCEL || !fs.existsSync(sqlHost)) {
      return `Cloud SQL Auth Proxy Unix socket (${sqlHost}) is not reachable in this runtime. Run inside Google AI Studio / Cloud Run with the mounted socket, or configure CLOUD_SQL_CONNECTION_NAME (with Application Default Credentials or GCP_SERVICE_ACCOUNT_KEY) or Public IP + SQL_SSL_CA.`;
    }
    return null;
  }
  const rawPort = readEnv("SQL_PORT");
  if (rawPort) {
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return "SQL_PORT must be a valid TCP port between 1 and 65535.";
    }
  }
  return null;
}
function assertDatabaseConfigured() {
  const error = getDatabaseConfigurationError();
  if (error) {
    throw new AppError(503, error);
  }
}
function resolveTcpSslConfig(host) {
  if (!host || isUnixSocketHost(host)) {
    return void 0;
  }
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "::1") {
    const explicitMode = readEnv("SQL_SSL_MODE")?.toLowerCase();
    if (!explicitMode || explicitMode === "disable") {
      return void 0;
    }
  }
  const sslMode = readEnv("SQL_SSL_MODE")?.toLowerCase();
  if (sslMode === "disable") {
    return void 0;
  }
  const ca = readEnv("SQL_SSL_CA");
  const cert = readEnv("SQL_SSL_CERT");
  const key = readEnv("SQL_SSL_KEY");
  if (sslMode === "no-verify") {
    return {
      rejectUnauthorized: false,
      ...ca ? { ca: normalizePem(ca) } : {},
      ...cert ? { cert: normalizePem(cert) } : {},
      ...key ? { key: normalizePem(key) } : {}
    };
  }
  return {
    rejectUnauthorized: true,
    ...ca ? { ca: normalizePem(ca) } : {},
    ...cert ? { cert: normalizePem(cert) } : {},
    ...key ? { key: normalizePem(key) } : {}
  };
}
function computePoolConfigKey() {
  return JSON.stringify({
    connectionName: getCloudSqlConnectionName() ?? null,
    ipType: readEnv("CLOUD_SQL_IP_TYPE") ?? "PUBLIC",
    hasSaKey: Boolean(readEnv("GCP_SERVICE_ACCOUNT_KEY")),
    host: readEnv("SQL_HOST") ?? null,
    port: readEnv("SQL_PORT") ?? "5432",
    user: readEnv("SQL_USER") ?? null,
    db: readEnv("SQL_DB_NAME") ?? null,
    sslMode: readEnv("SQL_SSL_MODE") ?? null,
    hasCa: Boolean(readEnv("SQL_SSL_CA")),
    vercel: Boolean(process.env.VERCEL)
  });
}
function buildDirectObjectPoolConfig() {
  const sqlHost = readEnv("SQL_HOST");
  const rawPort = readEnv("SQL_PORT");
  const port = rawPort ? Number(rawPort) : 5432;
  return {
    host: sqlHost ?? "127.0.0.1",
    ...!isUnixSocketHost(sqlHost) ? { port } : {},
    user: readEnv("SQL_USER") ?? "unconfigured",
    password: readEnv("SQL_PASSWORD") ?? "unconfigured",
    database: readEnv("SQL_DB_NAME") ?? "unconfigured",
    ssl: resolveTcpSslConfig(sqlHost),
    max: process.env.VERCEL ? 5 : 10,
    idleTimeoutMillis: 2e4,
    connectionTimeoutMillis: 15e3
  };
}
function attachPoolErrorHandler(pool) {
  pool.on("error", (err) => {
    console.error("Unexpected error on idle Cloud SQL pool client:", err);
  });
}
var createPool = () => {
  const key = computePoolConfigKey();
  if (!global._postgresPool || global._postgresPoolKey !== key) {
    const pool = new Pool(buildDirectObjectPoolConfig());
    attachPoolErrorHandler(pool);
    global._postgresPool = pool;
    global._postgresPoolKey = key;
    global._drizzleDb = drizzle(pool, { schema: schema_exports });
  }
  return global._postgresPool;
};
async function ensureDatabaseReady() {
  assertDatabaseConfigured();
  const key = computePoolConfigKey();
  const connectionName = getCloudSqlConnectionName();
  if (!connectionName) {
    return createPool();
  }
  if (global._postgresPool && global._postgresPoolKey === key) {
    return global._postgresPool;
  }
  if (!global._cloudSqlInitPromise) {
    global._cloudSqlInitPromise = (async () => {
      try {
        const saJson = readEnv("GCP_SERVICE_ACCOUNT_KEY");
        const auth = saJson ? new GoogleAuth({
          credentials: parseServiceAccountCredentials(saJson),
          scopes: [
            "https://www.googleapis.com/auth/sqlservice.admin",
            "https://www.googleapis.com/auth/cloud-platform"
          ]
        }) : void 0;
        if (!global._cloudSqlConnector) {
          global._cloudSqlConnector = new Connector(auth ? { auth } : void 0);
        }
        const connectorOpts = await global._cloudSqlConnector.getOptions({
          instanceConnectionName: connectionName,
          ipType: resolveConnectorIpType(),
          authType: AuthTypes.PASSWORD
        });
        const pool = new Pool({
          ...connectorOpts,
          user: readEnv("SQL_USER"),
          password: readEnv("SQL_PASSWORD"),
          database: readEnv("SQL_DB_NAME"),
          max: process.env.VERCEL ? 5 : 10,
          idleTimeoutMillis: 2e4,
          connectionTimeoutMillis: 15e3
        });
        attachPoolErrorHandler(pool);
        global._postgresPool = pool;
        global._postgresPoolKey = key;
        global._drizzleDb = drizzle(pool, { schema: schema_exports });
        return pool;
      } catch (err) {
        global._cloudSqlInitPromise = void 0;
        throw new AppError(
          503,
          "Unable to initialize Google Cloud SQL Connector. Verify CLOUD_SQL_CONNECTION_NAME, GCP_SERVICE_ACCOUNT_KEY permissions (roles/cloudsql.client), and instance network configuration.",
          { cause: err }
        );
      }
    })();
  }
  return global._cloudSqlInitPromise;
}
function getActiveDb() {
  if (!global._drizzleDb || global._postgresPoolKey !== computePoolConfigKey()) {
    if (!getCloudSqlConnectionName()) {
      createPool();
    } else if (!global._drizzleDb) {
      createPool();
    }
  }
  return global._drizzleDb;
}
if (!getCloudSqlConnectionName()) {
  createPool();
}
var db = new Proxy({}, {
  get(_target, prop, receiver) {
    const active = getActiveDb();
    const value = Reflect.get(active, prop, receiver);
    return typeof value === "function" ? value.bind(active) : value;
  }
});

// firebase-applet-config.json
var firebase_applet_config_default = {
  projectId: "spatial-campaign-nlvvl",
  appId: "1:585554483367:web:9f176af4b70a7410b1a382",
  apiKey: "AIzaSyALoDE5th1p03l9RBimh-rX-TTmm0SLhVs",
  authDomain: "spatial-campaign-nlvvl.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-4e7b9940-78ae-415f-b5d7-c78ccb48710d",
  storageBucket: "spatial-campaign-nlvvl.firebasestorage.app",
  messagingSenderId: "585554483367",
  measurementId: "",
  oAuthClientId: "585554483367-mjnf856ig9lcpkki3avttcbcf0ni7f7d.apps.googleusercontent.com",
  recaptchaSiteKey: ""
};

// src/lib/firebase-admin.ts
import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
var projectId = firebase_applet_config_default.projectId?.trim() || void 0;
function isFirebaseAdminConfigured() {
  return Boolean(projectId);
}
var adminApp = getApps().length ? getApp() : initializeApp(projectId ? { projectId } : {});
var adminAuth = getAuth(adminApp);

// src/lib/validations.ts
import { z } from "zod";
var PROJECT_STATUSES = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED"
];
var TASK_STATUSES = ["TODO", "IN_PROGRESS", "COMPLETED"];
var TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
var createProjectSchema = z.object({
  name: z.string().trim().min(2, "Project name must be at least 2 characters").max(120),
  description: z.string().trim().max(2e3).optional().default(""),
  status: z.enum(PROJECT_STATUSES).optional().default("PLANNING"),
  startDate: z.string().nullable().optional(),
  deadline: z.string().nullable().optional()
});
var updateProjectSchema = z.object({
  name: z.string().trim().min(2, "Project name must be at least 2 characters").max(120).optional(),
  description: z.string().trim().max(2e3).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  startDate: z.string().nullable().optional(),
  deadline: z.string().nullable().optional()
});
var createTaskSchema = z.object({
  projectId: z.coerce.number().int().positive("Project is required"),
  title: z.string().trim().min(2, "Task title must be at least 2 characters").max(200),
  description: z.string().trim().max(4e3).optional().default(""),
  status: z.enum(TASK_STATUSES).optional().default("TODO"),
  priority: z.enum(TASK_PRIORITIES).optional().default("MEDIUM"),
  dueDate: z.string().nullable().optional(),
  assigneeId: z.coerce.number().int().positive().nullable().optional()
});
var updateTaskSchema = z.object({
  title: z.string().trim().min(2, "Task title must be at least 2 characters").max(200).optional(),
  description: z.string().trim().max(4e3).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: z.string().nullable().optional(),
  assigneeId: z.coerce.number().int().positive().nullable().optional(),
  position: z.coerce.number().int().min(0).optional()
});
var moveTaskSchema = z.object({
  status: z.enum(TASK_STATUSES),
  position: z.coerce.number().int().min(0).default(0)
});
var commentSchema = z.object({
  content: z.string().trim().min(1, "Comment cannot be empty").max(2e3)
});
var inviteMemberSchema = z.object({
  email: z.string().trim().email("Valid email address is required").toLowerCase(),
  role: z.enum(["ADMINISTRATOR", "MEMBER"]).default("MEMBER")
});
var updateMemberRoleSchema = z.object({
  role: z.enum(["ADMINISTRATOR", "MEMBER"])
});
var updateUserSettingsSchema = z.object({
  name: z.string().trim().min(2, "Display name must be at least 2 characters").max(80).optional(),
  avatar: z.string().trim().max(500).nullable().optional(),
  themePreference: z.enum(["dark", "light"]).optional(),
  notifyOnAssign: z.boolean().optional(),
  notifyOnComment: z.boolean().optional(),
  notifyOnInvite: z.boolean().optional(),
  notifyOnDeadline: z.boolean().optional()
});
var acceptInvitationSchema = z.object({
  token: z.string().trim().min(8, "Invitation token is required")
});
var strongPasswordSchema = z.string().min(8, "Password must be at least 8 characters").max(128, "Password must be at most 128 characters").regex(/[A-Z]/, "Password must include at least one uppercase letter").regex(/[a-z]/, "Password must include at least one lowercase letter").regex(/[0-9]/, "Password must include at least one number");
var registerSchema = z.object({
  name: z.string().trim().min(2, "Full name must be at least 2 characters").max(80),
  email: z.string().trim().email("Valid email address is required").toLowerCase(),
  password: strongPasswordSchema,
  confirmPassword: z.string().min(1, "Please confirm your password")
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"]
});
var loginSchema = z.object({
  email: z.string().trim().email("Valid email address is required").toLowerCase(),
  password: z.string().min(1, "Password is required")
});
var forgotPasswordSchema = z.object({
  email: z.string().trim().email("Valid email address is required").toLowerCase()
});
var resetPasswordSchema = z.object({
  token: z.string().trim().min(16, "Reset token is invalid"),
  password: strongPasswordSchema,
  confirmPassword: z.string().min(1, "Please confirm your password")
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"]
});
var changePasswordSchema = z.object({
  currentPassword: z.string().optional().default(""),
  newPassword: strongPasswordSchema,
  confirmPassword: z.string().min(1, "Please confirm your new password")
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"]
});

// src/server/services/auth.ts
import crypto2 from "crypto";
import bcrypt from "bcryptjs";
import { and as and5, eq as eq6, gt as gt2, isNull } from "drizzle-orm";

// src/server/services/team.ts
import crypto from "crypto";
import { and as and4, desc as desc3, eq as eq4, gt, inArray as inArray3, sql as sql3 } from "drizzle-orm";

// src/server/permissions.ts
import { and, eq } from "drizzle-orm";
function canRemoveTargetMember(actorRole, targetRole, isSelf) {
  if (targetRole === "OWNER") return false;
  if (isSelf) return true;
  if (actorRole === "OWNER") return true;
  if (actorRole === "ADMINISTRATOR") return targetRole === "MEMBER";
  return false;
}
async function getUserProjectRole(projectId2, userId) {
  try {
    const [membership] = await db.select({ role: projectMembers.role }).from(projectMembers).where(
      and(
        eq(projectMembers.projectId, projectId2),
        eq(projectMembers.userId, userId)
      )
    ).limit(1);
    if (membership) {
      return membership.role;
    }
    const [project] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId2)).limit(1);
    if (project && project.ownerId === userId) {
      return "OWNER";
    }
    return null;
  } catch (error) {
    console.error("Permission lookup failed:", error);
    throw new AppError(500, "Failed to verify project permissions.", { cause: error });
  }
}
async function requireProjectAccess(projectId2, userId, allowedRoles = ["OWNER", "ADMINISTRATOR", "MEMBER"]) {
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId2)).limit(1);
  if (!project) {
    throw new AppError(404, "Project not found.");
  }
  const role = await getUserProjectRole(projectId2, userId);
  if (!role || !allowedRoles.includes(role)) {
    throw new AppError(403, "You do not have permission to perform this action on this project.");
  }
  return role;
}

// src/server/services/activity.ts
import { desc, eq as eq2, inArray, or, sql } from "drizzle-orm";
async function logActivity(executor, input) {
  try {
    await executor.insert(activityLogs).values({
      actorId: input.actorId,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceName: input.resourceName,
      details: input.details ?? null
    });
  } catch (error) {
    console.error("Failed to log activity:", error);
    throw new AppError(500, "Failed to record activity history.", { cause: error });
  }
}
async function getAccessibleProjectIds(userId) {
  try {
    const memberRows = await db.select({ projectId: projectMembers.projectId }).from(projectMembers).where(eq2(projectMembers.userId, userId));
    const ownedRows = await db.select({ id: projects.id }).from(projects).where(eq2(projects.ownerId, userId));
    const ids = /* @__PURE__ */ new Set();
    for (const r of memberRows) ids.add(r.projectId);
    for (const r of ownedRows) ids.add(r.id);
    return Array.from(ids);
  } catch (error) {
    console.error("Failed to resolve accessible projects:", error);
    throw new AppError(500, "Failed to load accessible projects.", { cause: error });
  }
}
async function listAccessibleActivities(userId, options = {}) {
  try {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 30));
    const offset = (page - 1) * limit;
    const accessibleIds = await getAccessibleProjectIds(userId);
    if (options.projectId && !accessibleIds.includes(options.projectId)) {
      throw new AppError(403, "You do not have access to this project.");
    }
    const whereCondition = options.projectId ? eq2(activityLogs.projectId, options.projectId) : accessibleIds.length > 0 ? or(
      inArray(activityLogs.projectId, accessibleIds),
      eq2(activityLogs.actorId, userId)
    ) : eq2(activityLogs.actorId, userId);
    const rows = await db.select({
      id: activityLogs.id,
      actorId: activityLogs.actorId,
      actorName: users.name,
      actorEmail: users.email,
      actorAvatar: users.avatar,
      projectId: activityLogs.projectId,
      projectName: projects.name,
      taskId: activityLogs.taskId,
      action: activityLogs.action,
      resourceType: activityLogs.resourceType,
      resourceName: activityLogs.resourceName,
      details: activityLogs.details,
      createdAt: activityLogs.createdAt
    }).from(activityLogs).innerJoin(users, eq2(activityLogs.actorId, users.id)).leftJoin(projects, eq2(activityLogs.projectId, projects.id)).where(whereCondition).orderBy(desc(activityLogs.createdAt)).limit(limit).offset(offset);
    const [{ total }] = await db.select({ total: sql`count(*)::int` }).from(activityLogs).where(whereCondition);
    return {
      items: rows,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit))
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to list activity logs:", error);
    throw new AppError(500, "Failed to load activity feed.", { cause: error });
  }
}

// src/server/services/notifications.ts
import { and as and3, desc as desc2, eq as eq3, gte, lte, ne, sql as sql2 } from "drizzle-orm";
async function createNotification(executor, input) {
  try {
    const [recipient] = await executor.select({
      notifyOnAssign: users.notifyOnAssign,
      notifyOnComment: users.notifyOnComment,
      notifyOnInvite: users.notifyOnInvite,
      notifyOnDeadline: users.notifyOnDeadline
    }).from(users).where(eq3(users.id, input.userId)).limit(1);
    if (!recipient) return;
    if (input.type === "TASK_ASSIGNED" && !recipient.notifyOnAssign) return;
    if (input.type === "TASK_COMMENT" && !recipient.notifyOnComment) return;
    if (input.type === "PROJECT_INVITATION" && !recipient.notifyOnInvite) return;
    if (input.type === "DEADLINE_APPROACHING" && !recipient.notifyOnDeadline) return;
    await executor.insert(notifications).values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link ?? null
    });
  } catch (error) {
    console.error("Failed to create notification:", error);
    throw new AppError(500, "Failed to send notification.", { cause: error });
  }
}
async function syncApproachingDeadlines(userId) {
  try {
    const now = /* @__PURE__ */ new Date();
    const soon = new Date(now.getTime() + 48 * 60 * 60 * 1e3);
    const [userPref] = await db.select({ notifyOnDeadline: users.notifyOnDeadline }).from(users).where(eq3(users.id, userId)).limit(1);
    if (!userPref?.notifyOnDeadline) return;
    const dueSoonTasks = await db.select({
      id: tasks.id,
      title: tasks.title,
      projectId: tasks.projectId,
      dueDate: tasks.dueDate
    }).from(tasks).where(
      and3(
        eq3(tasks.assigneeId, userId),
        ne(tasks.status, "COMPLETED"),
        gte(tasks.dueDate, now),
        lte(tasks.dueDate, soon)
      )
    );
    if (dueSoonTasks.length === 0) return;
    const existing = await db.select({ link: notifications.link }).from(notifications).where(
      and3(
        eq3(notifications.userId, userId),
        eq3(notifications.type, "DEADLINE_APPROACHING"),
        gte(notifications.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1e3))
      )
    );
    const notifiedLinks = new Set(existing.map((e) => e.link));
    for (const task of dueSoonTasks) {
      const link = `/projects/${task.projectId}?task=${task.id}`;
      if (!notifiedLinks.has(link)) {
        await db.insert(notifications).values({
          userId,
          type: "DEADLINE_APPROACHING",
          title: "Upcoming deadline",
          message: `"${task.title}" is due within 48 hours.`,
          link
        });
      }
    }
  } catch (error) {
    console.error("Deadline notification sync failed:", error);
  }
}
async function getUserNotifications(userId) {
  try {
    await syncApproachingDeadlines(userId);
    const items = await db.select().from(notifications).where(eq3(notifications.userId, userId)).orderBy(desc2(notifications.createdAt)).limit(40);
    const [{ unreadCount }] = await db.select({ unreadCount: sql2`count(*)::int` }).from(notifications).where(and3(eq3(notifications.userId, userId), eq3(notifications.read, false)));
    return { items, unreadCount };
  } catch (error) {
    console.error("Failed to fetch notifications:", error);
    throw new AppError(500, "Failed to load notifications.", { cause: error });
  }
}
async function markNotificationRead(userId, notificationId) {
  try {
    const [updated] = await db.update(notifications).set({ read: true }).where(and3(eq3(notifications.id, notificationId), eq3(notifications.userId, userId))).returning();
    if (!updated) {
      throw new AppError(404, "Notification not found.");
    }
    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to mark notification read:", error);
    throw new AppError(500, "Failed to update notification.", { cause: error });
  }
}
async function markAllNotificationsRead(userId) {
  try {
    await db.update(notifications).set({ read: true }).where(and3(eq3(notifications.userId, userId), eq3(notifications.read, false)));
  } catch (error) {
    console.error("Failed to mark all notifications read:", error);
    throw new AppError(500, "Failed to mark notifications as read.", { cause: error });
  }
}

// src/server/services/team.ts
async function listWorkspaceTeam(userId) {
  try {
    const accessibleIds = await getAccessibleProjectIds(userId);
    if (accessibleIds.length === 0) {
      return { members: [], invitations: [] };
    }
    const [memberRows, taskRows, activityRows, inviteRows] = await Promise.all([
      db.select({
        projectId: projectMembers.projectId,
        projectName: projects.name,
        userId: projectMembers.userId,
        role: projectMembers.role,
        joinedAt: projectMembers.joinedAt,
        name: users.name,
        email: users.email,
        avatar: users.avatar
      }).from(projectMembers).innerJoin(projects, eq4(projectMembers.projectId, projects.id)).innerJoin(users, eq4(projectMembers.userId, users.id)).where(inArray3(projectMembers.projectId, accessibleIds)).orderBy(projectMembers.joinedAt),
      db.select({
        assigneeId: tasks.assigneeId,
        status: tasks.status,
        dueDate: tasks.dueDate
      }).from(tasks).where(inArray3(tasks.projectId, accessibleIds)),
      db.select({
        actorId: activityLogs.actorId,
        count: sql3`count(*)::int`
      }).from(activityLogs).where(inArray3(activityLogs.projectId, accessibleIds)).groupBy(activityLogs.actorId),
      db.select({
        id: invitations.id,
        projectId: invitations.projectId,
        projectName: projects.name,
        email: invitations.email,
        role: invitations.role,
        token: invitations.token,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
        invitedByName: users.name
      }).from(invitations).innerJoin(projects, eq4(invitations.projectId, projects.id)).innerJoin(users, eq4(invitations.invitedById, users.id)).where(
        and4(
          inArray3(invitations.projectId, accessibleIds),
          eq4(invitations.status, "PENDING")
        )
      ).orderBy(desc3(invitations.createdAt))
    ]);
    const activityCountMap = new Map(activityRows.map((a) => [a.actorId, a.count]));
    const taskStatsByUser = /* @__PURE__ */ new Map();
    const now = Date.now();
    for (const t of taskRows) {
      if (!t.assigneeId) continue;
      const entry = taskStatsByUser.get(t.assigneeId) ?? {
        total: 0,
        completed: 0,
        active: 0,
        overdue: 0
      };
      entry.total += 1;
      if (t.status === "COMPLETED") {
        entry.completed += 1;
      } else {
        entry.active += 1;
        if (t.dueDate && t.dueDate.getTime() < now) entry.overdue += 1;
      }
      taskStatsByUser.set(t.assigneeId, entry);
    }
    const grouped = /* @__PURE__ */ new Map();
    for (const m of memberRows) {
      const existing = grouped.get(m.userId);
      if (existing) {
        existing.projects.push({
          projectId: m.projectId,
          projectName: m.projectName,
          role: m.role,
          joinedAt: m.joinedAt
        });
      } else {
        grouped.set(m.userId, {
          userId: m.userId,
          name: m.name,
          email: m.email,
          avatar: m.avatar,
          projects: [
            {
              projectId: m.projectId,
              projectName: m.projectName,
              role: m.role,
              joinedAt: m.joinedAt
            }
          ],
          taskStats: taskStatsByUser.get(m.userId) ?? {
            total: 0,
            completed: 0,
            active: 0,
            overdue: 0
          },
          activityCount: activityCountMap.get(m.userId) ?? 0
        });
      }
    }
    return {
      members: Array.from(grouped.values()),
      invitations: inviteRows
    };
  } catch (error) {
    console.error("Failed to list workspace team:", error);
    throw new AppError(500, "Failed to load team directory.", { cause: error });
  }
}
async function listProjectInvitations(projectId2, userId) {
  try {
    await requireProjectAccess(projectId2, userId, ["OWNER", "ADMINISTRATOR"]);
    return await db.select({
      id: invitations.id,
      projectId: invitations.projectId,
      email: invitations.email,
      role: invitations.role,
      token: invitations.token,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
      invitedByName: users.name
    }).from(invitations).innerJoin(users, eq4(invitations.invitedById, users.id)).where(eq4(invitations.projectId, projectId2)).orderBy(desc3(invitations.createdAt));
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to list project invitations:", error);
    throw new AppError(500, "Failed to load invitations.", { cause: error });
  }
}
async function listIncomingInvitations(userEmail) {
  try {
    const cleanEmail = userEmail.trim().toLowerCase();
    return await db.select({
      id: invitations.id,
      projectId: invitations.projectId,
      projectName: projects.name,
      email: invitations.email,
      role: invitations.role,
      token: invitations.token,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
      invitedByName: users.name
    }).from(invitations).innerJoin(projects, eq4(invitations.projectId, projects.id)).innerJoin(users, eq4(invitations.invitedById, users.id)).where(
      and4(
        eq4(invitations.email, cleanEmail),
        eq4(invitations.status, "PENDING"),
        gt(invitations.expiresAt, /* @__PURE__ */ new Date())
      )
    ).orderBy(desc3(invitations.createdAt));
  } catch (error) {
    console.error("Failed to list incoming invitations:", error);
    throw new AppError(500, "Failed to load your invitations.", { cause: error });
  }
}
async function inviteMember(projectId2, actorUserId, input) {
  try {
    const actorRole = await requireProjectAccess(projectId2, actorUserId, [
      "OWNER",
      "ADMINISTRATOR"
    ]);
    if (input.role === "ADMINISTRATOR" && actorRole !== "OWNER") {
      throw new AppError(403, "Only project owners can invite administrators.");
    }
    const cleanEmail = input.email.trim().toLowerCase();
    const [existingUser] = await db.select({
      id: users.id,
      email: users.email,
      name: users.name
    }).from(users).where(eq4(users.email, cleanEmail)).limit(1);
    if (existingUser) {
      const [alreadyMember] = await db.select({ id: projectMembers.id }).from(projectMembers).where(
        and4(
          eq4(projectMembers.projectId, projectId2),
          eq4(projectMembers.userId, existingUser.id)
        )
      ).limit(1);
      if (alreadyMember) {
        throw new AppError(409, "This user is already a member of the project.");
      }
    }
    const [existingPending] = await db.select({ id: invitations.id }).from(invitations).where(
      and4(
        eq4(invitations.projectId, projectId2),
        eq4(invitations.email, cleanEmail),
        eq4(invitations.status, "PENDING"),
        gt(invitations.expiresAt, /* @__PURE__ */ new Date())
      )
    ).limit(1);
    if (existingPending) {
      throw new AppError(409, "A pending invitation already exists for this email.");
    }
    const [project] = await db.select({ name: projects.name }).from(projects).where(eq4(projects.id, projectId2)).limit(1);
    const projectName = project?.name ?? "DevTrack Project";
    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3);
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(invitations).values({
        projectId: projectId2,
        email: cleanEmail,
        role: input.role,
        token,
        invitedById: actorUserId,
        status: "PENDING",
        expiresAt
      }).returning();
      await logActivity(tx, {
        actorId: actorUserId,
        projectId: projectId2,
        action: "MEMBER_INVITED",
        resourceType: "INVITATION",
        resourceName: cleanEmail,
        details: `Invited ${cleanEmail} as ${input.role}`
      });
      if (existingUser) {
        await createNotification(tx, {
          userId: existingUser.id,
          type: "PROJECT_INVITATION",
          title: "Project invitation",
          message: `You were invited to join "${projectName}" as ${input.role}.`,
          link: `/team?invite=${token}`
        });
      }
      return { invitation: created };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to invite member:", error);
    throw new AppError(500, "Failed to create invitation.", { cause: error });
  }
}
async function syncPendingInvitationNotificationsForUser(executor, userId) {
  const [user] = await executor.select({
    id: users.id,
    email: users.email,
    notifyOnInvite: users.notifyOnInvite
  }).from(users).where(eq4(users.id, userId)).limit(1);
  if (!user || !user.notifyOnInvite) {
    return;
  }
  const cleanEmail = user.email.trim().toLowerCase();
  const pending = await executor.select({
    projectName: projects.name,
    role: invitations.role,
    token: invitations.token
  }).from(invitations).innerJoin(projects, eq4(invitations.projectId, projects.id)).where(
    and4(
      eq4(invitations.email, cleanEmail),
      eq4(invitations.status, "PENDING"),
      gt(invitations.expiresAt, /* @__PURE__ */ new Date())
    )
  );
  if (pending.length === 0) return;
  const existingNotifs = await executor.select({ link: notifications.link }).from(notifications).where(
    and4(
      eq4(notifications.userId, user.id),
      eq4(notifications.type, "PROJECT_INVITATION")
    )
  );
  const existingLinks = new Set(existingNotifs.map((n) => n.link));
  for (const inv of pending) {
    const link = `/team?invite=${inv.token}`;
    if (!existingLinks.has(link)) {
      await executor.insert(notifications).values({
        userId: user.id,
        type: "PROJECT_INVITATION",
        title: "Project invitation",
        message: `You were invited to join "${inv.projectName}" as ${inv.role}.`,
        link
      });
    }
  }
}
async function acceptInvitation(token, userId, userEmail) {
  try {
    return await db.transaction(async (tx) => {
      const [invite] = await tx.select().from(invitations).where(eq4(invitations.token, token.trim())).limit(1);
      if (!invite) {
        throw new AppError(404, "Invitation token is invalid.");
      }
      if (invite.status !== "PENDING") {
        throw new AppError(400, `This invitation has already been ${invite.status.toLowerCase()}.`);
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        await db.update(invitations).set({ status: "EXPIRED" }).where(eq4(invitations.id, invite.id));
        throw new AppError(400, "This invitation has expired.");
      }
      if (invite.email.toLowerCase() !== userEmail.trim().toLowerCase()) {
        throw new AppError(
          403,
          `This invitation was issued to ${invite.email}. Sign in with that account to accept.`
        );
      }
      const [existingMember] = await tx.select({ id: projectMembers.id }).from(projectMembers).where(
        and4(
          eq4(projectMembers.projectId, invite.projectId),
          eq4(projectMembers.userId, userId)
        )
      ).limit(1);
      if (!existingMember) {
        await tx.insert(projectMembers).values({
          projectId: invite.projectId,
          userId,
          role: invite.role
        });
      }
      const [updatedInvite] = await tx.update(invitations).set({ status: "ACCEPTED", acceptedAt: /* @__PURE__ */ new Date() }).where(eq4(invitations.id, invite.id)).returning();
      const [project] = await tx.select({ name: projects.name }).from(projects).where(eq4(projects.id, invite.projectId)).limit(1);
      await logActivity(tx, {
        actorId: userId,
        projectId: invite.projectId,
        action: "MEMBER_JOINED",
        resourceType: "MEMBER",
        resourceName: userEmail,
        details: `Joined "${project?.name ?? "project"}" as ${invite.role}`
      });
      return { invitation: updatedInvite, projectId: invite.projectId };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to accept invitation:", error);
    throw new AppError(500, "Failed to accept invitation.", { cause: error });
  }
}
async function declineInvitation(token, userId, userEmail) {
  try {
    return await db.transaction(async (tx) => {
      const [invite] = await tx.select().from(invitations).where(eq4(invitations.token, token.trim())).limit(1);
      if (!invite) {
        throw new AppError(404, "Invitation token is invalid.");
      }
      if (invite.status !== "PENDING") {
        throw new AppError(400, `This invitation has already been ${invite.status.toLowerCase()}.`);
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        await db.update(invitations).set({ status: "EXPIRED" }).where(eq4(invitations.id, invite.id));
        throw new AppError(400, "This invitation has expired.");
      }
      if (invite.email.toLowerCase() !== userEmail.trim().toLowerCase()) {
        throw new AppError(
          403,
          `This invitation was issued to ${invite.email}. Sign in with that account to decline.`
        );
      }
      const [updatedInvite] = await tx.update(invitations).set({ status: "DECLINED" }).where(eq4(invitations.id, invite.id)).returning();
      const [project] = await tx.select({ name: projects.name }).from(projects).where(eq4(projects.id, invite.projectId)).limit(1);
      await logActivity(tx, {
        actorId: userId,
        projectId: invite.projectId,
        action: "INVITATION_DECLINED",
        resourceType: "INVITATION",
        resourceName: userEmail,
        details: `Declined invitation to "${project?.name ?? "project"}"`
      });
      return { invitation: updatedInvite };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to decline invitation:", error);
    throw new AppError(500, "Failed to decline invitation.", { cause: error });
  }
}
async function revokeInvitation(invitationId, userId) {
  try {
    const [invite] = await db.select().from(invitations).where(eq4(invitations.id, invitationId)).limit(1);
    if (!invite) throw new AppError(404, "Invitation not found.");
    await requireProjectAccess(invite.projectId, userId, ["OWNER", "ADMINISTRATOR"]);
    const [updated] = await db.update(invitations).set({ status: "REVOKED" }).where(eq4(invitations.id, invitationId)).returning();
    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to revoke invitation:", error);
    throw new AppError(500, "Failed to revoke invitation.", { cause: error });
  }
}
async function updateMemberRole(projectId2, targetUserId, actorUserId, newRole) {
  try {
    await requireProjectAccess(projectId2, actorUserId, ["OWNER"]);
    const [target] = await db.select().from(projectMembers).where(
      and4(
        eq4(projectMembers.projectId, projectId2),
        eq4(projectMembers.userId, targetUserId)
      )
    ).limit(1);
    if (!target) throw new AppError(404, "Project member not found.");
    if (target.role === "OWNER") {
      throw new AppError(400, "Project owner role cannot be changed.");
    }
    return await db.transaction(async (tx) => {
      const [updated] = await tx.update(projectMembers).set({ role: newRole }).where(eq4(projectMembers.id, target.id)).returning();
      const [targetUser] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq4(users.id, targetUserId)).limit(1);
      await logActivity(tx, {
        actorId: actorUserId,
        projectId: projectId2,
        action: "MEMBER_ROLE_UPDATED",
        resourceType: "MEMBER",
        resourceName: targetUser?.name ?? targetUser?.email ?? "Member",
        details: `Changed role of ${targetUser?.name ?? "member"} to ${newRole}`
      });
      return updated;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to update member role:", error);
    throw new AppError(500, "Failed to update member role.", { cause: error });
  }
}
async function removeMember(projectId2, targetUserId, actorUserId) {
  try {
    const actorRole = await requireProjectAccess(projectId2, actorUserId);
    const [target] = await db.select().from(projectMembers).where(
      and4(
        eq4(projectMembers.projectId, projectId2),
        eq4(projectMembers.userId, targetUserId)
      )
    ).limit(1);
    if (!target) throw new AppError(404, "Project member not found.");
    const allowed = canRemoveTargetMember(
      actorRole,
      target.role,
      actorUserId === targetUserId
    );
    if (!allowed) {
      throw new AppError(403, "You do not have permission to remove this member.");
    }
    return await db.transaction(async (tx) => {
      const [targetUser] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq4(users.id, targetUserId)).limit(1);
      await tx.delete(projectMembers).where(eq4(projectMembers.id, target.id));
      await tx.update(tasks).set({ assigneeId: null, updatedAt: /* @__PURE__ */ new Date() }).where(and4(eq4(tasks.projectId, projectId2), eq4(tasks.assigneeId, targetUserId)));
      await logActivity(tx, {
        actorId: actorUserId,
        projectId: projectId2,
        action: "MEMBER_REMOVED",
        resourceType: "MEMBER",
        resourceName: targetUser?.name ?? targetUser?.email ?? "Member",
        details: `Removed ${targetUser?.name ?? "member"} from project`
      });
      return { removedUserId: targetUserId };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to remove member:", error);
    throw new AppError(500, "Failed to remove project member.", { cause: error });
  }
}

// src/server/services/users.ts
import { eq as eq5 } from "drizzle-orm";
function sanitizeUser(row) {
  return {
    id: row.id,
    uid: row.uid,
    name: row.name,
    email: row.email,
    emailVerified: Boolean(row.emailVerifiedAt),
    hasPassword: Boolean(row.passwordHash),
    avatar: row.avatar,
    role: row.role,
    themePreference: row.themePreference,
    notifyOnAssign: row.notifyOnAssign,
    notifyOnComment: row.notifyOnComment,
    notifyOnInvite: row.notifyOnInvite,
    notifyOnDeadline: row.notifyOnDeadline,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
async function ensureOAuthAccountLink(executor, userId, provider, providerAccountId) {
  await executor.insert(oauthAccounts).values({
    userId,
    provider,
    providerAccountId
  }).onConflictDoNothing();
}
async function syncFirebaseUserWithExecutor(executor, input) {
  const cleanEmail = (input.email?.trim() || `${input.uid}@users.devtrack.app`).toLowerCase();
  const hasRealEmail = Boolean(input.email && input.email.trim());
  const isVerified = Boolean(input.emailVerified);
  const provider = (input.provider?.trim() || "firebase").toLowerCase();
  const displayName = input.name?.trim() || cleanEmail.split("@")[0] || "Developer";
  const byUid = await executor.select().from(users).where(eq5(users.uid, input.uid)).limit(1);
  if (byUid.length > 0) {
    const existing = byUid[0];
    const updates = {};
    if (hasRealEmail && existing.email !== cleanEmail) {
      updates.email = cleanEmail;
    }
    if (isVerified && !existing.emailVerifiedAt) {
      updates.emailVerifiedAt = /* @__PURE__ */ new Date();
    }
    if (!existing.avatar && input.avatar) {
      updates.avatar = input.avatar;
    }
    if (input.name?.trim() && (!existing.name || existing.name === cleanEmail.split("@")[0])) {
      updates.name = input.name.trim();
    }
    let finalRow = existing;
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = /* @__PURE__ */ new Date();
      const updated = await executor.update(users).set(updates).where(eq5(users.id, existing.id)).returning();
      finalRow = updated[0];
    }
    await ensureOAuthAccountLink(executor, finalRow.id, provider, input.uid);
    return { user: sanitizeUser(finalRow), isNewUser: false };
  }
  const linkedByOAuth = await executor.select({ user: users }).from(oauthAccounts).innerJoin(users, eq5(oauthAccounts.userId, users.id)).where(eq5(oauthAccounts.providerAccountId, input.uid)).limit(1);
  if (linkedByOAuth.length > 0) {
    const existing = linkedByOAuth[0].user;
    const updates = {};
    if (isVerified && !existing.emailVerifiedAt) {
      updates.emailVerifiedAt = /* @__PURE__ */ new Date();
    }
    if (!existing.avatar && input.avatar) {
      updates.avatar = input.avatar;
    }
    let finalRow = existing;
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = /* @__PURE__ */ new Date();
      const updated = await executor.update(users).set(updates).where(eq5(users.id, existing.id)).returning();
      finalRow = updated[0];
    }
    await ensureOAuthAccountLink(executor, finalRow.id, provider, input.uid);
    return { user: sanitizeUser(finalRow), isNewUser: false };
  }
  if (hasRealEmail) {
    const byEmail = await executor.select().from(users).where(eq5(users.email, cleanEmail)).limit(1);
    if (byEmail.length > 0) {
      const existing = byEmail[0];
      if (!isVerified) {
        throw new AppError(
          409,
          "An account with this email address already exists. Sign in with your original method or verify your email before linking."
        );
      }
      const updated = await executor.update(users).set({
        avatar: existing.avatar ?? input.avatar ?? null,
        emailVerifiedAt: existing.emailVerifiedAt ?? /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq5(users.id, existing.id)).returning();
      await ensureOAuthAccountLink(executor, updated[0].id, provider, input.uid);
      return { user: sanitizeUser(updated[0]), isNewUser: false };
    }
  }
  const inserted = await executor.insert(users).values({
    uid: input.uid,
    email: cleanEmail,
    name: displayName,
    avatar: input.avatar ?? null,
    emailVerifiedAt: isVerified ? /* @__PURE__ */ new Date() : null
  }).returning();
  await ensureOAuthAccountLink(executor, inserted[0].id, provider, input.uid);
  return { user: sanitizeUser(inserted[0]), isNewUser: true };
}
async function syncFirebaseUser(input) {
  try {
    await ensureDatabaseReady();
    return await db.transaction(async (tx) => syncFirebaseUserWithExecutor(tx, input));
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped?.statusCode === 409) {
      try {
        return await db.transaction(async (tx) => syncFirebaseUserWithExecutor(tx, input));
      } catch (retryError) {
        if (retryError instanceof AppError) throw retryError;
      }
    }
    if (mapped) throw mapped;
    console.error("Failed to synchronize Firebase user:", error);
    throw new AppError(500, "Failed to synchronize user profile.", { cause: error });
  }
}
async function updateUserSettings(userId, data) {
  try {
    await ensureDatabaseReady();
    const updatePayload = {
      updatedAt: /* @__PURE__ */ new Date()
    };
    if (data.name !== void 0) updatePayload.name = data.name;
    if (data.avatar !== void 0) updatePayload.avatar = data.avatar;
    if (data.themePreference !== void 0) updatePayload.themePreference = data.themePreference;
    if (data.notifyOnAssign !== void 0) updatePayload.notifyOnAssign = data.notifyOnAssign;
    if (data.notifyOnComment !== void 0) updatePayload.notifyOnComment = data.notifyOnComment;
    if (data.notifyOnInvite !== void 0) updatePayload.notifyOnInvite = data.notifyOnInvite;
    if (data.notifyOnDeadline !== void 0) updatePayload.notifyOnDeadline = data.notifyOnDeadline;
    const [updated] = await db.update(users).set(updatePayload).where(eq5(users.id, userId)).returning();
    if (!updated) {
      throw new AppError(404, "User not found.");
    }
    return sanitizeUser(updated);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error("Failed to update user settings:", error);
    throw new AppError(500, "Failed to update settings.", { cause: error });
  }
}
async function updateUserAvatar(userId, avatarDataUri) {
  try {
    await ensureDatabaseReady();
    const [updated] = await db.update(users).set({
      avatar: avatarDataUri,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq5(users.id, userId)).returning();
    if (!updated) {
      throw new AppError(404, "User not found.");
    }
    return sanitizeUser(updated);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error("Failed to update user avatar:", error);
    throw new AppError(500, "Failed to update profile picture.", { cause: error });
  }
}

// src/server/services/auth.ts
var SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var BCRYPT_ROUNDS = 12;
var SESSION_COOKIE_NAME = "devtrack_session";
function hashToken(rawToken) {
  return crypto2.createHash("sha256").update(rawToken).digest("hex");
}
function generateSecureToken() {
  return crypto2.randomBytes(32).toString("hex");
}
async function createSessionRecord(userId, userAgent, executor = db) {
  try {
    await ensureDatabaseReady();
    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await executor.insert(sessions).values({
      userId,
      tokenHash,
      expiresAt,
      userAgent: userAgent?.slice(0, 300) ?? null
    });
    return rawToken;
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error("Failed to create database session:", error);
    throw new AppError(500, "Failed to create authentication session.", { cause: error });
  }
}
async function getUserBySessionToken(rawToken) {
  try {
    await ensureDatabaseReady();
    const tokenHash = hashToken(rawToken);
    const rows = await db.select({ user: users }).from(sessions).innerJoin(users, eq6(sessions.userId, users.id)).where(and5(eq6(sessions.tokenHash, tokenHash), gt2(sessions.expiresAt, /* @__PURE__ */ new Date()))).limit(1);
    if (rows.length === 0) return null;
    return sanitizeUser(rows[0].user);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error("Failed to validate session:", error);
    throw new AppError(500, "Failed to validate session.", { cause: error });
  }
}
async function deleteSessionByToken(rawToken) {
  try {
    await ensureDatabaseReady();
    const tokenHash = hashToken(rawToken);
    await db.delete(sessions).where(eq6(sessions.tokenHash, tokenHash));
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error("Failed to delete session:", error);
    throw new AppError(500, "Failed to sign out cleanly.", { cause: error });
  }
}
async function registerWithEmail(input) {
  const cleanEmail = input.email.trim().toLowerCase();
  const cleanName = input.name.trim();
  try {
    await ensureDatabaseReady();
    const existing = await db.select({ id: users.id }).from(users).where(eq6(users.email, cleanEmail)).limit(1);
    if (existing.length > 0) {
      throw new AppError(409, "An account with this email address already exists.");
    }
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const localUid = `local_${crypto2.randomUUID()}`;
    const { user, sessionToken } = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(users).values({
        uid: localUid,
        name: cleanName,
        email: cleanEmail,
        passwordHash,
        emailVerifiedAt: null,
        avatar: null
      }).returning();
      await syncPendingInvitationNotificationsForUser(tx, inserted.id);
      const token = await createSessionRecord(inserted.id, input.userAgent, tx);
      return { user: sanitizeUser(inserted), sessionToken: token };
    });
    return {
      user,
      requiresVerification: false,
      message: "Account created successfully.",
      sessionToken
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error, {
      duplicateMessage: "An account with this email address already exists."
    });
    if (mapped) throw mapped;
    console.error("Email registration failed:", error);
    throw new AppError(500, "Failed to create account.", { cause: error });
  }
}
async function loginWithEmail(input) {
  const cleanEmail = input.email.trim().toLowerCase();
  try {
    await ensureDatabaseReady();
    const [existing] = await db.select().from(users).where(eq6(users.email, cleanEmail)).limit(1);
    if (!existing) {
      throw new AppError(401, "Invalid email address or password.");
    }
    if (!existing.passwordHash) {
      throw new AppError(
        401,
        "This account uses Google Sign-In. Continue with Google, then set a password in Settings if you also want email login."
      );
    }
    const valid = await bcrypt.compare(input.password, existing.passwordHash);
    if (!valid) {
      throw new AppError(401, "Invalid email address or password.");
    }
    await syncPendingInvitationNotificationsForUser(db, existing.id);
    const sessionToken = await createSessionRecord(existing.id, input.userAgent);
    return {
      user: sanitizeUser(existing),
      sessionToken
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error("Email login failed:", error);
    throw new AppError(500, "Failed to sign in.", { cause: error });
  }
}
async function syncAuthenticatedFirebaseUser(decoded, options) {
  try {
    await ensureDatabaseReady();
    const provider = decoded.firebase?.sign_in_provider ?? "google";
    const { user, isNewUser } = await syncFirebaseUser({
      uid: decoded.uid,
      email: decoded.email ?? null,
      emailVerified: Boolean(decoded.email_verified),
      name: options?.name?.trim() || decoded.name || null,
      avatar: decoded.picture ?? null,
      provider: provider === "google.com" ? "google" : provider
    });
    await syncPendingInvitationNotificationsForUser(db, user.id);
    const sessionToken = await createSessionRecord(user.id, options?.userAgent);
    return { user, sessionToken, isNewUser };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) {
      console.error("Firebase session sync database error:", error);
      throw mapped;
    }
    console.error("Firebase session synchronization failed:", error);
    throw new AppError(500, "Failed to synchronize authentication session.", {
      cause: error
    });
  }
}
async function changeUserPassword(userId, currentPassword, newPassword) {
  try {
    await ensureDatabaseReady();
    const [existing] = await db.select().from(users).where(eq6(users.id, userId)).limit(1);
    if (!existing) {
      throw new AppError(404, "User account not found.");
    }
    if (existing.passwordHash) {
      if (!currentPassword) {
        throw new AppError(400, "Current password is required.");
      }
      const matches = await bcrypt.compare(currentPassword, existing.passwordHash);
      if (!matches) {
        throw new AppError(401, "Current password is incorrect.");
      }
    }
    const nextHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.update(users).set({
      passwordHash: nextHash,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq6(users.id, userId));
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error("Failed to change password:", error);
    throw new AppError(500, "Failed to update password.", { cause: error });
  }
}
async function requestPasswordReset(email) {
  const cleanEmail = email.trim().toLowerCase();
  try {
    await ensureDatabaseReady();
    await db.select({ id: users.id }).from(users).where(eq6(users.email, cleanEmail)).limit(1);
    return {
      emailConfigured: false,
      sent: false,
      message: "Password reset email delivery is not configured on this server. If you signed up with Google, sign in with Google and set or update your password in Settings."
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error("Password reset request failed:", error);
    throw new AppError(500, "Unable to process password reset request.", { cause: error });
  }
}
async function resetPasswordWithToken(rawToken, newPassword) {
  try {
    await ensureDatabaseReady();
    const tokenHash = hashToken(rawToken.trim());
    const now = /* @__PURE__ */ new Date();
    const [record] = await db.select().from(passwordResetTokens).where(
      and5(
        eq6(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt2(passwordResetTokens.expiresAt, now)
      )
    ).limit(1);
    if (!record) {
      throw new AppError(400, "This password reset token is invalid or has expired.");
    }
    const nextHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.transaction(async (tx) => {
      const [consumed] = await tx.update(passwordResetTokens).set({ usedAt: now }).where(
        and5(
          eq6(passwordResetTokens.id, record.id),
          isNull(passwordResetTokens.usedAt)
        )
      ).returning({ id: passwordResetTokens.id });
      if (!consumed) {
        throw new AppError(400, "This password reset token has already been used.");
      }
      await tx.update(users).set({ passwordHash: nextHash, updatedAt: now }).where(eq6(users.id, record.userId));
      await tx.delete(sessions).where(eq6(sessions.userId, record.userId));
    });
    return { success: true };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    console.error("Failed to reset password with token:", error);
    throw new AppError(500, "Failed to reset password.", { cause: error });
  }
}

// src/server/middleware/auth.ts
var requireAuth = async (req, res, next) => {
  try {
    await ensureDatabaseReady();
  } catch (error) {
    next(error);
    return;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      res.status(401).json({ error: "Authentication token missing." });
      return;
    }
    let decoded;
    try {
      decoded = await adminAuth.verifyIdToken(token);
    } catch (error) {
      console.error("Error verifying Firebase ID token:", error);
      res.status(401).json({ error: "Invalid or expired authentication session." });
      return;
    }
    try {
      req.firebaseUser = decoded;
      const provider = decoded.firebase?.sign_in_provider ?? "google";
      const { user, isNewUser } = await syncFirebaseUser({
        uid: decoded.uid,
        email: decoded.email ?? null,
        emailVerified: Boolean(decoded.email_verified),
        name: decoded.name ?? null,
        avatar: decoded.picture ?? null,
        provider: provider === "google.com" ? "google" : provider
      });
      if (isNewUser) {
        await syncPendingInvitationNotificationsForUser(db, user.id);
      }
      req.dbUser = user;
      next();
      return;
    } catch (error) {
      next(error);
      return;
    }
  }
  const sessionCookie = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof sessionCookie === "string" && sessionCookie.trim()) {
    try {
      const sessionUser = await getUserBySessionToken(sessionCookie.trim());
      if (sessionUser) {
        req.dbUser = sessionUser;
        next();
        return;
      }
    } catch (error) {
      next(error);
      return;
    }
  }
  res.status(401).json({ error: "Authentication required." });
};

// src/server/services/dashboard.ts
import { desc as desc4, eq as eq7, inArray as inArray4 } from "drizzle-orm";
async function getDashboardAnalytics(userId, days = 14) {
  try {
    const windowDays = Math.min(90, Math.max(7, days));
    const accessibleIds = await getAccessibleProjectIds(userId);
    if (accessibleIds.length === 0) {
      return {
        summary: {
          totalProjects: 0,
          activeProjects: 0,
          completedProjects: 0,
          totalTasks: 0,
          completedTasks: 0,
          overdueTasks: 0
        },
        tasksByStatus: [
          { name: "To Do", status: "TODO", count: 0 },
          { name: "In Progress", status: "IN_PROGRESS", count: 0 },
          { name: "Completed", status: "COMPLETED", count: 0 }
        ],
        tasksByPriority: [
          { name: "Low", priority: "LOW", count: 0 },
          { name: "Medium", priority: "MEDIUM", count: 0 },
          { name: "High", priority: "HIGH", count: 0 },
          { name: "Urgent", priority: "URGENT", count: 0 }
        ],
        projectProgress: [],
        completionTrend: buildEmptyTrend(windowDays),
        teamWorkload: [],
        recentActivity: [],
        myTasks: [],
        upcomingDeadlines: [],
        overdueTaskList: [],
        activeProjects: []
      };
    }
    const [projectRows, taskRows, memberRows, activityRows] = await Promise.all([
      db.select().from(projects).where(inArray4(projects.id, accessibleIds)).orderBy(desc4(projects.updatedAt)),
      db.select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        projectId: tasks.projectId,
        projectName: projects.name,
        assigneeId: tasks.assigneeId,
        createdAt: tasks.createdAt,
        completedAt: tasks.completedAt
      }).from(tasks).innerJoin(projects, eq7(tasks.projectId, projects.id)).where(inArray4(tasks.projectId, accessibleIds)),
      db.select({
        userId: projectMembers.userId,
        name: users.name,
        email: users.email,
        avatar: users.avatar
      }).from(projectMembers).innerJoin(users, eq7(projectMembers.userId, users.id)).where(inArray4(projectMembers.projectId, accessibleIds)),
      db.select({
        id: activityLogs.id,
        actorId: activityLogs.actorId,
        actorName: users.name,
        actorAvatar: users.avatar,
        projectId: activityLogs.projectId,
        projectName: projects.name,
        action: activityLogs.action,
        resourceType: activityLogs.resourceType,
        resourceName: activityLogs.resourceName,
        details: activityLogs.details,
        createdAt: activityLogs.createdAt
      }).from(activityLogs).innerJoin(users, eq7(activityLogs.actorId, users.id)).leftJoin(projects, eq7(activityLogs.projectId, projects.id)).where(inArray4(activityLogs.projectId, accessibleIds)).orderBy(desc4(activityLogs.createdAt)).limit(12)
    ]);
    const now = Date.now();
    const soon = now + 7 * 24 * 60 * 60 * 1e3;
    const totalProjects = projectRows.length;
    const activeProjectsList = projectRows.filter((p) => p.status === "ACTIVE");
    const completedProjects = projectRows.filter((p) => p.status === "COMPLETED").length;
    const totalTasks = taskRows.length;
    const completedTasks = taskRows.filter((t) => t.status === "COMPLETED").length;
    const overdueTaskList = taskRows.filter((t) => t.status !== "COMPLETED" && t.dueDate && t.dueDate.getTime() < now).sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0));
    const tasksByStatus = [
      {
        name: "To Do",
        status: "TODO",
        count: taskRows.filter((t) => t.status === "TODO").length
      },
      {
        name: "In Progress",
        status: "IN_PROGRESS",
        count: taskRows.filter((t) => t.status === "IN_PROGRESS").length
      },
      {
        name: "Completed",
        status: "COMPLETED",
        count: completedTasks
      }
    ];
    const tasksByPriority = [
      {
        name: "Low",
        priority: "LOW",
        count: taskRows.filter((t) => t.priority === "LOW").length
      },
      {
        name: "Medium",
        priority: "MEDIUM",
        count: taskRows.filter((t) => t.priority === "MEDIUM").length
      },
      {
        name: "High",
        priority: "HIGH",
        count: taskRows.filter((t) => t.priority === "HIGH").length
      },
      {
        name: "Urgent",
        priority: "URGENT",
        count: taskRows.filter((t) => t.priority === "URGENT").length
      }
    ];
    const projectProgress = projectRows.filter((p) => p.status !== "ARCHIVED").slice(0, 8).map((p) => {
      const pTasks = taskRows.filter((t) => t.projectId === p.id);
      const pDone = pTasks.filter((t) => t.status === "COMPLETED").length;
      const pct = pTasks.length > 0 ? Math.round(pDone / pTasks.length * 100) : 0;
      return {
        id: p.id,
        name: p.name.length > 18 ? `${p.name.slice(0, 17)}\u2026` : p.name,
        fullName: p.name,
        status: p.status,
        progress: pct,
        totalTasks: pTasks.length,
        completedTasks: pDone
      };
    });
    const trendMap = /* @__PURE__ */ new Map();
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = windowDays - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1e3);
      const key = d.toISOString().slice(0, 10);
      const label = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric"
      }).format(d);
      trendMap.set(key, { date: key, label, completed: 0, created: 0 });
    }
    for (const t of taskRows) {
      const createdKey = t.createdAt.toISOString().slice(0, 10);
      const cBucket = trendMap.get(createdKey);
      if (cBucket) cBucket.created += 1;
      if (t.completedAt) {
        const doneKey = t.completedAt.toISOString().slice(0, 10);
        const dBucket = trendMap.get(doneKey);
        if (dBucket) dBucket.completed += 1;
      }
    }
    const uniqueUsers = /* @__PURE__ */ new Map();
    for (const m of memberRows) {
      if (!uniqueUsers.has(m.userId)) uniqueUsers.set(m.userId, m);
    }
    const teamWorkload = Array.from(uniqueUsers.values()).map((u) => {
      const assigned = taskRows.filter((t) => t.assigneeId === u.userId);
      const done = assigned.filter((t) => t.status === "COMPLETED").length;
      const inProgress = assigned.filter((t) => t.status === "IN_PROGRESS").length;
      const todo = assigned.filter((t) => t.status === "TODO").length;
      return {
        userId: u.userId,
        name: u.name,
        email: u.email,
        avatar: u.avatar,
        total: assigned.length,
        todo,
        inProgress,
        completed: done
      };
    });
    const myTasks = taskRows.filter((t) => t.assigneeId === userId && t.status !== "COMPLETED").sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity)).slice(0, 8);
    const upcomingDeadlines = taskRows.filter(
      (t) => t.status !== "COMPLETED" && t.dueDate && t.dueDate.getTime() >= now && t.dueDate.getTime() <= soon
    ).sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0)).slice(0, 8);
    const activeProjects = activeProjectsList.slice(0, 6).map((p) => {
      const pTasks = taskRows.filter((t) => t.projectId === p.id);
      const pDone = pTasks.filter((t) => t.status === "COMPLETED").length;
      return {
        ...p,
        totalTasks: pTasks.length,
        completedTasks: pDone,
        progress: pTasks.length > 0 ? Math.round(pDone / pTasks.length * 100) : 0
      };
    });
    return {
      summary: {
        totalProjects,
        activeProjects: activeProjectsList.length,
        completedProjects,
        totalTasks,
        completedTasks,
        overdueTasks: overdueTaskList.length
      },
      tasksByStatus,
      tasksByPriority,
      projectProgress,
      completionTrend: Array.from(trendMap.values()),
      teamWorkload,
      recentActivity: activityRows,
      myTasks,
      upcomingDeadlines,
      overdueTaskList: overdueTaskList.slice(0, 8),
      activeProjects
    };
  } catch (error) {
    console.error("Failed to calculate dashboard analytics:", error);
    throw new AppError(500, "Failed to load dashboard analytics.", { cause: error });
  }
}
function buildEmptyTrend(days) {
  const result = [];
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1e3);
    result.push({
      date: d.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric"
      }).format(d),
      completed: 0,
      created: 0
    });
  }
  return result;
}

// src/server/services/projects.ts
import { and as and7, desc as desc5, eq as eq8, ilike, inArray as inArray5, or as or2, sql as sql4 } from "drizzle-orm";
function parseDateInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
async function listUserProjects(userId, filters = {}) {
  try {
    const accessibleIds = await getAccessibleProjectIds(userId);
    if (accessibleIds.length === 0) return [];
    const conditions = [inArray5(projects.id, accessibleIds)];
    if (filters.status && filters.status !== "ALL") {
      conditions.push(eq8(projects.status, filters.status));
    }
    if (filters.q && filters.q.trim()) {
      const pattern = `%${filters.q.trim()}%`;
      const searchCond = or2(
        ilike(projects.name, pattern),
        ilike(projects.description, pattern)
      );
      if (searchCond) conditions.push(searchCond);
    }
    const projectRows = await db.select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      startDate: projects.startDate,
      deadline: projects.deadline,
      ownerId: projects.ownerId,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      ownerName: users.name,
      ownerEmail: users.email,
      ownerAvatar: users.avatar
    }).from(projects).innerJoin(users, eq8(projects.ownerId, users.id)).where(and7(...conditions)).orderBy(desc5(projects.updatedAt));
    if (projectRows.length === 0) return [];
    const projectIds = projectRows.map((p) => p.id);
    const [taskRows, memberRows] = await Promise.all([
      db.select({
        projectId: tasks.projectId,
        status: tasks.status,
        dueDate: tasks.dueDate
      }).from(tasks).where(inArray5(tasks.projectId, projectIds)),
      db.select({
        projectId: projectMembers.projectId,
        userId: projectMembers.userId,
        role: projectMembers.role,
        name: users.name,
        email: users.email,
        avatar: users.avatar
      }).from(projectMembers).innerJoin(users, eq8(projectMembers.userId, users.id)).where(inArray5(projectMembers.projectId, projectIds))
    ]);
    const now = Date.now();
    const taskStatsMap = /* @__PURE__ */ new Map();
    for (const t of taskRows) {
      const entry = taskStatsMap.get(t.projectId) ?? {
        total: 0,
        completed: 0,
        overdue: 0
      };
      entry.total += 1;
      if (t.status === "COMPLETED") {
        entry.completed += 1;
      } else if (t.dueDate && t.dueDate.getTime() < now) {
        entry.overdue += 1;
      }
      taskStatsMap.set(t.projectId, entry);
    }
    const membersMap = /* @__PURE__ */ new Map();
    for (const m of memberRows) {
      const list = membersMap.get(m.projectId) ?? [];
      list.push({
        userId: m.userId,
        role: m.role,
        name: m.name,
        email: m.email,
        avatar: m.avatar
      });
      membersMap.set(m.projectId, list);
    }
    return projectRows.map((p) => {
      const stats = taskStatsMap.get(p.id) ?? { total: 0, completed: 0, overdue: 0 };
      const members = membersMap.get(p.id) ?? [];
      const myMembership = members.find((m) => m.userId === userId);
      const myRole = p.ownerId === userId ? "OWNER" : myMembership?.role ?? "MEMBER";
      const progress = stats.total > 0 ? Math.round(stats.completed / stats.total * 100) : 0;
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        startDate: p.startDate,
        deadline: p.deadline,
        ownerId: p.ownerId,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        owner: {
          id: p.ownerId,
          name: p.ownerName,
          email: p.ownerEmail,
          avatar: p.ownerAvatar
        },
        role: myRole,
        totalTasks: stats.total,
        completedTasks: stats.completed,
        overdueTasks: stats.overdue,
        progress,
        memberCount: Math.max(1, members.length),
        members
      };
    });
  } catch (error) {
    console.error("Failed to list user projects:", error);
    throw new AppError(500, "Failed to load projects.", { cause: error });
  }
}
async function createProject(userId, input) {
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(projects).values({
        name: input.name,
        description: input.description ?? "",
        status: input.status ?? "PLANNING",
        startDate: parseDateInput(input.startDate),
        deadline: parseDateInput(input.deadline),
        ownerId: userId
      }).returning();
      await tx.insert(projectMembers).values({
        projectId: created.id,
        userId,
        role: "OWNER"
      });
      await logActivity(tx, {
        actorId: userId,
        projectId: created.id,
        action: "PROJECT_CREATED",
        resourceType: "PROJECT",
        resourceName: created.name,
        details: `Created project "${created.name}" (${created.status})`
      });
      return created;
    });
  } catch (error) {
    console.error("Failed to create project:", error);
    throw new AppError(500, "Failed to create project.", { cause: error });
  }
}
async function getProjectDetails(projectId2, userId) {
  try {
    const role = await requireProjectAccess(projectId2, userId);
    const [project] = await db.select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      startDate: projects.startDate,
      deadline: projects.deadline,
      ownerId: projects.ownerId,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      ownerName: users.name,
      ownerEmail: users.email,
      ownerAvatar: users.avatar
    }).from(projects).innerJoin(users, eq8(projects.ownerId, users.id)).where(eq8(projects.id, projectId2)).limit(1);
    if (!project) {
      throw new AppError(404, "Project not found.");
    }
    const [memberRows, taskRows, activityRows] = await Promise.all([
      db.select({
        id: projectMembers.id,
        userId: projectMembers.userId,
        role: projectMembers.role,
        joinedAt: projectMembers.joinedAt,
        name: users.name,
        email: users.email,
        avatar: users.avatar
      }).from(projectMembers).innerJoin(users, eq8(projectMembers.userId, users.id)).where(eq8(projectMembers.projectId, projectId2)).orderBy(projectMembers.joinedAt),
      db.select().from(tasks).where(eq8(tasks.projectId, projectId2)).orderBy(tasks.position, desc5(tasks.createdAt)),
      db.select({
        id: activityLogs.id,
        actorId: activityLogs.actorId,
        actorName: users.name,
        actorAvatar: users.avatar,
        action: activityLogs.action,
        resourceType: activityLogs.resourceType,
        resourceName: activityLogs.resourceName,
        details: activityLogs.details,
        createdAt: activityLogs.createdAt
      }).from(activityLogs).innerJoin(users, eq8(activityLogs.actorId, users.id)).where(eq8(activityLogs.projectId, projectId2)).orderBy(desc5(activityLogs.createdAt)).limit(25)
    ]);
    const taskIds = taskRows.map((t) => t.id);
    const commentCounts = /* @__PURE__ */ new Map();
    if (taskIds.length > 0) {
      const counts = await db.select({
        taskId: taskComments.taskId,
        count: sql4`count(*)::int`
      }).from(taskComments).where(inArray5(taskComments.taskId, taskIds)).groupBy(taskComments.taskId);
      for (const c of counts) {
        commentCounts.set(c.taskId, c.count);
      }
    }
    const userIdsNeeded = /* @__PURE__ */ new Set();
    for (const t of taskRows) {
      userIdsNeeded.add(t.createdById);
      if (t.assigneeId) userIdsNeeded.add(t.assigneeId);
    }
    const userLookup = /* @__PURE__ */ new Map();
    if (userIdsNeeded.size > 0) {
      const uRows = await db.select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatar: users.avatar
      }).from(users).where(inArray5(users.id, Array.from(userIdsNeeded)));
      for (const u of uRows) userLookup.set(u.id, u);
    }
    const now = Date.now();
    const totalTasks = taskRows.length;
    const completedTasks = taskRows.filter((t) => t.status === "COMPLETED").length;
    const inProgressTasks = taskRows.filter((t) => t.status === "IN_PROGRESS").length;
    const todoTasks = taskRows.filter((t) => t.status === "TODO").length;
    const overdueTasks = taskRows.filter(
      (t) => t.status !== "COMPLETED" && t.dueDate && t.dueDate.getTime() < now
    ).length;
    const progress = totalTasks > 0 ? Math.round(completedTasks / totalTasks * 100) : 0;
    const formattedTasks = taskRows.map((t) => ({
      ...t,
      projectName: project.name,
      assignee: t.assigneeId ? userLookup.get(t.assigneeId) ?? null : null,
      createdBy: userLookup.get(t.createdById) ?? null,
      commentCount: commentCounts.get(t.id) ?? 0
    }));
    return {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        startDate: project.startDate,
        deadline: project.deadline,
        ownerId: project.ownerId,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        owner: {
          id: project.ownerId,
          name: project.ownerName,
          email: project.ownerEmail,
          avatar: project.ownerAvatar
        },
        role,
        totalTasks,
        completedTasks,
        inProgressTasks,
        todoTasks,
        overdueTasks,
        progress
      },
      members: memberRows,
      tasks: formattedTasks,
      activities: activityRows
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to get project details:", error);
    throw new AppError(500, "Failed to load project details.", { cause: error });
  }
}
async function updateProject(projectId2, userId, input) {
  try {
    await requireProjectAccess(projectId2, userId, ["OWNER", "ADMINISTRATOR"]);
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(projects).where(eq8(projects.id, projectId2)).limit(1);
      if (!existing) throw new AppError(404, "Project not found.");
      const updateData = {
        updatedAt: /* @__PURE__ */ new Date()
      };
      if (input.name !== void 0) updateData.name = input.name;
      if (input.description !== void 0) updateData.description = input.description;
      if (input.status !== void 0) updateData.status = input.status;
      if (input.startDate !== void 0) updateData.startDate = parseDateInput(input.startDate);
      if (input.deadline !== void 0) updateData.deadline = parseDateInput(input.deadline);
      const [updated] = await tx.update(projects).set(updateData).where(eq8(projects.id, projectId2)).returning();
      await logActivity(tx, {
        actorId: userId,
        projectId: updated.id,
        action: "PROJECT_UPDATED",
        resourceType: "PROJECT",
        resourceName: updated.name,
        details: `Updated project "${updated.name}" (${updated.status})`
      });
      return updated;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to update project:", error);
    throw new AppError(500, "Failed to update project.", { cause: error });
  }
}
async function deleteProject(projectId2, userId) {
  try {
    await requireProjectAccess(projectId2, userId, ["OWNER"]);
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(projects).where(eq8(projects.id, projectId2)).limit(1);
      if (!existing) throw new AppError(404, "Project not found.");
      await logActivity(tx, {
        actorId: userId,
        projectId: null,
        action: "PROJECT_DELETED",
        resourceType: "PROJECT",
        resourceName: existing.name,
        details: `Deleted project "${existing.name}"`
      });
      await tx.delete(projects).where(eq8(projects.id, projectId2));
      return { deletedId: projectId2 };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to delete project:", error);
    throw new AppError(500, "Failed to delete project.", { cause: error });
  }
}
async function seedStarterWorkspace(userId) {
  try {
    const existing = await getAccessibleProjectIds(userId);
    if (existing.length > 0) {
      throw new AppError(400, "Starter workspace can only be created when you have no projects.");
    }
    const now = /* @__PURE__ */ new Date();
    const day = 24 * 60 * 60 * 1e3;
    return await db.transaction(async (tx) => {
      const [p1] = await tx.insert(projects).values({
        name: "Core API Gateway v3",
        description: "Edge rate limiting, JWT verification middleware, and PostgreSQL connection pool hardening.",
        status: "ACTIVE",
        startDate: new Date(now.getTime() - 12 * day),
        deadline: new Date(now.getTime() + 18 * day),
        ownerId: userId
      }).returning();
      const [p2] = await tx.insert(projects).values({
        name: "Telemetry Console",
        description: "Real-time worker latency visualization and anomaly webhook dispatcher.",
        status: "PLANNING",
        startDate: new Date(now.getTime() - 4 * day),
        deadline: new Date(now.getTime() + 26 * day),
        ownerId: userId
      }).returning();
      await tx.insert(projectMembers).values([
        { projectId: p1.id, userId, role: "OWNER" },
        { projectId: p2.id, userId, role: "OWNER" }
      ]);
      const insertedTasks = await tx.insert(tasks).values([
        {
          projectId: p1.id,
          title: "Implement token bucket rate limiter",
          description: "Enforce per-tenant API bursts at edge ingress with sliding window counters.",
          status: "COMPLETED",
          priority: "HIGH",
          position: 0,
          dueDate: new Date(now.getTime() - 2 * day),
          assigneeId: userId,
          createdById: userId,
          completedAt: new Date(now.getTime() - 2 * day)
        },
        {
          projectId: p1.id,
          title: "Add Drizzle query error boundary",
          description: "Sanitize PostgreSQL error propagation across all route controllers.",
          status: "IN_PROGRESS",
          priority: "URGENT",
          position: 0,
          dueDate: new Date(now.getTime() + 2 * day),
          assigneeId: userId,
          createdById: userId
        },
        {
          projectId: p1.id,
          title: "Write RBAC integration test suite",
          description: "Verify OWNER, ADMINISTRATOR, and MEMBER permission enforcement on all endpoints.",
          status: "TODO",
          priority: "HIGH",
          position: 0,
          dueDate: new Date(now.getTime() + 5 * day),
          assigneeId: userId,
          createdById: userId
        },
        {
          projectId: p2.id,
          title: "Design time-series Recharts throughput view",
          description: "Aggregate 14-day task completion trends using tabular numerals.",
          status: "IN_PROGRESS",
          priority: "MEDIUM",
          position: 0,
          dueDate: new Date(now.getTime() + 7 * day),
          assigneeId: userId,
          createdById: userId
        },
        {
          projectId: p2.id,
          title: "Configure webhook retry backoff",
          description: "Bounded exponential backoff for outbound project webhook delivery.",
          status: "TODO",
          priority: "LOW",
          position: 1,
          dueDate: new Date(now.getTime() + 12 * day),
          assigneeId: null,
          createdById: userId
        }
      ]).returning();
      await tx.insert(taskComments).values({
        taskId: insertedTasks[1].id,
        authorId: userId,
        content: "Verified that sanitized error responses never expose SQL table details."
      });
      await logActivity(tx, {
        actorId: userId,
        projectId: p1.id,
        action: "PROJECT_CREATED",
        resourceType: "PROJECT",
        resourceName: p1.name,
        details: `Created project "${p1.name}"`
      });
      await logActivity(tx, {
        actorId: userId,
        projectId: p2.id,
        action: "PROJECT_CREATED",
        resourceType: "PROJECT",
        resourceName: p2.name,
        details: `Created project "${p2.name}"`
      });
      await logActivity(tx, {
        actorId: userId,
        projectId: p1.id,
        taskId: insertedTasks[0].id,
        action: "TASK_COMPLETED",
        resourceType: "TASK",
        resourceName: insertedTasks[0].title,
        details: `Completed "${insertedTasks[0].title}"`
      });
      return { projects: [p1, p2] };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to seed starter workspace:", error);
    throw new AppError(500, "Failed to create starter workspace.", { cause: error });
  }
}

// src/server/services/tasks.ts
import { and as and8, asc, desc as desc6, eq as eq9, ilike as ilike2, inArray as inArray6, or as or3, sql as sql5 } from "drizzle-orm";
function parseDateInput2(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
async function listUserTasks(userId, filters = {}) {
  try {
    const accessibleIds = await getAccessibleProjectIds(userId);
    if (accessibleIds.length === 0) return [];
    if (filters.projectId && !accessibleIds.includes(filters.projectId)) {
      throw new AppError(403, "You do not have access to this project.");
    }
    const conditions = [
      filters.projectId ? eq9(tasks.projectId, filters.projectId) : inArray6(tasks.projectId, accessibleIds)
    ];
    if (filters.status && filters.status !== "ALL") {
      conditions.push(eq9(tasks.status, filters.status));
    }
    if (filters.priority && filters.priority !== "ALL") {
      conditions.push(eq9(tasks.priority, filters.priority));
    }
    if (filters.assignee === "ME") {
      conditions.push(eq9(tasks.assigneeId, userId));
    } else if (filters.assignee === "UNASSIGNED") {
      conditions.push(sql5`${tasks.assigneeId} IS NULL`);
    } else if (filters.assignee && /^\d+$/.test(filters.assignee)) {
      conditions.push(eq9(tasks.assigneeId, Number(filters.assignee)));
    }
    if (filters.q && filters.q.trim()) {
      const pattern = `%${filters.q.trim()}%`;
      const cond = or3(ilike2(tasks.title, pattern), ilike2(tasks.description, pattern));
      if (cond) conditions.push(cond);
    }
    const orderByClause = filters.sort === "dueDate" ? [asc(tasks.dueDate), desc6(tasks.createdAt)] : filters.sort === "priority" ? [desc6(tasks.createdAt)] : [asc(tasks.position), desc6(tasks.createdAt)];
    const taskRows = await db.select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      position: tasks.position,
      dueDate: tasks.dueDate,
      projectId: tasks.projectId,
      projectName: projects.name,
      assigneeId: tasks.assigneeId,
      createdById: tasks.createdById,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      completedAt: tasks.completedAt
    }).from(tasks).innerJoin(projects, eq9(tasks.projectId, projects.id)).where(and8(...conditions)).orderBy(...orderByClause);
    if (taskRows.length === 0) return [];
    const taskIds = taskRows.map((t) => t.id);
    const userIds = /* @__PURE__ */ new Set();
    for (const t of taskRows) {
      userIds.add(t.createdById);
      if (t.assigneeId) userIds.add(t.assigneeId);
    }
    const [userRows, commentCounts] = await Promise.all([
      db.select({ id: users.id, name: users.name, email: users.email, avatar: users.avatar }).from(users).where(inArray6(users.id, Array.from(userIds))),
      db.select({
        taskId: taskComments.taskId,
        count: sql5`count(*)::int`
      }).from(taskComments).where(inArray6(taskComments.taskId, taskIds)).groupBy(taskComments.taskId)
    ]);
    const userMap = new Map(userRows.map((u) => [u.id, u]));
    const countMap = new Map(commentCounts.map((c) => [c.taskId, c.count]));
    const result = taskRows.map((t) => ({
      ...t,
      assignee: t.assigneeId ? userMap.get(t.assigneeId) ?? null : null,
      createdBy: userMap.get(t.createdById) ?? null,
      commentCount: countMap.get(t.id) ?? 0
    }));
    if (filters.sort === "priority") {
      const rank = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      result.sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9));
    }
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to list tasks:", error);
    throw new AppError(500, "Failed to load tasks.", { cause: error });
  }
}
async function createTask(userId, input) {
  try {
    await requireProjectAccess(input.projectId, userId);
    if (input.assigneeId) {
      const [member] = await db.select({ id: projectMembers.id }).from(projectMembers).where(
        and8(
          eq9(projectMembers.projectId, input.projectId),
          eq9(projectMembers.userId, input.assigneeId)
        )
      ).limit(1);
      if (!member) {
        throw new AppError(400, "Assignee must be a member of this project.");
      }
    }
    return await db.transaction(async (tx) => {
      const status = input.status ?? "TODO";
      const [{ maxPos }] = await tx.select({ maxPos: sql5`coalesce(max(${tasks.position}), -1)::int` }).from(tasks).where(and8(eq9(tasks.projectId, input.projectId), eq9(tasks.status, status)));
      const [created] = await tx.insert(tasks).values({
        projectId: input.projectId,
        title: input.title,
        description: input.description ?? "",
        status,
        priority: input.priority ?? "MEDIUM",
        position: maxPos + 1,
        dueDate: parseDateInput2(input.dueDate),
        assigneeId: input.assigneeId ?? null,
        createdById: userId,
        completedAt: status === "COMPLETED" ? /* @__PURE__ */ new Date() : null
      }).returning();
      await logActivity(tx, {
        actorId: userId,
        projectId: created.projectId,
        taskId: created.id,
        action: "TASK_CREATED",
        resourceType: "TASK",
        resourceName: created.title,
        details: `Created task "${created.title}" (${created.priority})`
      });
      if (created.assigneeId && created.assigneeId !== userId) {
        await logActivity(tx, {
          actorId: userId,
          projectId: created.projectId,
          taskId: created.id,
          action: "TASK_ASSIGNED",
          resourceType: "TASK",
          resourceName: created.title,
          details: `Assigned "${created.title}"`
        });
        await createNotification(tx, {
          userId: created.assigneeId,
          type: "TASK_ASSIGNED",
          title: "New task assigned",
          message: `You were assigned to "${created.title}".`,
          link: `/projects/${created.projectId}?task=${created.id}`
        });
      }
      return created;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to create task:", error);
    throw new AppError(500, "Failed to create task.", { cause: error });
  }
}
async function getTaskDetails(taskId, userId) {
  try {
    const [task] = await db.select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      position: tasks.position,
      dueDate: tasks.dueDate,
      projectId: tasks.projectId,
      projectName: projects.name,
      assigneeId: tasks.assigneeId,
      createdById: tasks.createdById,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      completedAt: tasks.completedAt
    }).from(tasks).innerJoin(projects, eq9(tasks.projectId, projects.id)).where(eq9(tasks.id, taskId)).limit(1);
    if (!task) {
      throw new AppError(404, "Task not found.");
    }
    await requireProjectAccess(task.projectId, userId);
    const [comments, activities, members] = await Promise.all([
      db.select({
        id: taskComments.id,
        taskId: taskComments.taskId,
        authorId: taskComments.authorId,
        authorName: users.name,
        authorEmail: users.email,
        authorAvatar: users.avatar,
        content: taskComments.content,
        createdAt: taskComments.createdAt,
        updatedAt: taskComments.updatedAt
      }).from(taskComments).innerJoin(users, eq9(taskComments.authorId, users.id)).where(eq9(taskComments.taskId, taskId)).orderBy(asc(taskComments.createdAt)),
      db.select({
        id: activityLogs.id,
        actorId: activityLogs.actorId,
        actorName: users.name,
        actorAvatar: users.avatar,
        action: activityLogs.action,
        details: activityLogs.details,
        createdAt: activityLogs.createdAt
      }).from(activityLogs).innerJoin(users, eq9(activityLogs.actorId, users.id)).where(eq9(activityLogs.taskId, taskId)).orderBy(desc6(activityLogs.createdAt)).limit(20),
      db.select({
        userId: projectMembers.userId,
        role: projectMembers.role,
        name: users.name,
        email: users.email,
        avatar: users.avatar
      }).from(projectMembers).innerJoin(users, eq9(projectMembers.userId, users.id)).where(eq9(projectMembers.projectId, task.projectId))
    ]);
    const assignee = task.assigneeId ? members.find((m) => m.userId === task.assigneeId) ?? null : null;
    const [createdBy] = await db.select({ id: users.id, name: users.name, email: users.email, avatar: users.avatar }).from(users).where(eq9(users.id, task.createdById)).limit(1);
    return {
      task: {
        ...task,
        assignee: assignee ? { id: assignee.userId, name: assignee.name, email: assignee.email, avatar: assignee.avatar } : null,
        createdBy: createdBy ?? null
      },
      comments,
      activities,
      projectMembers: members
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to get task details:", error);
    throw new AppError(500, "Failed to load task details.", { cause: error });
  }
}
async function updateTask(taskId, userId, input) {
  try {
    const [existing] = await db.select().from(tasks).where(eq9(tasks.id, taskId)).limit(1);
    if (!existing) throw new AppError(404, "Task not found.");
    await requireProjectAccess(existing.projectId, userId);
    if (input.assigneeId) {
      const [member] = await db.select({ id: projectMembers.id }).from(projectMembers).where(
        and8(
          eq9(projectMembers.projectId, existing.projectId),
          eq9(projectMembers.userId, input.assigneeId)
        )
      ).limit(1);
      if (!member) {
        throw new AppError(400, "Assignee must be a member of this project.");
      }
    }
    return await db.transaction(async (tx) => {
      const updateData = {
        updatedAt: /* @__PURE__ */ new Date()
      };
      if (input.title !== void 0) updateData.title = input.title;
      if (input.description !== void 0) updateData.description = input.description;
      if (input.priority !== void 0) updateData.priority = input.priority;
      if (input.dueDate !== void 0) updateData.dueDate = parseDateInput2(input.dueDate);
      if (input.assigneeId !== void 0) updateData.assigneeId = input.assigneeId;
      if (input.position !== void 0) updateData.position = input.position;
      if (input.status !== void 0) {
        updateData.status = input.status;
        if (input.status === "COMPLETED" && existing.status !== "COMPLETED") {
          updateData.completedAt = /* @__PURE__ */ new Date();
        } else if (input.status !== "COMPLETED") {
          updateData.completedAt = null;
        }
      }
      const [updated] = await tx.update(tasks).set(updateData).where(eq9(tasks.id, taskId)).returning();
      const statusChanged = input.status !== void 0 && input.status !== existing.status;
      const assigneeChanged = input.assigneeId !== void 0 && input.assigneeId !== existing.assigneeId;
      const priorityChanged = input.priority !== void 0 && input.priority !== existing.priority;
      if (statusChanged) {
        await logActivity(tx, {
          actorId: userId,
          projectId: updated.projectId,
          taskId: updated.id,
          action: updated.status === "COMPLETED" ? "TASK_COMPLETED" : "TASK_STATUS_CHANGED",
          resourceType: "TASK",
          resourceName: updated.title,
          details: updated.status === "COMPLETED" ? `Completed "${updated.title}"` : `Moved "${updated.title}" from ${existing.status} to ${updated.status}`
        });
      } else if (priorityChanged) {
        await logActivity(tx, {
          actorId: userId,
          projectId: updated.projectId,
          taskId: updated.id,
          action: "TASK_UPDATED",
          resourceType: "TASK",
          resourceName: updated.title,
          details: `Changed priority of "${updated.title}" to ${updated.priority}`
        });
      } else if (assigneeChanged) {
        await logActivity(tx, {
          actorId: userId,
          projectId: updated.projectId,
          taskId: updated.id,
          action: "TASK_ASSIGNED",
          resourceType: "TASK",
          resourceName: updated.title,
          details: updated.assigneeId ? `Reassigned "${updated.title}"` : `Unassigned "${updated.title}"`
        });
      } else {
        await logActivity(tx, {
          actorId: userId,
          projectId: updated.projectId,
          taskId: updated.id,
          action: "TASK_UPDATED",
          resourceType: "TASK",
          resourceName: updated.title,
          details: `Updated "${updated.title}"`
        });
      }
      if (assigneeChanged && updated.assigneeId && updated.assigneeId !== userId) {
        await createNotification(tx, {
          userId: updated.assigneeId,
          type: "TASK_ASSIGNED",
          title: "Task assigned to you",
          message: `You were assigned to "${updated.title}".`,
          link: `/projects/${updated.projectId}?task=${updated.id}`
        });
      } else if (updated.assigneeId && updated.assigneeId !== userId && statusChanged) {
        await createNotification(tx, {
          userId: updated.assigneeId,
          type: "TASK_UPDATED",
          title: "Task status updated",
          message: `"${updated.title}" is now ${updated.status.replace("_", " ")}.`,
          link: `/projects/${updated.projectId}?task=${updated.id}`
        });
      }
      return updated;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to update task:", error);
    throw new AppError(500, "Failed to update task.", { cause: error });
  }
}
async function moveTask(taskId, userId, input) {
  try {
    const [existing] = await db.select().from(tasks).where(eq9(tasks.id, taskId)).limit(1);
    if (!existing) throw new AppError(404, "Task not found.");
    await requireProjectAccess(existing.projectId, userId);
    return await db.transaction(async (tx) => {
      const targetColumnTasks = await tx.select().from(tasks).where(
        and8(
          eq9(tasks.projectId, existing.projectId),
          eq9(tasks.status, input.status)
        )
      ).orderBy(asc(tasks.position), asc(tasks.id));
      const filtered = targetColumnTasks.filter((t) => t.id !== taskId);
      const boundedPos = Math.max(0, Math.min(input.position, filtered.length));
      filtered.splice(boundedPos, 0, existing);
      for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i];
        const isMoved = item.id === taskId;
        await tx.update(tasks).set({
          status: isMoved ? input.status : item.status,
          position: i,
          updatedAt: isMoved ? /* @__PURE__ */ new Date() : item.updatedAt,
          completedAt: isMoved ? input.status === "COMPLETED" ? existing.completedAt ?? /* @__PURE__ */ new Date() : null : item.completedAt
        }).where(eq9(tasks.id, item.id));
      }
      const [updated] = await tx.select().from(tasks).where(eq9(tasks.id, taskId)).limit(1);
      if (existing.status !== input.status) {
        await logActivity(tx, {
          actorId: userId,
          projectId: existing.projectId,
          taskId: existing.id,
          action: input.status === "COMPLETED" ? "TASK_COMPLETED" : "TASK_STATUS_CHANGED",
          resourceType: "TASK",
          resourceName: existing.title,
          details: input.status === "COMPLETED" ? `Completed "${existing.title}"` : `Moved "${existing.title}" from ${existing.status} to ${input.status}`
        });
        if (existing.assigneeId && existing.assigneeId !== userId) {
          await createNotification(tx, {
            userId: existing.assigneeId,
            type: "TASK_UPDATED",
            title: "Task moved on board",
            message: `"${existing.title}" moved to ${input.status.replace("_", " ")}.`,
            link: `/projects/${existing.projectId}?task=${existing.id}`
          });
        }
      }
      return updated;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to move task:", error);
    throw new AppError(500, "Failed to move task.", { cause: error });
  }
}
async function deleteTask(taskId, userId) {
  try {
    const [existing] = await db.select().from(tasks).where(eq9(tasks.id, taskId)).limit(1);
    if (!existing) throw new AppError(404, "Task not found.");
    await requireProjectAccess(existing.projectId, userId);
    return await db.transaction(async (tx) => {
      await logActivity(tx, {
        actorId: userId,
        projectId: existing.projectId,
        taskId: null,
        action: "TASK_DELETED",
        resourceType: "TASK",
        resourceName: existing.title,
        details: `Deleted task "${existing.title}"`
      });
      await tx.delete(tasks).where(eq9(tasks.id, taskId));
      return { deletedId: taskId };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to delete task:", error);
    throw new AppError(500, "Failed to delete task.", { cause: error });
  }
}
async function addTaskComment(taskId, userId, content) {
  try {
    const [task] = await db.select().from(tasks).where(eq9(tasks.id, taskId)).limit(1);
    if (!task) throw new AppError(404, "Task not found.");
    await requireProjectAccess(task.projectId, userId);
    return await db.transaction(async (tx) => {
      const [comment] = await tx.insert(taskComments).values({
        taskId,
        authorId: userId,
        content
      }).returning();
      await logActivity(tx, {
        actorId: userId,
        projectId: task.projectId,
        taskId: task.id,
        action: "COMMENT_ADDED",
        resourceType: "COMMENT",
        resourceName: task.title,
        details: `Commented on "${task.title}"`
      });
      const notifyTargetIds = /* @__PURE__ */ new Set();
      if (task.assigneeId && task.assigneeId !== userId) notifyTargetIds.add(task.assigneeId);
      if (task.createdById !== userId) notifyTargetIds.add(task.createdById);
      for (const targetId of notifyTargetIds) {
        await createNotification(tx, {
          userId: targetId,
          type: "TASK_COMMENT",
          title: "New comment on task",
          message: `New comment on "${task.title}": ${content.slice(0, 80)}`,
          link: `/projects/${task.projectId}?task=${task.id}`
        });
      }
      const [author] = await tx.select({ name: users.name, email: users.email, avatar: users.avatar }).from(users).where(eq9(users.id, userId)).limit(1);
      return {
        ...comment,
        authorName: author?.name ?? "User",
        authorEmail: author?.email ?? "",
        authorAvatar: author?.avatar ?? null
      };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to add comment:", error);
    throw new AppError(500, "Failed to post comment.", { cause: error });
  }
}
async function updateTaskComment(commentId, userId, content) {
  try {
    const [existing] = await db.select().from(taskComments).where(eq9(taskComments.id, commentId)).limit(1);
    if (!existing) throw new AppError(404, "Comment not found.");
    if (existing.authorId !== userId) {
      throw new AppError(403, "You can only edit your own comments.");
    }
    const [updated] = await db.update(taskComments).set({ content, updatedAt: /* @__PURE__ */ new Date() }).where(eq9(taskComments.id, commentId)).returning();
    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to update comment:", error);
    throw new AppError(500, "Failed to update comment.", { cause: error });
  }
}
async function deleteTaskComment(commentId, userId) {
  try {
    const [existing] = await db.select().from(taskComments).where(eq9(taskComments.id, commentId)).limit(1);
    if (!existing) throw new AppError(404, "Comment not found.");
    const [task] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq9(tasks.id, existing.taskId)).limit(1);
    if (!task) throw new AppError(404, "Associated task not found.");
    const role = await requireProjectAccess(task.projectId, userId);
    if (existing.authorId !== userId && role !== "OWNER" && role !== "ADMINISTRATOR") {
      throw new AppError(403, "You do not have permission to delete this comment.");
    }
    await db.delete(taskComments).where(eq9(taskComments.id, commentId));
    return { deletedId: commentId };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Failed to delete comment:", error);
    throw new AppError(500, "Failed to delete comment.", { cause: error });
  }
}

// server.ts
var MAX_AVATAR_BYTES = 2 * 1024 * 1024;
function detectImageMimeType(buf) {
  if (buf.length >= 3 && buf[0] === 255 && buf[1] === 216 && buf[2] === 255) {
    return "image/jpeg";
  }
  if (buf.length >= 8 && buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71 && buf[4] === 13 && buf[5] === 10 && buf[6] === 26 && buf[7] === 10) {
    return "image/png";
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
function isGoogleOAuthConfigured() {
  return Boolean(
    firebase_applet_config_default.apiKey && firebase_applet_config_default.authDomain && firebase_applet_config_default.projectId
  );
}
var app = express();
app.set("trust proxy", 1);
app.use((req, _res, next) => {
  const mutableReq = req;
  if (mutableReq.body !== void 0 && mutableReq.readableEnded) {
    mutableReq._body = true;
  }
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
function isHttpsRequest(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const rawProto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const proto = rawProto?.split(",")[0]?.trim().toLowerCase();
  return req.secure || proto === "https" || Boolean(process.env.VERCEL) || (process.env.APP_URL?.trim().startsWith("https://") ?? false);
}
function setSessionCookie(res, req, rawToken) {
  const isHttps = isHttpsRequest(req);
  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1e3,
    sameSite: isHttps ? "none" : "lax",
    secure: isHttps
  });
}
function clearSessionCookie(res, req) {
  const isHttps = isHttpsRequest(req);
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    path: "/",
    sameSite: isHttps ? "none" : "lax",
    secure: isHttps
  });
}
function parseId(raw) {
  const val = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(val);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid numeric identifier.");
  }
  return id;
}
function asyncHandler(fn) {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
function extractFirebaseToken(req) {
  const authHeader = req.headers.authorization;
  const bodyToken = req.body && typeof req.body === "object" && "idToken" in req.body ? req.body.idToken : void 0;
  if (typeof bodyToken === "string" && bodyToken.trim()) {
    return bodyToken.trim();
  }
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  return "";
}
var handleFirebaseSessionSync = asyncHandler(async (req, res) => {
  await ensureDatabaseReady();
  if (!isFirebaseAdminConfigured()) {
    res.status(503).json({
      error: "Firebase Authentication is not configured on this server."
    });
    return;
  }
  const rawToken = extractFirebaseToken(req);
  if (!rawToken) {
    res.status(400).json({ error: "Firebase identity token is required." });
    return;
  }
  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(rawToken);
  } catch (error) {
    console.error("Firebase token verification failed:", error);
    res.status(401).json({ error: "Invalid or expired Firebase authentication token." });
    return;
  }
  const bodyName = req.body && typeof req.body === "object" && "name" in req.body ? req.body.name : void 0;
  const result = await syncAuthenticatedFirebaseUser(decoded, {
    name: typeof bodyName === "string" ? bodyName : void 0,
    userAgent: req.get("user-agent")
  });
  setSessionCookie(res, req, result.sessionToken);
  res.json({ user: result.user });
});
app.use("/api", (req, _res, next) => {
  if (req.path === "/health" || req.path === "/auth/config" || req.path === "/auth/logout") {
    next();
    return;
  }
  ensureDatabaseReady().then(() => next(), next);
});
app.get("/api/health", (_req, res) => {
  const dbError = getDatabaseConfigurationError();
  res.json({
    status: "ok",
    databaseConfigured: !dbError,
    firebaseConfigured: isFirebaseAdminConfigured(),
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
app.get("/api/auth/config", (_req, res) => {
  res.json({
    firebaseConfigured: isFirebaseAdminConfigured(),
    googleConfigured: isGoogleOAuthConfigured(),
    emailConfigured: false,
    emailVerificationEnforced: false
  });
});
app.post(
  "/api/auth/register",
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.parse(req.body);
    const result = await registerWithEmail({
      name: parsed.name,
      email: parsed.email,
      password: parsed.password,
      userAgent: req.get("user-agent")
    });
    setSessionCookie(res, req, result.sessionToken);
    res.status(201).json({
      user: result.user,
      requiresVerification: result.requiresVerification,
      message: result.message
    });
  })
);
app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.parse(req.body);
    const result = await loginWithEmail({
      email: parsed.email,
      password: parsed.password,
      userAgent: req.get("user-agent")
    });
    setSessionCookie(res, req, result.sessionToken);
    res.json({ user: result.user });
  })
);
app.post("/api/auth/google", handleFirebaseSessionSync);
app.post("/api/auth/session", handleFirebaseSessionSync);
app.post(
  "/api/auth/forgot-password",
  asyncHandler(async (req, res) => {
    const parsed = forgotPasswordSchema.parse(req.body);
    const result = await requestPasswordReset(parsed.email);
    res.json(result);
  })
);
app.post(
  "/api/auth/reset-password",
  asyncHandler(async (req, res) => {
    const parsed = resetPasswordSchema.parse(req.body);
    const result = await resetPasswordWithToken(parsed.token, parsed.password);
    res.json(result);
  })
);
app.post(
  "/api/auth/logout",
  asyncHandler(async (req, res) => {
    const rawCookie = req.cookies?.[SESSION_COOKIE_NAME];
    if (typeof rawCookie === "string" && rawCookie.trim() && !getDatabaseConfigurationError()) {
      await deleteSessionByToken(rawCookie.trim()).catch(() => void 0);
    }
    clearSessionCookie(res, req);
    res.json({ success: true });
  })
);
app.get(
  "/api/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.dbUser });
  })
);
app.patch(
  "/api/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = updateUserSettingsSchema.parse(req.body);
    const updated = await updateUserSettings(req.dbUser.id, parsed);
    res.json({ user: updated });
  })
);
app.patch(
  "/api/me/password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = changePasswordSchema.parse(req.body);
    await changeUserPassword(
      req.dbUser.id,
      parsed.currentPassword,
      parsed.newPassword
    );
    res.json({ success: true });
  })
);
app.post(
  "/api/me/avatar",
  requireAuth,
  express.raw({
    type: ["image/jpeg", "image/png", "image/webp"],
    limit: MAX_AVATAR_BYTES
  }),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({
        error: "Please upload a valid JPEG, PNG, or WebP image (up to 2 MB)."
      });
      return;
    }
    if (req.body.length > MAX_AVATAR_BYTES) {
      res.status(413).json({ error: "Profile picture must be 2 MB or smaller." });
      return;
    }
    const detectedMime = detectImageMimeType(req.body);
    if (!detectedMime) {
      res.status(400).json({
        error: "Unsupported or invalid image format. Allowed formats: JPEG, PNG, WebP."
      });
      return;
    }
    const dataUri = `data:${detectedMime};base64,${req.body.toString("base64")}`;
    const updated = await updateUserAvatar(req.dbUser.id, dataUri);
    res.json({ user: updated });
  })
);
app.delete(
  "/api/me/avatar",
  requireAuth,
  asyncHandler(async (req, res) => {
    const updated = await updateUserAvatar(req.dbUser.id, null);
    res.json({ user: updated });
  })
);
app.post(
  "/api/me/seed-workspace",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await seedStarterWorkspace(req.dbUser.id);
    res.status(201).json(result);
  })
);
app.get(
  "/api/dashboard",
  requireAuth,
  asyncHandler(async (req, res) => {
    const daysParam = typeof req.query.days === "string" ? Number(req.query.days) : 14;
    const days = Number.isFinite(daysParam) ? daysParam : 14;
    const analytics = await getDashboardAnalytics(req.dbUser.id, days);
    res.json(analytics);
  })
);
app.get(
  "/api/projects",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : void 0;
    const status = typeof req.query.status === "string" ? req.query.status : void 0;
    const items = await listUserProjects(req.dbUser.id, { q, status });
    res.json({ projects: items });
  })
);
app.post(
  "/api/projects",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = createProjectSchema.parse(req.body);
    const project = await createProject(req.dbUser.id, parsed);
    res.status(201).json({ project });
  })
);
app.get(
  "/api/projects/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId2 = parseId(req.params.id);
    const details = await getProjectDetails(projectId2, req.dbUser.id);
    res.json(details);
  })
);
app.patch(
  "/api/projects/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId2 = parseId(req.params.id);
    const parsed = updateProjectSchema.parse(req.body);
    const project = await updateProject(projectId2, req.dbUser.id, parsed);
    res.json({ project });
  })
);
app.delete(
  "/api/projects/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId2 = parseId(req.params.id);
    const result = await deleteProject(projectId2, req.dbUser.id);
    res.json(result);
  })
);
app.get(
  "/api/projects/:id/invitations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId2 = parseId(req.params.id);
    const items = await listProjectInvitations(projectId2, req.dbUser.id);
    res.json({ invitations: items });
  })
);
app.post(
  "/api/projects/:id/invitations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId2 = parseId(req.params.id);
    const parsed = inviteMemberSchema.parse(req.body);
    const result = await inviteMember(projectId2, req.dbUser.id, parsed);
    res.status(201).json(result);
  })
);
app.patch(
  "/api/projects/:id/members/:userId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId2 = parseId(req.params.id);
    const targetUserId = parseId(req.params.userId);
    const parsed = updateMemberRoleSchema.parse(req.body);
    const member = await updateMemberRole(
      projectId2,
      targetUserId,
      req.dbUser.id,
      parsed.role
    );
    res.json({ member });
  })
);
app.delete(
  "/api/projects/:id/members/:userId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId2 = parseId(req.params.id);
    const targetUserId = parseId(req.params.userId);
    const result = await removeMember(projectId2, targetUserId, req.dbUser.id);
    res.json(result);
  })
);
app.get(
  "/api/team",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await listWorkspaceTeam(req.dbUser.id);
    res.json(data);
  })
);
app.get(
  "/api/invitations/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const items = await listIncomingInvitations(req.dbUser.email);
    res.json({ invitations: items });
  })
);
app.post(
  "/api/invitations/accept",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = acceptInvitationSchema.parse(req.body);
    const result = await acceptInvitation(
      parsed.token,
      req.dbUser.id,
      req.dbUser.email
    );
    res.json(result);
  })
);
app.post(
  "/api/invitations/decline",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = acceptInvitationSchema.parse(req.body);
    const result = await declineInvitation(
      parsed.token,
      req.dbUser.id,
      req.dbUser.email
    );
    res.json(result);
  })
);
app.delete(
  "/api/invitations/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const invitationId = parseId(req.params.id);
    const invitation = await revokeInvitation(invitationId, req.dbUser.id);
    res.json({ invitation });
  })
);
app.get(
  "/api/tasks",
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId2 = typeof req.query.projectId === "string" && req.query.projectId !== "ALL" ? parseId(req.query.projectId) : void 0;
    const status = typeof req.query.status === "string" ? req.query.status : void 0;
    const priority = typeof req.query.priority === "string" ? req.query.priority : void 0;
    const assignee = typeof req.query.assignee === "string" ? req.query.assignee : void 0;
    const q = typeof req.query.q === "string" ? req.query.q : void 0;
    const sort = typeof req.query.sort === "string" ? req.query.sort : void 0;
    const items = await listUserTasks(req.dbUser.id, {
      projectId: projectId2,
      status,
      priority,
      assignee,
      q,
      sort
    });
    res.json({ tasks: items });
  })
);
app.post(
  "/api/tasks",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = createTaskSchema.parse(req.body);
    const task = await createTask(req.dbUser.id, parsed);
    res.status(201).json({ task });
  })
);
app.get(
  "/api/tasks/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const taskId = parseId(req.params.id);
    const details = await getTaskDetails(taskId, req.dbUser.id);
    res.json(details);
  })
);
app.patch(
  "/api/tasks/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const taskId = parseId(req.params.id);
    const parsed = updateTaskSchema.parse(req.body);
    const task = await updateTask(taskId, req.dbUser.id, parsed);
    res.json({ task });
  })
);
app.patch(
  "/api/tasks/:id/move",
  requireAuth,
  asyncHandler(async (req, res) => {
    const taskId = parseId(req.params.id);
    const parsed = moveTaskSchema.parse(req.body);
    const task = await moveTask(taskId, req.dbUser.id, parsed);
    res.json({ task });
  })
);
app.delete(
  "/api/tasks/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const taskId = parseId(req.params.id);
    const result = await deleteTask(taskId, req.dbUser.id);
    res.json(result);
  })
);
app.post(
  "/api/tasks/:id/comments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const taskId = parseId(req.params.id);
    const parsed = commentSchema.parse(req.body);
    const comment = await addTaskComment(taskId, req.dbUser.id, parsed.content);
    res.status(201).json({ comment });
  })
);
app.patch(
  "/api/comments/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const commentId = parseId(req.params.id);
    const parsed = commentSchema.parse(req.body);
    const comment = await updateTaskComment(commentId, req.dbUser.id, parsed.content);
    res.json({ comment });
  })
);
app.delete(
  "/api/comments/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const commentId = parseId(req.params.id);
    const result = await deleteTaskComment(commentId, req.dbUser.id);
    res.json(result);
  })
);
app.get(
  "/api/activity",
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId2 = typeof req.query.projectId === "string" && req.query.projectId !== "ALL" ? parseId(req.query.projectId) : void 0;
    const page = typeof req.query.page === "string" ? Number(req.query.page) : 1;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 30;
    const feed = await listAccessibleActivities(req.dbUser.id, {
      projectId: projectId2,
      page,
      limit
    });
    res.json(feed);
  })
);
app.get(
  "/api/notifications",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await getUserNotifications(req.dbUser.id);
    res.json(data);
  })
);
app.patch(
  "/api/notifications/:id/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const notification = await markNotificationRead(req.dbUser.id, id);
    res.json({ notification });
  })
);
app.post(
  "/api/notifications/read-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    await markAllNotificationsRead(req.dbUser.id);
    res.json({ success: true });
  })
);
app.use((err, req, res, next) => {
  if (!req.path.startsWith("/api/")) {
    next(err);
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: err.issues[0]?.message || "Validation failed.",
      issues: err.issues
    });
    return;
  }
  if (isAppError(err)) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err && typeof err === "object" && "type" in err && err.type === "entity.too.large") {
    res.status(413).json({ error: "Uploaded file exceeds the 2 MB size limit." });
    return;
  }
  if (err instanceof Error && err.message === "Invalid numeric identifier.") {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error("Unhandled API error:", err);
  res.status(500).json({ error: "An unexpected server error occurred." });
});
async function startServer() {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== "true"
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      const indexFile = path.join(distDir, "index.html");
      if (fs2.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send("Build artifacts not found.");
      }
    });
  }
  const port = Number(process.env.PORT) || 3e3;
  app.listen(port, "0.0.0.0", () => {
    console.log(`DevTrack server listening on http://0.0.0.0:${port}`);
  });
}
var server_default = app;
if (!process.env.VERCEL && !process.env.VITEST) {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
export {
  app,
  server_default as default
};
