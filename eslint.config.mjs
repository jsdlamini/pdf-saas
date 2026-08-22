import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Empty catch blocks silently swallow errors — the pattern that let the
  // figure bug survive four rounds. A catch with a comment is exempt; a bare
  // `catch {}` or `catch (e) {}` must either surface or explain itself.
  {
    rules: {
      "no-empty": ["error", { allowEmptyCatch: false }],
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
