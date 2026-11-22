import { z } from "zod";

export const idSchema = z.guid();

export const isoDateTime = z.iso.datetime({ offset: true });
export const isoDate = z.iso.date();

/** Query-string boolean: accepts "true"/"false"/"1"/"0". */
export const queryBool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} _\-.+#/]*$/u, "Tags may contain letters, numbers, spaces and - _ . + # /");

export const tagsSchema = z.array(tagSchema).max(20);

export const httpUrl = z.url({ protocol: /^https?$/, hostname: z.regexes.domain }).max(2048);

export const colorSchema = z.string().trim().min(1).max(20).regex(/^[a-z]+$/);

export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown IANA time zone");

/** HH:MM 24-hour time. */
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Expected HH:MM");
