import { z } from 'zod';

/**
 * Accept any date string that `new Date(...)` can parse (ISO 8601, RFC 2822,
 * "YYYY-MM-DD", etc.), then normalize to an ISO 8601 string. This is friendlier
 * than z.string().datetime(), which rejects common shapes like "2024-01-01".
 *
 * Returns a fresh Zod type instance on every call so that zod-to-json-schema
 * never emits a $ref pointer — several LLM providers (e.g. Moonshot/Kimi K3)
 * reject JSON Schema $ref references that don't start with "#/$defs/".
 */
export const zFlexibleDate = () =>
  z.string().transform((s, ctx) => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid date: "${s}"`,
      });
      return z.NEVER;
    }
    return d.toISOString();
  });

/**
 * A nullable date-range object with `rangeStart` and `rangeEnd`, each
 * accepting any parseable date string (see {@link zFlexibleDate}).
 *
 * Returns a fresh Zod type instance on every call so that zod-to-json-schema
 * never emits a $ref pointer — several LLM providers (e.g. Moonshot/Kimi K3)
 * reject JSON Schema $ref references that don't start with "#/$defs/".
 */
export const zDateRangeInclude = () =>
  z
    .object({
      rangeStart: zFlexibleDate()
        .nullable()
        .describe(
          'Inclusive start of the range. Accepts any parseable date string (e.g. "2024-01-01" or "2024-01-01T00:00:00Z"). Null to use the default window.',
        ),
      rangeEnd: zFlexibleDate()
        .nullable()
        .describe(
          'Inclusive end of the range. Accepts any parseable date string (e.g. "2024-01-01" or "2024-01-01T00:00:00Z"). Null for "up to now".',
        ),
    })
    .nullable();

/** The TypeScript type for a {@link zDateRangeInclude} value. */
export type DateRangeInclude = z.infer<ReturnType<typeof zDateRangeInclude>>;
