// Minimal environment for executing untrusted user code.
//
// This deliberately DOES NOT spread process.env: the app process carries
// CLERK_SECRET_KEY, DATABASE_URL (with the Postgres password), DEEPSEEK_API_KEY,
// RESEND_API_KEY, and GitHub tokens. Handing those to a user-submitted Python or
// C++ program via `env: { ...process.env }` is the arbitrary-code-execution
// vector. Only the bare vars a compiler/interpreter needs are passed through.
export function sandboxedEnv(tempDir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: tempDir,
    TMPDIR: tempDir,
    LANG: "C.UTF-8",
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
}
