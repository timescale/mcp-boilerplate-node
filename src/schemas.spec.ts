import { describe, expect, it } from 'bun:test';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat';
import { z } from 'zod';
import { zDateRangeInclude } from './schemas.js';

/**
 * Verify that zDateRangeInclude (a factory function) produces JSON Schema
 * with zero $ref references. Several LLM providers (e.g. Moonshot/Kimi K3)
 * reject $ref pointers that don't start with "#/$defs/", so this is a hard
 * compatibility requirement.
 */
describe('zDateRangeInclude JSON Schema', () => {
  const inputSchema = {
    includeInvoices: zDateRangeInclude().describe('include invoices'),
    includeStripePayments: zDateRangeInclude().describe(
      'include stripe payments',
    ),
  };

  const jsonSchema = toJsonSchemaCompat(z.object(inputSchema));

  it('contains zero $ref references (LLM provider compatibility)', () => {
    const serialized = JSON.stringify(jsonSchema);
    const matches = [...serialized.matchAll(/"\$ref"/g)];
    expect(matches.length).toBe(0);
  });

  it('each call returns a distinct instance (no shared identity)', () => {
    const a = zDateRangeInclude();
    const b = zDateRangeInclude();
    expect(a).not.toBe(b);
  });
});
