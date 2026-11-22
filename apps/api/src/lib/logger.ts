import { pino } from "pino";
import { config } from "../config";

export const logger = pino({
  level: config.logLevel,
  base: { service: "hub-api" },
  redact: {
    paths: [
      "req.headers.authorization",
      "headers.authorization",
      "*.access_token",
      "*.refresh_token",
      "*.token",
      "*.apiKey",
      "*.password",
    ],
    censor: "[redacted]",
  },
  ...(config.isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname,service" },
        },
      }),
});

export type Logger = typeof logger;
