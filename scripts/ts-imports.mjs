/*
 * Lets a verify script import a TypeScript module that itself imports another
 * one.
 *
 * Node 22.6+ strips types out of a `.ts` file it is handed, which is all the
 * earlier verify scripts needed — the modules they test import nothing but
 * types, and type imports are erased before the resolver ever sees them. A
 * module with a real value import is different: `./walls` reaches the ESM
 * resolver verbatim, and Node does not guess extensions.
 *
 * Rewriting the source to say `./walls.ts` would put a build-tool detail into
 * application code to suit a test, so the adjustment lives here instead.
 * Extensionless relative specifiers are retried as `.ts`, and anything that
 * does not resolve falls through to the default behaviour unchanged.
 *
 * Usage, from a verify script, before importing the module under test:
 *
 *   import { registerTsImports } from './ts-imports.mjs';
 *   registerTsImports();
 *   const mod = await import('../src/lib/whatever.ts');
 */

import { register } from 'node:module';

const HOOK = `
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) {
    try {
      return await next(specifier + '.ts', context);
    } catch {
      // Not a .ts file after all — let the default resolver report it.
    }
  }
  return next(specifier, context);
}
`;

export function registerTsImports() {
  register(`data:text/javascript,${encodeURIComponent(HOOK)}`);
}
