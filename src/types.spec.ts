import { describe, expect, expectTypeOf, it } from 'bun:test';
import { z } from 'zod';
import type { InferSchema } from './types.js';

describe('InferSchema', () => {
  it('should infer required properties correctly', () => {
    const schema = {
      name: z.string(),
      age: z.number(),
    };
    const zodSchema = z.object(schema);

    type Result = InferSchema<typeof schema>;

    // Type-level assertion (checked by tsc --noEmit)
    expectTypeOf<Result>().toEqualTypeOf<{
      name: string;
      age: number;
    }>();

    // Runtime check with zod validation
    const valid: Result = { name: 'John', age: 30 };
    const parsed = zodSchema.parse(valid);
    expect(parsed.name).toBe('John');
    expect(parsed.age).toBe(30);
  });

  it('should make optional zod properties optional in the inferred type', () => {
    const schema = {
      name: z.string(),
      nickname: z.string().optional(),
    };
    const zodSchema = z.object(schema);

    type Result = InferSchema<typeof schema>;

    // Type-level assertion (checked by tsc --noEmit)
    // nickname should be optional (string | undefined with optional key)
    expectTypeOf<Result>().toEqualTypeOf<{
      name: string;
      nickname?: string | undefined;
    }>();

    // Runtime checks - should compile without providing nickname
    const withoutNickname: Result = { name: 'John' };
    const parsedWithout = zodSchema.parse(withoutNickname);
    expect(parsedWithout.name).toBe('John');
    expect(parsedWithout.nickname).toBeUndefined();

    // Should also compile with nickname provided
    const withNickname: Result = { name: 'John', nickname: 'Johnny' };
    const parsedWith = zodSchema.parse(withNickname);
    expect(parsedWith.nickname).toBe('Johnny');
  });

  it('should handle nullable properties', () => {
    const schema = {
      name: z.string(),
      middleName: z.string().nullable(),
    };
    const zodSchema = z.object(schema);

    type Result = InferSchema<typeof schema>;

    // Type-level assertion (checked by tsc --noEmit)
    // Nullable properties should still be required, but allow null
    expectTypeOf<Result>().toEqualTypeOf<{
      name: string;
      middleName: string | null;
    }>();

    // Runtime checks with zod validation
    const withNull: Result = { name: 'John', middleName: null };
    const parsedNull = zodSchema.parse(withNull);
    expect(parsedNull.middleName).toBeNull();

    const withValue: Result = { name: 'John', middleName: 'William' };
    const parsedValue = zodSchema.parse(withValue);
    expect(parsedValue.middleName).toBe('William');
  });

  it('should handle optional and nullable combined', () => {
    const schema = {
      name: z.string(),
      suffix: z.string().nullable().optional(),
    };
    const zodSchema = z.object(schema);

    type Result = InferSchema<typeof schema>;

    // Type-level assertion (checked by tsc --noEmit)
    // Should be optional and nullable
    expectTypeOf<Result>().toEqualTypeOf<{
      name: string;
      suffix?: string | null | undefined;
    }>();

    // Runtime checks with zod validation
    const withoutSuffix: Result = { name: 'John' };
    const parsedWithout = zodSchema.parse(withoutSuffix);
    expect(parsedWithout.suffix).toBeUndefined();

    const withNull: Result = { name: 'John', suffix: null };
    const parsedNull = zodSchema.parse(withNull);
    expect(parsedNull.suffix).toBeNull();

    const withValue: Result = { name: 'John', suffix: 'Jr.' };
    const parsedValue = zodSchema.parse(withValue);
    expect(parsedValue.suffix).toBe('Jr.');
  });

  it('should handle complex nested schemas', () => {
    const schema = {
      user: z.object({
        name: z.string(),
        email: z.string().optional(),
      }),
      metadata: z
        .object({
          createdAt: z.date(),
        })
        .optional(),
    };
    const zodSchema = z.object(schema);

    type Result = InferSchema<typeof schema>;

    // Type-level assertion (checked by tsc --noEmit)
    // metadata should be optional
    expectTypeOf<Result>().toEqualTypeOf<{
      user: {
        name: string;
        email?: string | undefined;
      };
      metadata?:
        | {
            createdAt: Date;
          }
        | undefined;
    }>();

    // Runtime checks with zod validation
    const withoutMetadata: Result = {
      user: { name: 'John' },
    };
    const parsedWithout = zodSchema.parse(withoutMetadata);
    expect(parsedWithout.user.name).toBe('John');
    expect(parsedWithout.metadata).toBeUndefined();

    const now = new Date();
    const withMetadata: Result = {
      user: { name: 'John', email: 'john@example.com' },
      metadata: { createdAt: now },
    };
    const parsedWith = zodSchema.parse(withMetadata);
    expect(parsedWith.metadata?.createdAt).toEqual(now);
  });

  it('should handle arrays with optional elements', () => {
    const schema = {
      items: z.array(z.string()),
      tags: z.array(z.string()).optional(),
    };
    const zodSchema = z.object(schema);

    type Result = InferSchema<typeof schema>;

    // Type-level assertion (checked by tsc --noEmit)
    // tags should be optional
    expectTypeOf<Result>().toEqualTypeOf<{
      items: string[];
      tags?: string[] | undefined;
    }>();

    // Runtime checks with zod validation
    const withoutTags: Result = { items: ['a', 'b'] };
    const parsedWithout = zodSchema.parse(withoutTags);
    expect(parsedWithout.items).toEqual(['a', 'b']);
    expect(parsedWithout.tags).toBeUndefined();

    const withTags: Result = { items: ['a'], tags: ['tag1', 'tag2'] };
    const parsedWith = zodSchema.parse(withTags);
    expect(parsedWith.tags).toEqual(['tag1', 'tag2']);
  });

  it('should correctly type a mixed schema', () => {
    const schema = {
      id: z.string(),
      description: z.string().optional(),
      count: z.number(),
      deletedAt: z.date().nullable().optional(),
    };
    const zodSchema = z.object(schema);

    type Result = InferSchema<typeof schema>;

    // Type-level assertion (checked by tsc --noEmit)
    expectTypeOf<Result>().toEqualTypeOf<{
      id: string;
      description?: string | undefined;
      count: number;
      deletedAt?: Date | null | undefined;
    }>();

    // Runtime checks - minimal valid object (only required fields)
    const minimal: Result = {
      id: '123',
      count: 0,
    };
    const parsedMinimal = zodSchema.parse(minimal);
    expect(parsedMinimal.id).toBe('123');
    expect(parsedMinimal.count).toBe(0);

    // Full object
    const now = new Date();
    const full: Result = {
      id: '456',
      description: 'A test',
      count: 5,
      deletedAt: now,
    };
    const parsedFull = zodSchema.parse(full);
    expect(parsedFull.description).toBe('A test');
    expect(parsedFull.deletedAt).toEqual(now);
  });
});
