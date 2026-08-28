// Proxy for the interactive terminal endpoints. Auth + rate limiting stay in
// the route; this only forwards to the sandbox runner over the private network
// and normalises the JSON (errors ride in the body, never an HTML page).
const SANDBOX_URL = process.env.SANDBOX_URL || "http://sandbox:3100";

export async function proxyTerminal(path: string, body: unknown): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${SANDBOX_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return data ?? { error: "The sandbox is unavailable." };
  } catch {
    return { error: "The sandbox is unavailable right now. Try again shortly." };
  }
}
