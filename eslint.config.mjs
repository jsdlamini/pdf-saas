import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Empty catch blocks and empty .catch(() => {}) handlers silently swallow
  // errors — the pattern that hid the figure bug for four rounds. A handler
  // with a comment explaining itself is exempt; a truly empty one is not.
  {
    rules: {
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-empty-function": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
