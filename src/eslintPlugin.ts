/**
 * TypeScript ESLint plugin for custom rules specific to this project
 */

import type { Rule } from 'eslint';
import type * as ESTree from 'estree';

/**
 * Rule: no-optional-in-input-schema
 *
 * Detects when `.optional()`, `.default()`, or `.nullish()` are called on zod schemas
 * that are used in the `inputSchema` property of ApiFactory config objects.
 *
 * Some LLMs (like GPT-5) require all tool input parameters to be marked as required
 * in the schema, otherwise the tools become completely unusable. Using .optional(),
 * .default(), or .nullish() makes parameters optional in the JSON schema, breaking
 * compatibility with these LLMs.
 */
const noOptionalInputSchema: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow .optional(), .default(), and .nullish() on zod schemas in ApiFactory inputSchema',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noOptional:
        'Avoid using .optional(), .default(), or .nullish() on zod schemas in inputSchema. Some LLMs (like GPT-5) require all tool parameters to be marked as required, and tools become unusable otherwise. Use .nullable() instead if you need to accept null values, or handle empty/missing values in your function implementation.',
    },
    schema: [], // no options
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    // Track variables that are used as the Input type parameter in ApiFactory<Context, Input, Output>
    const apiFactoryInputSchemas = new Set<string>();
    const problematicCalls: ESTree.CallExpression[] = [];

    return {
      // Detect ApiFactory type annotations and extract the Input type parameter
      VariableDeclarator(node: ESTree.Node): void {
        const varNode = node as any;

        // Check if this variable has a TypeScript type annotation
        if (varNode.id?.typeAnnotation?.typeAnnotation) {
          const typeAnn = varNode.id.typeAnnotation.typeAnnotation;

          // Look for ApiFactory type reference
          if (
            typeAnn.type === 'TSTypeReference' &&
            typeAnn.typeName?.name === 'ApiFactory'
          ) {
            // Get the type parameters
            const typeParams = typeAnn.typeArguments?.params;
            if (typeParams && typeParams.length >= 2) {
              const inputTypeParam = typeParams[1];

              // Check if it's a typeof reference (e.g., typeof inputSchema2)
              if (
                inputTypeParam.type === 'TSTypeQuery' &&
                inputTypeParam.exprName?.type === 'Identifier'
              ) {
                apiFactoryInputSchemas.add(inputTypeParam.exprName.name);
              }
            }
          }
        }
      },

      // Collect all .optional(), .default(), and .nullish() calls on zod schemas
      CallExpression(node: ESTree.Node): void {
        const callNode = node as ESTree.CallExpression;

        // Check if this is a .optional(), .default(), or .nullish() call
        if (callNode.callee.type === 'MemberExpression') {
          const memberNode = callNode.callee;
          if (
            memberNode.property.type === 'Identifier' &&
            ['optional', 'default', 'nullish'].includes(
              memberNode.property.name,
            )
          ) {
            // Check if it's being called on a zod schema
            const isZodSchema = isLikelyZodSchema(memberNode.object);
            if (isZodSchema) {
              problematicCalls.push(callNode);
            }
          }
        }
      },

      // After processing the entire file, check all problematic calls
      'Program:exit'(): void {
        for (const node of problematicCalls) {
          if (
            isInsideApiFactoryInputSchema(node, context, apiFactoryInputSchemas)
          ) {
            const memberNode = node.callee as ESTree.MemberExpression;
            context.report({
              node: memberNode.property as ESTree.Node,
              messageId: 'noOptional',
            });
          }
        }
      },
    };
  },
};

/**
 * Check if a node is inside a schema that's used as an ApiFactory Input type parameter
 */
function isInsideApiFactoryInputSchema(
  node: ESTree.Node,
  context: Rule.RuleContext,
  apiFactoryInputSchemas: Set<string>,
): boolean {
  const sourceCode = context.sourceCode ?? (context as any).getSourceCode?.();
  const ancestors = sourceCode?.getAncestors?.(node) ?? [];

  // Check ancestors for variables that are ApiFactory input schemas
  for (const ancestor of ancestors) {
    // Check if ancestor is a VariableDeclarator whose name is in apiFactoryInputSchemas
    if (ancestor.type === 'VariableDeclarator') {
      const varNode = ancestor as ESTree.VariableDeclarator;
      if (
        varNode.id?.type === 'Identifier' &&
        apiFactoryInputSchemas.has((varNode.id as ESTree.Identifier).name)
      ) {
        return true;
      }
    }
  }

  // Fallback: walk up parent chain if node.parent is available
  let current = (node as any).parent as ESTree.Node | undefined;
  while (current) {
    // Variable that's an ApiFactory input schema
    if (current.type === 'VariableDeclarator') {
      const varNode = current as ESTree.VariableDeclarator;
      if (
        varNode.id?.type === 'Identifier' &&
        apiFactoryInputSchemas.has((varNode.id as ESTree.Identifier).name)
      ) {
        return true;
      }
    }

    current = (current as any).parent;
  }

  return false;
}

/**
 * Heuristic to determine if a node is likely a zod schema
 */
function isLikelyZodSchema(
  node: ESTree.Node | ESTree.Expression | ESTree.PrivateIdentifier,
): boolean {
  if (!node || node.type === 'PrivateIdentifier') return false;

  // Direct z identifier (the base of all zod schemas)
  if (node.type === 'Identifier') {
    return node.name === 'z';
  }

  // Direct z.* calls (e.g., z.string)
  if (node.type === 'MemberExpression') {
    if (node.object.type === 'Identifier' && node.object.name === 'z') {
      return true;
    }
    // Member expressions that might be chained zod methods (e.g., z.string)
    return isLikelyZodSchema(node.object);
  }

  // Chained method calls on zod schemas (e.g., z.string().describe())
  if (node.type === 'CallExpression') {
    if (node.callee.type === 'MemberExpression') {
      // Recursively check the object of the member expression
      return isLikelyZodSchema(node.callee.object);
    }
    // Also check if the callee itself is 'z'
    if (node.callee.type === 'Identifier') {
      return node.callee.name === 'z';
    }
  }

  return false;
}

export const rules = {
  'no-optional-input-schema': noOptionalInputSchema,
};

export default {
  rules,
};
