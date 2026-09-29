// server/app.ts
import express from "express";
import { Webhook } from "svix";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import multer from "multer";
import { randomUUID as randomUUID3, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
import { z } from "zod";
import path3 from "node:path";

// server/db.ts
import "dotenv/config";
import knex from "knex";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
var isVercel = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
var dataDir = path.resolve(process.env.DATA_DIR || (isVercel ? "/tmp/.data" : ".data"));
try {
  fs.mkdirSync(dataDir, { recursive: true });
} catch {
}
var production = process.env.NODE_ENV === "production";
var isPostgres = !!process.env.DATABASE_URL;
var schema = process.env.DATABASE_SCHEMA || (isPostgres ? "public" : "helm");
function createMissingDbProxy() {
  const errFn = () => {
    throw new Error("DATABASE_URL is not configured on Vercel. Please add your Supabase DATABASE_URL in Vercel Project Settings (Settings -> Environment Variables).");
  };
  return new Proxy(errFn, {
    get: (_target, prop) => {
      if (prop === "then") return void 0;
      if (prop === "raw") return async () => {
        throw new Error("DATABASE_URL is missing on Vercel.");
      };
      return errFn;
    },
    apply: () => {
      errFn();
    }
  });
}
var db = !isPostgres && isVercel ? createMissingDbProxy() : knex(isPostgres ? {
  client: "pg",
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_NO_SSL === "true" ? false : {
      rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true",
      ...process.env.DATABASE_CA_FILE ? { ca: fs.readFileSync(process.env.DATABASE_CA_FILE, "utf8") } : {}
    }
  },
  searchPath: [schema],
  pool: { min: 0, max: 10 }
} : {
  client: "better-sqlite3",
  connection: { filename: path.join(dataDir, "helm.sqlite") },
  useNullAsDefault: true,
  pool: {
    min: 1,
    max: 1,
    afterCreate: (conn, done) => {
      try {
        conn.pragma("foreign_keys = ON");
        conn.pragma("journal_mode = WAL");
      } catch {
      }
      done(null, conn);
    }
  }
});
var now = () => (/* @__PURE__ */ new Date()).toISOString();
async function migrate() {
  if (!isPostgres && isVercel) {
    console.warn("[Vercel Serverless] DATABASE_URL is not set. Migrations skipped.");
    return;
  }
  if (isPostgres && schema !== "public") {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Invalid schema");
    await db.raw(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  }
  const m001 = {
    up: async (k) => {
      await k.schema.createTable("users", (t) => {
        t.uuid("id").primary();
        t.string("email").unique().notNullable();
        t.string("name").notNullable();
        t.string("password_hash");
        t.string("role").notNullable();
        t.boolean("verified").defaultTo(false);
        t.boolean("active").defaultTo(true);
        t.string("created_at").notNullable();
      });
      await k.schema.createTable("sessions", (t) => {
        t.string("id").primary();
        t.uuid("user_id").references("users.id").onDelete("CASCADE");
        t.string("expires_at").index();
      });
      await k.schema.createTable("projects", (t) => {
        t.uuid("id").primary();
        t.string("name").notNullable().unique();
        t.string("description");
        t.boolean("active").defaultTo(true);
        t.string("created_at");
      });
      await k.schema.createTable("memberships", (t) => {
        t.uuid("project_id").references("projects.id");
        t.uuid("user_id").references("users.id");
        t.primary(["project_id", "user_id"]);
      });
      await k.schema.createTable("invites", (t) => {
        t.string("id").primary();
        t.uuid("user_id").references("users.id");
        t.string("expires_at");
        t.boolean("used").defaultTo(false);
      });
      await k.schema.createTable("issues", (t) => {
        t.increments("number");
        t.uuid("id").unique().notNullable();
        t.string("reference").unique();
        t.uuid("project_id").references("projects.id").notNullable();
        t.uuid("reporter_id").references("users.id").notNullable();
        t.uuid("assignee_id").references("users.id");
        t.string("type");
        t.string("title");
        t.text("description");
        t.text("steps");
        t.text("expected");
        t.text("actual");
        t.text("reason");
        t.text("desired");
        t.text("notes");
        t.string("url", 2048);
        t.string("environment");
        t.string("build");
        t.string("severity");
        t.string("priority");
        t.string("category");
        t.string("status").index();
        t.integer("version").defaultTo(1);
        t.integer("cycle").defaultTo(0);
        t.boolean("archived").defaultTo(false);
        t.uuid("duplicate_of").references("issues.id");
        t.text("device");
        t.string("idempotency_key");
        t.string("created_at").index();
        t.string("updated_at");
        t.unique(["reporter_id", "idempotency_key"]);
      });
      await k.schema.createTable("comments", (t) => {
        t.uuid("id").primary();
        t.uuid("issue_id").references("issues.id").index();
        t.uuid("user_id").references("users.id");
        t.text("body");
        t.boolean("internal").defaultTo(false);
        t.string("created_at");
      });
      await k.schema.createTable("activity", (t) => {
        t.uuid("id").primary();
        t.uuid("issue_id").references("issues.id").index();
        t.uuid("user_id").references("users.id");
        t.string("action");
        t.text("detail");
        t.boolean("internal").defaultTo(false);
        t.string("created_at");
      });
      await k.schema.createTable("approvals", (t) => {
        t.uuid("id").primary();
        t.uuid("issue_id").references("issues.id");
        t.uuid("admin_id").references("users.id");
        t.integer("cycle");
        t.text("summary");
        t.string("build");
        t.string("test_url", 2048);
        t.string("created_at");
        t.unique(["issue_id", "cycle"]);
      });
      await k.schema.createTable("attachments", (t) => {
        t.uuid("id").primary();
        t.uuid("issue_id").references("issues.id");
        t.uuid("user_id").references("users.id");
        t.string("name");
        t.string("mime");
        t.integer("size");
        t.string("storage_key").unique();
        t.text("data_base64");
        t.string("created_at").index();
      });
      await k.schema.createTable("events", (t) => {
        t.uuid("id").primary();
        t.uuid("issue_id").references("issues.id");
        t.string("kind");
        t.integer("cycle");
        t.string("dedupe").unique();
        t.string("created_at");
      });
      await k.schema.createTable("deliveries", (t) => {
        t.uuid("id").primary();
        t.uuid("event_id").references("events.id").index();
        t.string("recipient");
        t.string("subject");
        t.text("html");
        t.text("text");
        t.string("state").index();
        t.integer("attempts").defaultTo(0);
        t.string("next_attempt").index();
        t.string("lease_until");
        t.string("first_claim_at");
        t.string("provider_id").index();
        t.string("error");
        t.string("token_hash");
        t.string("token_expires");
        t.string("created_at");
        t.string("updated_at");
        t.unique(["event_id", "recipient"]);
      });
      await k.schema.createTable("attempts", (t) => {
        t.uuid("id").primary();
        t.uuid("delivery_id").references("deliveries.id").index();
        t.string("state");
        t.string("error");
        t.string("execution_id");
        t.string("created_at");
      });
      await k.schema.createTable("settings", (t) => {
        t.integer("id").primary();
        t.integer("reminder_hours").defaultTo(48);
        t.boolean("digest_enabled").defaultTo(false);
        t.string("timezone").defaultTo("America/Chicago");
        t.string("digest_time").defaultTo("09:00");
        t.text("recipients").defaultTo("[]");
      });
      await k("settings").insert({ id: 1, reminder_hours: 48, timezone: "America/Chicago", digest_enabled: false, recipients: "[]", digest_time: "09:00" });
      await k.schema.createTable("audit", (t) => {
        t.uuid("id").primary();
        t.uuid("user_id").references("users.id");
        t.string("action");
        t.text("detail");
        t.string("created_at");
      });
      await k.schema.createTable("limits", (t) => {
        t.string("key").primary();
        t.integer("count");
        t.string("expires_at").index();
      });
    },
    down: async () => {
      throw new Error("Destructive rollback is intentionally unsupported; restore a verified backup.");
    }
  };
  const m002 = {
    up: async (k) => {
      const hasCol = await k.schema.hasColumn("issues", "assigned_to");
      if (!hasCol) {
        await k.schema.table("issues", (t) => {
          t.string("assigned_to").defaultTo("");
          t.string("assigned_role").defaultTo("");
        });
      }
    },
    down: async () => {
    }
  };
  const m003 = {
    up: async (k) => {
      const hasCol = await k.schema.hasColumn("attachments", "data_base64");
      if (!hasCol) {
        await k.schema.table("attachments", (t) => {
          t.text("data_base64");
        });
      }
    },
    down: async () => {
    }
  };
  await db.migrate.latest({ migrationSource: {
    getMigrations: async () => ["001", "002", "003"],
    getMigrationName: (m) => m,
    getMigration: async (m) => m === "001" ? m001 : m === "002" ? m002 : m003
  } });
  try {
    const guest = await db("users").where({ email: "guest@helm.local" }).first();
    if (!guest) {
      await db("users").insert({
        id: randomUUID(),
        email: "guest@helm.local",
        name: "Guest",
        role: "tester",
        password_hash: "",
        verified: true,
        active: true,
        created_at: now()
      });
    }
    const helmProject = await db("projects").where({ name: "Helm Platform" }).first();
    if (!helmProject) {
      await db("projects").insert({
        id: randomUUID(),
        name: "Helm Platform",
        description: "Core web experience",
        active: true,
        created_at: now()
      });
    }
    const glentreeProject = await db("projects").where({ name: "Glentree" }).first();
    if (!glentreeProject) {
      await db("projects").insert({
        id: randomUUID(),
        name: "Glentree",
        description: "Glentree workspace",
        active: true,
        created_at: now()
      });
    }
  } catch (err) {
    console.warn("[Helm Track] Default seeding notice:", err);
  }
}

// server/auth.ts
import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac } from "node:crypto";
var hash = (v) => createHash("sha256").update(v).digest("hex");
var token = () => randomBytes(32).toString("hex");
function passwordHash(password) {
  const salt = token();
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function passwordValid(password, stored) {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const a = scryptSync(password, salt, 64), b = Buffer.from(key, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
var fail = (status, message) => Object.assign(new Error(message), { status });
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active, verified: !!u.verified };
}
async function auth(req, res, next) {
  try {
    const cookie = req.cookies?.helm_session;
    if (!cookie) throw fail(401, "Please sign in.");
    const session2 = await db("sessions").where({ id: hash(cookie) }).where("expires_at", ">", now()).first();
    const user = session2 && await db("users").where({ id: session2.user_id, active: true, verified: true }).first();
    if (!user) throw fail(401, "Your session expired. Please sign in.");
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}
var admin = (req, res, next) => {
  if (req.user.role !== "admin") return next(fail(403, "Administrator access required."));
  next();
};
async function session(res, userId) {
  const secret = token();
  await db("sessions").insert({ id: hash(secret), user_id: userId, expires_at: new Date(Date.now() + 7 * 864e5).toISOString() });
  res.cookie("helm_session", secret, { httpOnly: true, secure: production, sameSite: "lax", path: "/", maxAge: 7 * 864e5 });
}
async function accessible(q, user, id) {
  const issue = await q("issues").where({ id }).first();
  if (!issue || user.role !== "admin" && issue.reporter_id !== user.id) throw fail(404, "Issue not found.");
  return issue;
}
function signDownload(id, userId, expires) {
  return createHmac("sha256", process.env.SESSION_SECRET || "local-development-only").update(`${id}:${userId}:${expires}`).digest("hex");
}
async function rateLimit(key, max, minutes) {
  const bucket2 = Math.floor(Date.now() / (minutes * 6e4));
  const k = hash(`${key}:${bucket2}`);
  const [row] = await db("limits").insert({ key: k, count: 1, expires_at: new Date((bucket2 + 1) * minutes * 6e4).toISOString() }).onConflict("key").merge({ count: db.raw("?? + 1", ["limits.count"]) }).returning("count");
  if (row.count > max) throw fail(429, "Too many requests. Please try again later.");
}

// server/notifications.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var appURL = () => {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:5173";
};
var escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function template(title, body, link, label = "Open issue") {
  const name = process.env.EMAIL_SENDER_NAME || "Helm Track";
  return { text: `${title}

${body}

${label}: ${link}

${name}`, html: `<!doctype html><html><body style="background:#f4f5f1;font-family:Arial,sans-serif;color:#203b34;padding:24px"><div style="max-width:560px;margin:auto;background:white;padding:32px;border-radius:16px"><p style="font-weight:bold;letter-spacing:2px">HELM TRACK</p><h1 style="font-size:24px">${escape(title)}</h1><p style="white-space:pre-wrap;line-height:1.7">${escape(body)}</p><a href="${escape(link)}" style="display:inline-block;background:#234c40;color:white;text-decoration:none;border-radius:8px;padding:14px 20px">${escape(label)}</a><p style="color:#777;margin-top:30px">${escape(name)}</p></div></body></html>` };
}
async function queue(q, { issue, kind, body, dedupe, recipients, subject, link }) {
  const exists = await q("events").where({ dedupe }).first();
  if (exists) return exists.id;
  const eventId = randomUUID2();
  await q("events").insert({ id: eventId, issue_id: issue?.id || null, kind, cycle: issue?.cycle || 0, dedupe, created_at: now() });
  const settings = await q("settings").where({ id: 1 }).first();
  const admins = await q("users").where({ role: "admin", active: true, verified: true });
  const to = recipients || [...admins.map((a) => a.email), ...JSON.parse(settings.recipients || "[]")];
  const title = subject || `[${issue.reference}] ${kind === "new" ? "New submission" : kind === "retest" ? "Fix ready \u2014 please retest" : kind === "reminder" ? "Reminder \u2014 please retest" : kind === "verified" ? "Fix verified" : kind === "reopened" ? "Issue reopened" : kind === "information" ? "More information needed" : "Issue updated"}: ${issue.title}`;
  const content = template(title, body, link || `${appURL()}/?issue=${issue.id}`);
  for (const recipient of [...new Set(to.map((s) => s.trim().toLowerCase()))]) await q("deliveries").insert({ id: randomUUID2(), event_id: eventId, recipient, subject: title, ...content, state: "queued", attempts: 0, next_attempt: now(), created_at: now(), updated_at: now() });
  return eventId;
}
async function applicable(q, event) {
  if (!event.issue_id) return true;
  const i = await q("issues").where({ id: event.issue_id }).first();
  if (!i) return false;
  if (["retest", "reminder"].includes(event.kind)) return i.status === "Ready for Retest" && i.cycle === event.cycle && !i.archived;
  return true;
}
async function schedule() {
  const settings = await db("settings").where({ id: 1 }).first();
  const issues = await db("issues").where({ status: "Ready for Retest", archived: false });
  for (const i of issues) {
    const approval = await db("approvals").where({ issue_id: i.id, cycle: i.cycle }).first();
    if (!approval) continue;
    const elapsed = Date.now() - Date.parse(approval.created_at);
    const n = Math.min(2, Math.floor(elapsed / (settings.reminder_hours * 36e5)));
    if (n < 1) continue;
    await db.transaction(async (q) => {
      const current = await q("issues").where({ id: i.id, status: "Ready for Retest", cycle: i.cycle, archived: false }).first();
      if (!current) return;
      const reporter = await q("users").where({ id: i.reporter_id }).first();
      await queue(q, { issue: i, kind: "reminder", dedupe: `reminder:${i.id}:${i.cycle}:${n}`, recipients: [reporter.email], body: `Hi ${reporter.name},

Your report is awaiting a retest.

${approval.summary}

Please choose \u201CVerified \u2014 fixed\u201D or \u201CStill happening\u201D on the issue. We will never close an issue because you have not replied.` });
    });
  }
  if (settings.digest_enabled) {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(/* @__PURE__ */ new Date());
    const get = (s) => p.find((x) => x.type === s)?.value;
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    if (`${get("hour")}:${get("minute")}` >= settings.digest_time) {
      const all = await db("issues").where({ archived: false }).whereNotIn("status", ["Closed", "Duplicate"]);
      await db.transaction((q) => queue(q, { kind: "digest", dedupe: `digest:${date}`, subject: "Helm Track \u2014 daily issue overview", body: `Open: ${all.length}
New: ${all.filter((i) => i.status === "New").length}
Reopened: ${all.filter((i) => i.status === "Reopened").length}
Older than 7 days: ${all.filter((i) => Date.now() - Date.parse(i.created_at) > 7 * 864e5).length}`, link: appURL() }));
    }
  }
}

// server/storage.ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs2 from "node:fs/promises";
import path2 from "node:path";
var s3 = process.env.S3_ENDPOINT ? new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || "us-east-1", forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID || "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "" } }) : null;
var bucket = process.env.S3_BUCKET || "helm-screenshots";
var sharpModule = null;
async function getSharp() {
  if (sharpModule === null) {
    try {
      const s = await import("sharp");
      sharpModule = s.default || s;
    } catch {
      sharpModule = false;
    }
  }
  return sharpModule;
}
async function validateImage(buffer, mime) {
  const normMime = (mime || "").toLowerCase().trim();
  const isJpgMime = normMime === "image/jpeg" || normMime === "image/jpg" || normMime === "image/pjpeg";
  const isPngMime = normMime === "image/png";
  const isWebpMime = normMime === "image/webp";
  const format = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png" : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 ? "jpeg" : buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" ? "webp" : null;
  if (!format) throw fail(400, "Only valid PNG, JPEG and WebP screenshots are allowed.");
  if (format === "png" && !isPngMime) throw fail(400, "Invalid image format (PNG expected).");
  if (format === "jpeg" && !isJpgMime) throw fail(400, "Invalid image format (JPEG expected).");
  if (format === "webp" && !isWebpMime) throw fail(400, "Invalid image format (WebP expected).");
  try {
    const sharp = await getSharp();
    if (sharp) {
      const meta = await sharp(buffer, { limitInputPixels: 4e7 }).metadata();
      if (meta.pages && meta.pages > 1) throw new Error("Animated image");
      return await sharp(buffer, { limitInputPixels: 4e7 }).toFormat(format).toBuffer();
    }
  } catch (err) {
    if (err.message === "Animated image") throw fail(400, "The image is animated.");
  }
  return buffer;
}
async function put(key, buffer, mime) {
  if (s3) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mime }));
  else {
    const uploadDir = path2.join(dataDir, "uploads");
    try {
      await fs2.mkdir(uploadDir, { recursive: true });
    } catch {
    }
    await fs2.writeFile(path2.join(uploadDir, key), buffer, { mode: 384 });
  }
}
async function remove(key) {
  if (s3) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  else await fs2.rm(path2.join(dataDir, "uploads", key), { force: true });
}
async function download(key) {
  return s3 ? { url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 }) } : { file: path2.join(dataDir, "uploads", key) };
}

// server/app.ts
var statuses = ["New", "Under Review", "In Progress", "Ready for Retest", "Closed", "Reopened", "Needs Information", "Deferred", "Duplicate"];
var url = z.union([z.literal(""), z.url().refine((v) => /^https?:\/\//i.test(v), "Use an HTTP or HTTPS URL.")]).default("");
var text = z.string().trim().max(15e3).default("");
var issueInput = z.object({ project_id: z.uuid(), type: z.enum(["Bug", "Improvement"]), title: z.string().trim().min(3).max(180), description: z.string().trim().min(10).max(15e3), steps: text, expected: text, actual: text, reason: text, desired: text, notes: text, url, environment: z.enum(["development", "staging", "production"]), build: z.string().max(100).default(""), severity: z.enum(["Low", "Medium", "High", "Critical"]), device: z.string().max(1e3).default(""), attachments: z.array(z.uuid()).max(5).default([]), idempotency_key: z.uuid() }).superRefine((v, c) => {
  for (const key of v.type === "Bug" ? ["steps", "expected", "actual"] : ["reason", "desired"]) if (!v[key]) c.addIssue({ code: "custom", path: [key], message: "This field is required." });
});
async function audit(q, user, action, detail) {
  await q("audit").insert({ id: randomUUID3(), user_id: user.id, action, detail, created_at: now() });
}
async function activity(q, i, u, action, detail, internal = false) {
  await q("activity").insert({ id: randomUUID3(), issue_id: i.id, user_id: u.id, action, detail, internal, created_at: now() });
}
async function attach(q, ids, issueId, userId) {
  if (!ids.length) return;
  const files = await q("attachments").whereIn("id", ids).where({ user_id: userId }).whereNull("issue_id");
  if (files.length !== new Set(ids).size) throw fail(400, "An attachment is unavailable. Please upload it again.");
  const bound = await q("attachments").whereIn("id", ids).where({ user_id: userId }).whereNull("issue_id").update({ issue_id: issueId });
  if (bound !== new Set(ids).size) throw fail(409, "An upload was already attached. Please refresh.");
}
function createApp() {
  const app2 = express();
  app2.disable("x-powered-by");
  app2.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 0));
  app2.use(helmet({ contentSecurityPolicy: production ? void 0 : false }));
  app2.post("/api/provider/resend", express.raw({ type: "application/json", limit: "100kb" }), async (req, res) => {
    if (!process.env.RESEND_WEBHOOK_SECRET) throw fail(503, "Delivery webhook is not configured.");
    let event;
    try {
      event = new Webhook(process.env.RESEND_WEBHOOK_SECRET).verify(req.body.toString("utf8"), { "svix-id": req.get("svix-id") || "", "svix-timestamp": req.get("svix-timestamp") || "", "svix-signature": req.get("svix-signature") || "" });
    } catch {
      throw fail(401, "Invalid webhook signature.");
    }
    if (["email.delivered", "email.bounced"].includes(event.type) && typeof event.data?.email_id === "string") {
      const state = event.type === "email.delivered" ? "delivered" : "bounced";
      await db("deliveries").where({ provider_id: event.data.email_id }).whereIn("state", state === "bounced" ? ["provider-accepted", "delivered"] : ["provider-accepted"]).update({ state, updated_at: now() });
    }
    res.json({ ok: true });
  });
  app2.use(express.json({ limit: "100kb" }));
  app2.use(cookieParser());
  app2.use("/api", async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !req.path.startsWith("/integration/")) {
        const origin = req.get("origin");
        if (origin) {
          const originUrl = new URL(origin);
          const host = req.get("host");
          const isSameHost = host && originUrl.host === host;
          const isConfiguredApp = origin === new URL(appURL()).origin;
          const isVercelOrigin = originUrl.hostname.endsWith(".vercel.app") || originUrl.hostname === "localhost" || originUrl.hostname === "127.0.0.1";
          if (!isSameHost && !isConfiguredApp && !isVercelOrigin) throw fail(403, "Request origin is not allowed.");
        }
        if (!req.get("x-helm-request")) throw fail(403, "Missing request protection header.");
      }
      await rateLimit(`api:${req.ip}`, 600, 1);
      next();
    } catch (e) {
      next(e);
    }
  });
  app2.get("/api/health", async (req, res) => {
    let dbOk = false;
    let dbErr = null;
    try {
      if (isPostgres || !isVercel) {
        await db.raw("select 1");
        dbOk = true;
      }
    } catch (e) {
      dbErr = e.message;
    }
    res.json({ ok: true, database: isPostgres ? "postgres" : "sqlite", databaseConnected: dbOk, dbError: dbErr, isVercel, mode: production ? "production" : "local" });
  });
  app2.get("/api/db-status", async (req, res) => {
    try {
      await db.raw("select 1");
      const projects = await db("projects").select("id", "name");
      const count = await db("issues").count({ total: "id" }).first();
      res.json({ ok: true, connected: true, driver: isPostgres ? "postgres" : "sqlite", database: isPostgres ? "PostgreSQL (Connected)" : "Local SQLite (Active)", isVercel, projectsCount: projects.length, issuesCount: Number(count?.total || 0) });
    } catch (e) {
      res.status(500).json({ ok: false, connected: false, driver: isPostgres ? "postgres" : "sqlite", error: e.message || "Database query failed" });
    }
  });
  app2.get("/api/auth/me", auth, (req, res) => res.json({ user: publicUser(req.user), mode: production ? "production" : "local" }));
  app2.post("/api/auth/login", async (req, res) => {
    await rateLimit(`login:${req.ip}`, 15, 15);
    const data = z.object({ email: z.email().max(254), password: z.string().max(256) }).parse(req.body);
    const u = await db("users").where({ email: data.email.toLowerCase() }).first();
    const valid = passwordValid(data.password, u?.password_hash || passwordHash("invalid-placeholder-password"));
    if (!u || !valid || !u.active || !u.verified) throw fail(401, "Email or password is incorrect.");
    await session(res, u.id);
    res.json({ user: publicUser(u) });
  });
  app2.post("/api/auth/logout", auth, async (req, res) => {
    await db("sessions").where({ id: hash(req.cookies.helm_session) }).delete();
    res.clearCookie("helm_session", { path: "/" });
    res.json({ ok: true });
  });
  app2.post("/api/auth/accept-invite", async (req, res) => {
    await rateLimit(`invite:${req.ip}`, 15, 15);
    const d = z.object({ token: z.string().length(64), name: z.string().trim().min(2).max(100), password: z.string().min(12).max(256) }).parse(req.body);
    let uid = "";
    await db.transaction(async (q) => {
      const i = await q("invites").where({ id: hash(d.token), used: false }).where("expires_at", ">", now()).first();
      if (!i) throw fail(400, "Invitation expired or already used. Ask your admin for another invitation.");
      const changed = await q("invites").where({ id: i.id, used: false }).update({ used: true });
      if (!changed) throw fail(409, "Invitation already used.");
      uid = i.user_id;
      await q("users").where({ id: uid }).update({ name: d.name, password_hash: passwordHash(d.password), verified: true });
    });
    await session(res, uid);
    res.json({ ok: true });
  });
  const guestUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  app2.post("/api/guest/upload", guestUpload.single("file"), async (req, res) => {
    if (!req.file) throw fail(400, "Choose a screenshot.");
    let guestUser = await db("users").where({ email: "guest@helm.local" }).first();
    if (!guestUser) {
      const gid = randomUUID3();
      await db("users").insert({ id: gid, email: "guest@helm.local", name: "Guest", role: "tester", password_hash: "", verified: true, active: true, created_at: now() });
      guestUser = await db("users").where({ id: gid }).first();
    }
    const bytes = await validateImage(req.file.buffer, req.file.mimetype);
    const id = randomUUID3();
    await put(id, bytes, req.file.mimetype);
    const base64Data = bytes.toString("base64");
    try {
      await db("attachments").insert({ id, user_id: guestUser ? guestUser.id : null, name: path3.basename(req.file.originalname).slice(0, 200), mime: req.file.mimetype, size: bytes.length, storage_key: id, data_base64: base64Data, created_at: now() });
    } catch (e) {
      try {
        await db("attachments").insert({ id, user_id: guestUser ? guestUser.id : null, name: path3.basename(req.file.originalname).slice(0, 200), mime: req.file.mimetype, size: bytes.length, storage_key: id, created_at: now() });
      } catch (err) {
        await remove(id);
        throw e;
      }
    }
    res.status(201).json({ id, name: req.file.originalname, size: bytes.length });
  });
  app2.get("/api/guest/attachments/:id", async (req, res) => {
    const a = await db("attachments").where({ id: req.params.id }).first();
    if (!a) throw fail(404, "Screenshot not found.");
    res.setHeader("Content-Type", a.mime || "image/png");
    res.setHeader("Content-Disposition", "inline");
    if (a.data_base64) {
      return res.send(Buffer.from(a.data_base64, "base64"));
    }
    const f = await download(a.storage_key);
    if (f.url) return res.redirect(f.url);
    if (f.file) return res.sendFile(f.file);
    throw fail(404, "Screenshot file missing.");
  });
  app2.post("/api/guest/submit", async (req, res) => {
    await rateLimit("guest:" + req.ip, 20, 60);
    const d = z.object({
      reporter_name: z.string().trim().min(2).max(100),
      reporter_role: z.enum(["tester", "developer"]).default("tester"),
      issue: z.string().trim().min(5).max(15e3),
      expected: z.string().trim().min(3).max(15e3),
      assigned_to: z.string().trim().max(100).default(""),
      assigned_role: z.enum(["tester", "developer", ""]).default(""),
      type: z.enum(["Bug", "Improvement", "Question"]).default("Bug"),
      project_id: z.string().optional(),
      attachments: z.array(z.uuid()).max(5).default([]),
      idempotency_key: z.uuid()
    }).parse(req.body);
    let guestUser = await db("users").where({ email: "guest@helm.local" }).first();
    if (!guestUser) {
      const gid = randomUUID3();
      await db("users").insert({ id: gid, email: "guest@helm.local", name: "Guest", role: "tester", password_hash: "", verified: true, active: true, created_at: now() });
      guestUser = await db("users").where({ id: gid }).first();
      const firstProject = await db("projects").where({ active: true }).first();
      if (firstProject) await db("memberships").insert({ project_id: firstProject.id, user_id: gid }).onConflict(["project_id", "user_id"]).ignore();
    }
    const existing = await db("issues").where({ reporter_id: guestUser.id, idempotency_key: d.idempotency_key }).first();
    if (existing) return res.json(existing);
    const project = (d.project_id ? await db("projects").where({ id: d.project_id, active: true }).first() : null) || await db("projects").where({ active: true }).first();
    if (!project) throw fail(503, "No active project found. Ask an admin to create one.");
    let saved;
    await db.transaction(async (q) => {
      if (d.attachments.length) {
        const files = await q("attachments").whereIn("id", d.attachments).whereNull("issue_id");
        if (files.length !== new Set(d.attachments).size) throw fail(400, "An attachment is unavailable. Please upload it again.");
      }
      const title = "[" + d.reporter_name + "] " + d.issue.slice(0, 160);
      const [i] = await q("issues").insert({
        id: randomUUID3(),
        project_id: project.id,
        reporter_id: guestUser.id,
        type: d.type,
        title: title.slice(0, 180),
        description: d.issue,
        steps: "",
        expected: d.expected,
        actual: "",
        reason: "",
        desired: "",
        notes: "",
        url: "",
        environment: "staging",
        build: "",
        severity: "Medium",
        priority: "Medium",
        category: "General",
        status: "New",
        version: 1,
        cycle: 0,
        archived: false,
        assigned_to: d.assigned_to,
        assigned_role: d.assigned_role,
        device: "Submitted by " + d.reporter_name + " (" + d.reporter_role + ")",
        idempotency_key: d.idempotency_key,
        created_at: now(),
        updated_at: now()
      }).returning("*");
      const prefix = d.type === "Improvement" ? "IMP-" : d.type === "Question" ? "QST-" : "BUG-";
      i.reference = prefix + String(i.number).padStart(6, "0");
      await q("issues").where({ id: i.id }).update({ reference: i.reference });
      if (d.attachments.length) await q("attachments").whereIn("id", d.attachments).whereNull("issue_id").update({ issue_id: i.id, user_id: guestUser.id });
      const submitDetail = d.assigned_to ? "Submitted by " + d.reporter_name + " (" + d.reporter_role + ") \xB7 Assigned to " + d.assigned_to + " (" + d.assigned_role + ")" : "Submitted by " + d.reporter_name + " (" + d.reporter_role + ")";
      await q("activity").insert({ id: randomUUID3(), issue_id: i.id, user_id: guestUser.id, action: d.reporter_name + " (" + d.reporter_role + ")", detail: submitDetail, internal: false, created_at: now() });
      saved = i;
    });
    res.status(201).json(saved);
  });
  app2.get("/api/guest/projects", async (req, res) => {
    const list = await db("projects").where({ active: true }).select("id", "name", "description");
    res.json(list);
  });
  app2.get("/api/guest/issues", async (req, res) => {
    const rows = await db("issues").join("users", "users.id", "issues.reporter_id").join("projects", "projects.id", "issues.project_id").where("users.email", "guest@helm.local").whereNot("issues.archived", true).select("issues.id", "issues.reference", "issues.type", "issues.title", "issues.description", "issues.expected", "issues.status", "issues.severity", "issues.created_at", "issues.assigned_to", "issues.assigned_role", "issues.device", "users.name as reporter_name", "projects.name as project_name", "projects.id as project_id").orderBy("issues.created_at", "desc").limit(200);
    const withFiles = await Promise.all(rows.map(async (i) => {
      const attachments = await db("attachments").where({ issue_id: i.id }).select("id", "name", "mime", "size");
      return { ...i, attachments };
    }));
    res.json(withFiles);
  });
  app2.get("/api/guest/issues/:id/log", async (req, res) => {
    const guestUser = await db("users").where({ email: "guest@helm.local" }).first();
    if (!guestUser) return res.json([]);
    const issue = await db("issues").where({ id: req.params.id, reporter_id: guestUser.id }).first();
    if (!issue) throw fail(404, "Issue not found.");
    const log = await db("activity").where({ issue_id: issue.id }).orderBy("created_at", "asc");
    res.json(log);
  });
  app2.patch("/api/guest/issues/:id", async (req, res) => {
    const d = z.object({
      actor_name: z.string().trim().min(1).max(100),
      actor_role: z.enum(["tester", "developer"]),
      assigned_to: z.string().trim().max(100).optional(),
      assigned_role: z.enum(["tester", "developer", ""]).optional(),
      status: z.string().max(60).optional(),
      note: z.string().trim().max(5e3).optional()
    }).parse(req.body);
    const guestUser = await db("users").where({ email: "guest@helm.local" }).first();
    if (!guestUser) throw fail(404, "Guest user not found.");
    const issue = await db("issues").where({ id: req.params.id, reporter_id: guestUser.id }).first();
    if (!issue) throw fail(404, "Issue not found.");
    const updates = { updated_at: now(), version: issue.version + 1 };
    if (d.assigned_to !== void 0) updates.assigned_to = d.assigned_to;
    if (d.assigned_role !== void 0) updates.assigned_role = d.assigned_role;
    if (d.status) updates.status = d.status;
    const parts = [];
    if (d.assigned_to !== void 0) parts.push(d.assigned_to ? "Assigned to " + d.assigned_to + " (" + d.assigned_role + ")" : "Unassigned");
    if (d.status) parts.push("Status \u2192 " + d.status);
    const action = d.actor_name + " (" + d.actor_role + ")";
    const detail = [parts.join(" \xB7 "), d.note].filter(Boolean).join(" \u2014 ");
    await db.transaction(async (q) => {
      await q("issues").where({ id: issue.id }).update(updates);
      await q("activity").insert({ id: randomUUID3(), issue_id: issue.id, user_id: guestUser.id, action, detail, internal: false, created_at: now() });
    });
    res.json({ ok: true });
  });
  app2.use("/api", (req, res, next) => req.path.startsWith("/integration/") ? next() : auth(req, res, next));
  app2.get("/api/projects", async (req, res) => {
    const u = req.user;
    let query = db("projects").where({ "projects.active": true });
    if (u.role !== "admin") query = query.join("memberships", "projects.id", "memberships.project_id").where("memberships.user_id", u.id);
    res.json(await query.select("projects.*"));
  });
  app2.get("/api/issues", async (req, res) => {
    const u = req.user;
    const page = Math.max(1, Math.min(1e5, Number(req.query.page) || 1));
    let q = db("issues").join("projects", "projects.id", "issues.project_id").join("users", "users.id", "issues.reporter_id").where("issues.archived", req.query.archived === "true");
    if (u.role !== "admin") q = q.where("reporter_id", u.id);
    if (req.query.status) q = q.where("status", String(req.query.status));
    if (req.query.project) q = q.where("project_id", String(req.query.project));
    if (req.query.type) q = q.where("type", String(req.query.type));
    if (req.query.severity) q = q.where("severity", String(req.query.severity));
    if (req.query.search) {
      const s = `%${String(req.query.search).slice(0, 100).toLowerCase()}%`;
      q = q.where(function() {
        this.whereRaw("lower(issues.title) like ?", [s]).orWhereRaw("lower(issues.reference) like ?", [s]);
      });
    }
    const count = await q.clone().count({ total: "issues.id" }).first();
    const sort = req.query.sort === "oldest" ? "asc" : "desc";
    const rows = await q.select("issues.*", "projects.name as project_name", "users.name as reporter_name").orderBy("issues.created_at", sort).limit(25).offset((page - 1) * 25);
    res.json({ issues: rows, total: Number(count?.total || 0), page });
  });
  app2.get("/api/stats", async (req, res) => {
    const u = req.user;
    let q = db("issues").where({ archived: false });
    if (u.role !== "admin") q = q.where("reporter_id", u.id);
    const rows = await q;
    const counts = Object.fromEntries(statuses.map((s) => [s, rows.filter((i) => i.status === s).length]));
    res.json({ counts, total: rows.length, open: rows.filter((i) => !["Closed", "Duplicate"].includes(i.status)).length, critical: rows.filter((i) => ["High", "Critical"].includes(i.severity) && !["Closed", "Duplicate"].includes(i.status)).length, aging: rows.filter((i) => !["Closed", "Duplicate"].includes(i.status) && Date.now() - Date.parse(i.created_at) > 7 * 864e5).length, failed: u.role === "admin" ? Number((await db("deliveries").whereIn("state", ["failed", "uncertain"]).count({ n: "id" }).first())?.n) : 0 });
  });
  app2.post("/api/issues", async (req, res) => {
    const u = req.user;
    await rateLimit(`submit:${u.id}`, 30, 60);
    const d = issueInput.parse(req.body);
    const existing = await db("issues").where({ reporter_id: u.id, idempotency_key: d.idempotency_key }).first();
    if (existing) return res.json(existing);
    let saved;
    try {
      await db.transaction(async (q) => {
        const p = await q("projects").where({ id: d.project_id, active: true }).first();
        const member = u.role === "admin" || await q("memberships").where({ project_id: d.project_id, user_id: u.id }).first();
        if (!p || !member) throw fail(403, "You do not have access to that project.");
        const { attachments, ...fields } = d;
        const [i] = await q("issues").insert({ ...fields, id: randomUUID3(), reporter_id: u.id, status: "New", priority: "Medium", category: "General", created_at: now(), updated_at: now() }).returning("*");
        i.reference = `${i.type === "Bug" ? "BUG" : "IMP"}-${String(i.number).padStart(6, "0")}`;
        await q("issues").where({ id: i.id }).update({ reference: i.reference });
        await attach(q, attachments, i.id, u.id);
        await activity(q, i, u, "Submitted", `${i.type} reported by ${u.name}`);
        await queue(q, { issue: i, kind: "new", dedupe: `new:${i.id}`, body: `${i.reference} \xB7 ${i.type} \xB7 ${i.severity}
Reporter: ${u.name} (${u.email})

${i.description}` });
        await queue(q, { issue: i, kind: "acknowledgment", dedupe: `ack:${i.id}`, recipients: [u.email], subject: `[${i.reference}] We received your report`, body: `Hi ${u.name},

Thanks for helping improve ${p.name}. Your report has been saved with reference ${i.reference}. You can follow its progress and add details on the issue page.` });
        saved = i;
      });
    } catch (e) {
      const duplicate = await db("issues").where({ reporter_id: u.id, idempotency_key: d.idempotency_key }).first();
      if (duplicate) return res.json(duplicate);
      throw e;
    }
    res.status(201).json(saved);
  });
  app2.get("/api/issues/:id", async (req, res) => {
    const u = req.user;
    const i = await accessible(db, u, String(req.params.id));
    const [reporter, project, comments, history, attachments, approval] = await Promise.all([db("users").where({ id: i.reporter_id }).first(), db("projects").where({ id: i.project_id }).first(), db("comments").join("users", "users.id", "comments.user_id").where("issue_id", i.id).modify((q) => {
      if (u.role !== "admin") q.where("internal", false);
    }).select("comments.*", "users.name as name").orderBy("created_at"), db("activity").join("users", "users.id", "activity.user_id").where("issue_id", i.id).modify((q) => {
      if (u.role !== "admin") q.where("internal", false);
    }).select("activity.*", "users.name as name").orderBy("created_at"), db("attachments").where({ issue_id: i.id }).select("id", "name", "mime", "size"), db("approvals").where({ issue_id: i.id, cycle: i.cycle }).first()]);
    const notifications = u.role === "admin" ? await db("deliveries").join("events", "events.id", "deliveries.event_id").where("events.issue_id", i.id).select("deliveries.id", "deliveries.recipient", "deliveries.state", "deliveries.error", "deliveries.attempts", "deliveries.created_at", "events.kind") : [];
    res.json({ ...i, reporter: publicUser(reporter), project, comments, history, attachments, approval, notifications });
  });
  app2.post("/api/issues/:id/action", async (req, res) => {
    const u = req.user;
    const d = z.object({ action: z.enum(["approve", "verify", "reopen", "status", "information", "update", "archive"]), version: z.number().int().positive(), summary: text, note: text, build: z.string().max(100).default(""), test_url: url, status: z.enum(statuses).optional(), priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional(), severity: z.enum(["Low", "Medium", "High", "Critical"]).optional(), category: z.string().max(80).optional(), type: z.enum(["Bug", "Improvement"]).optional(), assignee_id: z.uuid().nullable().optional(), duplicate_of: z.uuid().nullable().optional(), attachments: z.array(z.uuid()).max(5).default([]) }).parse(req.body);
    await db.transaction(async (q) => {
      const i = await accessible(q, u, String(req.params.id));
      if (i.version !== d.version) throw fail(409, "This issue changed. Refresh it before making another update.");
      const isAdmin = u.role === "admin";
      if (!isAdmin && !["verify", "reopen"].includes(d.action)) throw fail(403, "Administrator access required.");
      if (!isAdmin && i.status !== "Ready for Retest") throw fail(409, "This issue is not awaiting retesting.");
      const updates = { version: i.version + 1, updated_at: now() };
      let detail = d.note, kind = "";
      if (d.action === "approve") {
        if (!d.summary.trim()) throw fail(400, "A fix summary is required.");
        if (i.archived || ["Closed", "Duplicate", "Ready for Retest"].includes(i.status)) throw fail(409, "Reopen this issue before requesting a new retest.");
        updates.status = "Ready for Retest";
        updates.cycle = i.cycle + 1;
        await q("approvals").insert({ id: randomUUID3(), issue_id: i.id, admin_id: u.id, cycle: updates.cycle, summary: d.summary, build: d.build, test_url: d.test_url, created_at: now() });
        detail = d.summary;
        kind = "retest";
      }
      if (d.action === "verify") {
        if (u.id !== i.reporter_id) throw fail(403, "Only the reporter can verify a fix. Administrators can close manually with a reason.");
        if (i.status !== "Ready for Retest") throw fail(409, "This issue is not awaiting retesting.");
        updates.status = "Closed";
        detail = "Reporter verified the fix.";
        kind = "verified";
      }
      if (d.action === "reopen") {
        if (!d.note.trim()) throw fail(400, "Please describe what is still happening.");
        if (!isAdmin && i.status !== "Ready for Retest") throw fail(409, "This issue is not awaiting retesting.");
        updates.status = "Reopened";
        kind = "reopened";
      }
      if (d.action === "information") {
        if (!d.note.trim()) throw fail(400, "Enter the information you need.");
        updates.status = "Needs Information";
        kind = "information";
      }
      if (d.action === "status") {
        if (!d.status || ["Ready for Retest", "Needs Information"].includes(d.status)) throw fail(400, "Use the dedicated approval or information action.");
        if (["Closed", "Duplicate"].includes(d.status) && !d.note.trim()) throw fail(400, "A reason is required.");
        if (d.status === "Duplicate") {
          if (!d.duplicate_of || d.duplicate_of === i.id || !await q("issues").where({ id: d.duplicate_of }).first()) throw fail(400, "Choose another valid issue ID for the duplicate.");
          updates.duplicate_of = d.duplicate_of;
        }
        updates.status = d.status;
      }
      if (d.action === "update") {
        for (const key of ["priority", "severity", "category", "type", "assignee_id"]) if (d[key] !== void 0) updates[key] = d[key];
        if (d.assignee_id && !await q("users").where({ id: d.assignee_id, role: "admin", active: true }).first()) throw fail(400, "Assign to an active administrator.");
        detail = "Issue fields updated.";
      }
      if (d.action === "archive") {
        updates.archived = !i.archived;
        detail = updates.archived ? "Issue archived." : "Issue restored.";
      }
      const changed = await q("issues").where({ id: i.id, version: d.version }).update(updates);
      if (!changed) throw fail(409, "This issue changed. Refresh and try again.");
      await attach(q, d.attachments, i.id, u.id);
      await activity(q, i, u, updates.status ? `${i.status} \u2192 ${updates.status}` : d.action, detail);
      if (isAdmin) await audit(q, u, d.action, i.reference);
      if (kind) {
        const reporter = await q("users").where({ id: i.reporter_id }).first();
        const recipients = ["retest", "information"].includes(kind) ? [reporter.email] : void 0;
        const body = kind === "retest" ? `Hi ${reporter.name},

A fix for \u201C${i.title}\u201D is ready for you to test.

What changed:
${d.summary}

${d.build ? `Version/build: ${d.build}
` : ""}${d.test_url ? `Test here: ${d.test_url}
` : ""}
Please open the issue and choose \u201CVerified \u2014 fixed\u201D if it works, or \u201CStill happening\u201D if you can reproduce the problem.` : detail;
        await queue(q, { issue: { ...i, ...updates }, kind, dedupe: `${kind}:${i.id}:${updates.version}`, recipients, body });
      }
    });
    res.json({ ok: true });
  });
  app2.post("/api/issues/:id/attachments", async (req, res) => {
    const u = req.user;
    const d = z.object({ attachments: z.array(z.uuid()).min(1).max(5) }).parse(req.body);
    await db.transaction(async (q) => {
      const i = await accessible(q, u, String(req.params.id));
      await attach(q, d.attachments, i.id, u.id);
      await activity(q, i, u, "Screenshots added", `${d.attachments.length} additional screenshot(s)`);
    });
    res.json({ ok: true });
  });
  app2.post("/api/issues/:id/comments", async (req, res) => {
    const u = req.user;
    await rateLimit(`comment:${u.id}`, 60, 60);
    const d = z.object({ body: z.string().trim().min(1).max(15e3), internal: z.boolean().default(false) }).parse(req.body);
    if (d.internal && u.role !== "admin") throw fail(403, "Internal notes are restricted to admins.");
    await db.transaction(async (q) => {
      const i = await accessible(q, u, String(req.params.id));
      const id = randomUUID3();
      await q("comments").insert({ id, issue_id: i.id, user_id: u.id, ...d, created_at: now() });
      await activity(q, i, u, d.internal ? "Internal note" : "Comment added", d.body, d.internal);
      if (u.role !== "admin" && i.status === "Needs Information") await queue(q, { issue: i, kind: "response", dedupe: `response:${id}`, body: `${u.name} responded:

${d.body}` });
    });
    res.status(201).json({ ok: true });
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  app2.post("/api/uploads", async (req, res, next) => {
    try {
      await rateLimit(`upload:${req.user.id}`, 50, 60);
      next();
    } catch (e) {
      next(e);
    }
  }, upload.single("file"), async (req, res) => {
    const u = req.user;
    if (!req.file) throw fail(400, "Choose a screenshot.");
    const count = await db("attachments").where({ user_id: u.id }).whereNull("issue_id").count({ n: "id" }).first();
    if (Number(count?.n) > 19) throw fail(400, "Too many pending uploads. Remove unused screenshots first.");
    const bytes = await validateImage(req.file.buffer, req.file.mimetype);
    const id = randomUUID3();
    await put(id, bytes, req.file.mimetype);
    try {
      await db("attachments").insert({ id, user_id: u.id, name: path3.basename(req.file.originalname).slice(0, 200), mime: req.file.mimetype, size: bytes.length, storage_key: id, created_at: now() });
    } catch (e) {
      await remove(id);
      throw e;
    }
    res.status(201).json({ id, name: req.file.originalname, size: bytes.length });
  });
  app2.delete("/api/uploads/:id", async (req, res) => {
    const a = await db("attachments").where({ id: req.params.id, user_id: req.user.id }).whereNull("issue_id").first();
    if (!a) throw fail(404, "Upload not found.");
    await remove(a.storage_key);
    await db("attachments").where({ id: a.id }).delete();
    res.json({ ok: true });
  });
  app2.get("/api/attachments/:id/link", async (req, res) => {
    const u = req.user;
    const a = await db("attachments").where({ id: req.params.id }).first();
    if (!a) throw fail(404, "Screenshot not found.");
    if (a.issue_id) await accessible(db, u, a.issue_id);
    else if (a.user_id !== u.id) throw fail(404, "Screenshot not found.");
    const expiry = Date.now() + 6e4;
    res.json({ url: `/api/attachments/${a.id}/file?expires=${expiry}&signature=${signDownload(a.id, u.id, expiry)}` });
  });
  app2.get("/api/attachments/:id/file", async (req, res) => {
    const u = req.user;
    const id = String(req.params.id), expires = Number(req.query.expires), signature = String(req.query.signature || "");
    const expected = signDownload(id, u.id, expires);
    if (!Number.isFinite(expires) || expires < Date.now() || expires > Date.now() + 61e3 || signature.length !== expected.length || !timingSafeEqual2(Buffer.from(signature), Buffer.from(expected))) throw fail(403, "Screenshot link expired. Reopen the screenshot.");
    const a = await db("attachments").where({ id }).first();
    if (!a) throw fail(404, "Screenshot not found.");
    if (a.issue_id) await accessible(db, u, a.issue_id);
    else if (a.user_id !== u.id) throw fail(404, "Screenshot not found.");
    const f = await download(a.storage_key);
    res.setHeader("Content-Type", a.mime);
    res.setHeader("Content-Disposition", "inline");
    if (f.url) res.redirect(f.url);
    else res.sendFile(f.file);
  });
  app2.get("/api/admin/settings", admin, async (req, res) => {
    const settings = await db("settings").where({ id: 1 }).first();
    res.json({ ...settings, recipients: JSON.parse(settings.recipients), users: (await db("users").orderBy("name")).map(publicUser), projects: await db("projects"), memberships: await db("memberships"), health: { database: process.env.DATABASE_URL ? "PostgreSQL" : "Local SQLite", storage: process.env.S3_ENDPOINT ? "Private S3" : "Private local storage", n8n: !!process.env.N8N_WEBHOOK_URL, sender: process.env.EMAIL_FROM || null, mode: production ? "production" : "local" } });
  });
  app2.patch("/api/admin/settings", admin, async (req, res) => {
    const d = z.object({ reminder_hours: z.number().int().min(1).max(720), digest_enabled: z.boolean(), timezone: z.string().refine((s) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: s });
        return true;
      } catch {
        return false;
      }
    }), digest_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), recipients: z.array(z.email()).max(10) }).parse(req.body);
    await db.transaction(async (q) => {
      await q("settings").where({ id: 1 }).update({ ...d, recipients: JSON.stringify(d.recipients) });
      await audit(q, req.user, "settings", "Notification preferences updated");
    });
    res.json({ ok: true });
  });
  app2.post("/api/admin/projects", admin, async (req, res) => {
    const d = z.object({ name: z.string().trim().min(2).max(80), description: z.string().max(500).default("") }).parse(req.body);
    const id = randomUUID3();
    await db.transaction(async (q) => {
      await q("projects").insert({ id, ...d, active: true, created_at: now() });
      await audit(q, req.user, "project-created", d.name);
    });
    res.status(201).json({ id });
  });
  app2.post("/api/admin/invites", admin, async (req, res) => {
    const d = z.object({ email: z.email().max(254), name: z.string().trim().min(2).max(100), projects: z.array(z.uuid()).min(1).max(50) }).parse(req.body);
    const raw = token();
    let uid = "";
    await db.transaction(async (q) => {
      if ((await q("projects").whereIn("id", d.projects).where({ active: true })).length !== new Set(d.projects).size) throw fail(400, "Choose active projects.");
      const existing = await q("users").where({ email: d.email.toLowerCase() }).first();
      if (existing?.verified) throw fail(409, "This person already has an account. Edit their project access instead.");
      uid = existing?.id || randomUUID3();
      if (!existing) await q("users").insert({ id: uid, email: d.email.toLowerCase(), name: d.name, role: "tester", verified: false, active: true, created_at: now() });
      await q("invites").where({ user_id: uid, used: false }).update({ used: true });
      await q("invites").insert({ id: hash(raw), user_id: uid, used: false, expires_at: new Date(Date.now() + 72 * 36e5).toISOString() });
      for (const project_id of d.projects) await q("memberships").insert({ project_id, user_id: uid }).onConflict(["project_id", "user_id"]).ignore();
      await queue(q, { kind: "invite", dedupe: `invite:${hash(raw)}`, recipients: [d.email], subject: "You\u2019re invited to Helm Track", body: `Hi ${d.name},

You have been invited to help test and improve our projects. Set up your account using the button below. This invitation expires in 72 hours.`, link: `${appURL()}/?invite=${raw}` });
      await audit(q, req.user, "invitation", d.email);
    });
    res.status(201).json({ ok: true, ...!production ? { local_invite_url: `${appURL()}/?invite=${raw}` } : {} });
  });
  app2.patch("/api/admin/users/:id", admin, async (req, res) => {
    const d = z.object({ active: z.boolean(), projects: z.array(z.uuid()).max(50) }).parse(req.body);
    const uid = String(req.params.id);
    if (uid === req.user.id) throw fail(400, "You cannot deactivate your own account.");
    await db.transaction(async (q) => {
      const user = await q("users").where({ id: uid }).first();
      if (!user || user.role !== "tester") throw fail(400, "Only tester accounts can be managed here.");
      if ((await q("projects").whereIn("id", d.projects)).length !== new Set(d.projects).size) throw fail(400, "Invalid projects.");
      await q("users").where({ id: uid }).update({ active: d.active });
      await q("memberships").where({ user_id: uid }).delete();
      for (const project_id of d.projects) await q("memberships").insert({ project_id, user_id: uid });
      if (!d.active) await q("sessions").where({ user_id: uid }).delete();
      await audit(q, req.user, "tester-access", uid);
    });
    res.json({ ok: true });
  });
  app2.get("/api/admin/notifications", admin, async (req, res) => res.json(await db("deliveries").select("id", "recipient", "subject", "state", "attempts", "error", "created_at").orderBy("created_at", "desc").limit(100)));
  app2.post("/api/admin/notifications/:id/retry", admin, async (req, res) => {
    const d = await db("deliveries").where({ id: req.params.id }).first();
    if (!d || !["failed", "uncertain"].includes(d.state)) throw fail(409, "This notification is not retryable.");
    if (d.first_claim_at && Date.now() - Date.parse(d.first_claim_at) > 23 * 36e5) throw fail(409, "Provider deduplication window expired. Check the provider\u2019s records before manually resending; automatic retry is blocked.");
    await db.transaction(async (q) => {
      await q("deliveries").where({ id: d.id, state: d.state }).update({ state: "queued", attempts: 0, next_attempt: now(), error: null, updated_at: now() });
      await audit(q, req.user, "notification-retry", d.id);
    });
    res.json({ ok: true });
  });
  app2.post("/api/integration/schedule", async (req, res) => {
    const secret = process.env.N8N_SCHEDULER_SECRET || "", received = req.get("authorization")?.replace(/^Bearer /, "") || "";
    if (secret.length < 32 || received.length !== secret.length || !timingSafeEqual2(Buffer.from(secret), Buffer.from(received))) throw fail(401, "Invalid scheduler authorization.");
    const d = z.object({ timestamp: z.number(), nonce: z.string().min(1).max(200) }).parse(req.body);
    if (Math.abs(Date.now() - d.timestamp) > 3e5) throw fail(401, "Expired scheduler request.");
    const key = hash(`scheduler:${d.nonce}`);
    const inserted = await db("limits").insert({ key, count: 1, expires_at: new Date(Date.now() + 6e5).toISOString() }).onConflict("key").ignore().returning("key");
    if (!inserted.length) return res.json({ ok: true, replayed: true });
    await schedule();
    res.json({ ok: true });
  });
  app2.use("/api/integration", async (req, res, next) => {
    try {
      await rateLimit(`integration:${req.ip}`, 300, 1);
      const bearer = req.get("authorization")?.replace(/^Bearer /, "");
      if (!bearer) throw fail(401, "Missing integration authorization.");
      const d = await db("deliveries").where({ token_hash: hash(bearer) }).where("token_expires", ">", now()).first();
      if (!d) throw fail(401, "Invalid or expired integration authorization.");
      req.delivery = d;
      next();
    } catch (e) {
      next(e);
    }
  });
  app2.post("/api/integration/claim", async (req, res) => {
    const d = req.delivery;
    let output = { send: false };
    await db.transaction(async (q) => {
      const row = await q("deliveries").where({ id: d.id }).first();
      const e = await q("events").where({ id: row.event_id }).first();
      if (!await applicable(q, e)) {
        await q("deliveries").where({ id: d.id }).update({ state: "cancelled", updated_at: now() });
        return;
      }
      if (!["dispatching", "queued", "uncertain"].includes(row.state) || row.lease_until && row.lease_until > now() && row.state !== "dispatching") return;
      if (row.first_claim_at && Date.now() - Date.parse(row.first_claim_at) > 23 * 36e5) {
        await q("deliveries").where({ id: d.id }).update({ state: "uncertain", error: "Provider deduplication window expired; manual investigation required." });
        return;
      }
      if (!process.env.EMAIL_FROM) throw fail(503, "Sender configuration is incomplete.");
      const updated = await q("deliveries").where({ id: d.id, state: row.state }).update({ state: "sending", lease_until: new Date(Date.now() + 12e4).toISOString(), first_claim_at: row.first_claim_at || now(), updated_at: now() });
      if (!updated) return;
      output = { send: true, delivery_id: row.id, event_id: e.id, idempotency_key: `helm/${row.id}`, email: { from: process.env.EMAIL_FROM, to: [row.recipient], subject: row.subject, html: row.html, text: row.text } };
    });
    res.json(output);
  });
  app2.post("/api/integration/outcome", async (req, res) => {
    const d = req.delivery;
    const data = z.object({ state: z.enum(["provider-accepted", "failed", "uncertain"]), provider_id: z.string().max(200).optional(), execution_id: z.string().max(200).default(""), error: z.enum(["provider_rejected", "provider_unavailable", "unknown_outcome"]).optional() }).parse(req.body);
    if (data.state === "provider-accepted" && !data.provider_id) throw fail(400, "Provider message ID required.");
    await db.transaction(async (q) => {
      const row = await q("deliveries").where({ id: d.id }).first();
      if (["provider-accepted", "delivered", "bounced", "cancelled"].includes(row.state)) return;
      if (row.state !== "sending") throw fail(409, "No active delivery attempt.");
      await q("deliveries").where({ id: d.id, state: "sending" }).update({ state: data.state, provider_id: data.provider_id || null, error: data.error || null, lease_until: null, next_attempt: new Date(Date.now() + Math.min(3600, 30 * 2 ** row.attempts) * 1e3).toISOString(), updated_at: now() });
      await q("attempts").insert({ id: randomUUID3(), delivery_id: d.id, state: data.state, error: data.error || null, execution_id: data.execution_id, created_at: now() });
    });
    res.json({ ok: true });
  });
  app2.use("/api", (req, res) => res.status(404).json({ error: "Endpoint not found." }));
  app2.use(express.static(path3.resolve("dist")));
  app2.get("/{*path}", (req, res) => res.sendFile(path3.resolve("dist/index.html")));
  app2.use((err, req, res, next) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: "Upload failed. Maximum file size is 10 MB." });
    if (err.code === "23505" || err.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "That record already exists." });
    res.status(err.status || 500).json({ error: err.status ? err.message : "Something went wrong. Please try again." });
    if (!err.status) console.error("Request failed:", err.name, err.code || "internal_error");
  });
  return app2;
}

// api/index.ts
migrate().catch((err) => {
  console.warn("[Vercel Serverless] Auto-migration notice:", err?.message || err);
});
var app = createApp();
var index_default = app;
export {
  index_default as default
};
