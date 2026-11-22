import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    PUBLIC_API_URL: z.url().default("http://localhost:8787"),
    WEB_APP_URL: z.url().default("http://localhost:3000"),
    CORS_ORIGINS: csv,
    TRUST_PROXY: bool,

    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: optionalString,
    SUPABASE_ANON_KEY: optionalString,
    SUPABASE_SECRET_KEY: optionalString,
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    SUPABASE_JWT_SECRET: optionalString,
    ALLOWED_EMAILS: csv,

    DEVICE_TOKEN_SECRET: z.string().min(32, "DEVICE_TOKEN_SECRET must be at least 32 characters"),
    ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "ENCRYPTION_KEY must be 32 bytes, base64 encoded"),

    OLLAMA_DIRECT_URL: optionalString.pipe(z.url().optional()),
    OPENAI_COMPATIBLE_BASE_URL: optionalString.pipe(z.url().optional()),
    OPENAI_COMPATIBLE_API_KEY: optionalString,
    OPENAI_COMPATIBLE_CHAT_MODEL: optionalString,
    OPENAI_COMPATIBLE_EMBEDDING_MODEL: optionalString,
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(900_000).default(180_000),

    GITHUB_TOKEN: optionalString,
    HF_TOKEN: optionalString,
    PRODUCT_HUNT_TOKEN: optionalString,

    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,

    WORKER_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
    SCHEDULER_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  })
  .superRefine((env, ctx) => {
    if (!env.SUPABASE_PUBLISHABLE_KEY && !env.SUPABASE_ANON_KEY)
      ctx.addIssue({ code: "custom", path: ["SUPABASE_PUBLISHABLE_KEY"], message: "SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) is required" });
    if (!env.SUPABASE_SECRET_KEY && !env.SUPABASE_SERVICE_ROLE_KEY)
      ctx.addIssue({ code: "custom", path: ["SUPABASE_SECRET_KEY"], message: "SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is required" });
  });

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`);
    // Logger depends on config, so print directly.
    console.error(`Invalid API environment configuration:\n${lines.join("\n")}`);
    process.exit(1);
  }
  const env = parsed.data;
  const stripSlash = (u: string) => u.replace(/\/+$/, "");
  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    port: env.PORT,
    host: env.HOST,
    logLevel: env.LOG_LEVEL,
    publicApiUrl: stripSlash(env.PUBLIC_API_URL),
    webAppUrl: stripSlash(env.WEB_APP_URL),
    corsOrigins: [...new Set([stripSlash(env.WEB_APP_URL), ...env.CORS_ORIGINS.map(stripSlash)])],
    trustProxy: env.TRUST_PROXY,
    supabase: {
      url: stripSlash(env.SUPABASE_URL),
      publishableKey: (env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY)!,
      secretKey: (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY)!,
      jwtSecret: env.SUPABASE_JWT_SECRET,
    },
    allowedEmails: env.ALLOWED_EMAILS.map((e) => e.toLowerCase()),
    deviceTokenSecret: env.DEVICE_TOKEN_SECRET,
    encryptionKey: Buffer.from(env.ENCRYPTION_KEY, "base64"),
    ai: {
      ollamaDirectUrl: env.OLLAMA_DIRECT_URL ? stripSlash(env.OLLAMA_DIRECT_URL) : undefined,
      openaiCompatible:
        env.OPENAI_COMPATIBLE_BASE_URL && env.OPENAI_COMPATIBLE_API_KEY
          ? {
              baseUrl: stripSlash(env.OPENAI_COMPATIBLE_BASE_URL),
              apiKey: env.OPENAI_COMPATIBLE_API_KEY,
              chatModel: env.OPENAI_COMPATIBLE_CHAT_MODEL,
              embeddingModel: env.OPENAI_COMPATIBLE_EMBEDDING_MODEL,
            }
          : undefined,
      requestTimeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    },
    sources: {
      githubToken: env.GITHUB_TOKEN,
      hfToken: env.HF_TOKEN,
      productHuntToken: env.PRODUCT_HUNT_TOKEN,
    },
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : undefined,
    worker: {
      enabled: env.WORKER_ENABLED,
      schedulerEnabled: env.SCHEDULER_ENABLED,
      concurrency: env.WORKER_CONCURRENCY,
    },
  };
}

export const config = loadConfig();
export type AppConfig = typeof config;
