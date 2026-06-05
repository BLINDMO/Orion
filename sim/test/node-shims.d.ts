/**
 * Minimal ambient declarations for the Node built-in test modules so the suite
 * type-checks offline without @types/node. The runtime is provided by Node 22's
 * built-in test runner; these signatures cover only what the tests use.
 */

declare module "node:test" {
  export function test(name: string, fn: () => void | Promise<void>): void;
}

declare module "node:assert/strict" {
  interface Assert {
    (value: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    throws(fn: () => void, expected?: unknown, message?: string): void;
    doesNotThrow(fn: () => void, message?: string): void;
    match(value: string, regexp: RegExp, message?: string): void;
  }
  const assert: Assert;
  export default assert;
}
