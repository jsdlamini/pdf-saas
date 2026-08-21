import { afterAll, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";

// A valid 32x32 red PNG (magic bytes intact).
const RED_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAK0lEQVR4nO3OIQEAAAwEoetfeovxBoGnq1tKQEBAQEBAQEBAQEBAQEBgHXhUDfhqRFDd3gAAAABJRU5ErkJggg==";

const assetsRoot = vi.hoisted(() => {
  const dir = `/tmp/project-assets-test-${process.pid}-${Date.now()}`;
  process.env.PROJECT_ASSETS_DIR = dir;
  return dir;
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_test123" })),
}));

import { DELETE, GET, POST } from "./route";

function jsonRequest(method: string, url: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("GET /api/project-assets (rehydration)", () => {
  const projectId = "proj-1";

  it("returns stored image bytes so a reloaded project can recover them", async () => {
    await POST(
      jsonRequest("POST", "http://localhost:3000/api/project-assets", {
        projectId,
        files: [
          { path: "logo.png", content: RED_PNG_B64 },
          { path: "images/ch1/fig.png", content: RED_PNG_B64 },
        ],
      })
    );

    const response = await GET(
      new Request(`http://localhost:3000/api/project-assets?projectId=${projectId}`)
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { files?: Array<{ path: string; size: number; content: string }> };
    expect(payload.files).toHaveLength(2);

    const logo = payload.files?.find((f) => f.path === "logo.png");
    expect(logo?.content).toBeTruthy();
    expect(logo?.content).toBe(RED_PNG_B64);
    expect(logo?.size).toBeGreaterThan(0);

    const nested = payload.files?.find((f) => f.path === "images/ch1/fig.png");
    expect(nested?.content).toBe(RED_PNG_B64);
  });

  it("returns an empty file list for a project with no stored assets", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/project-assets?projectId=proj-empty")
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { files?: unknown[] };
    expect(payload.files).toEqual([]);
  });

  it("rejects a request with no projectId", async () => {
    const response = await GET(new Request("http://localhost:3000/api/project-assets"));
    expect(response.status).toBe(400);
  });

  it("clears the project directory on DELETE so a full re-upload starts clean", async () => {
    await DELETE(jsonRequest("DELETE", "http://localhost:3000/api/project-assets", { projectId }));
    const response = await GET(
      new Request(`http://localhost:3000/api/project-assets?projectId=${projectId}`)
    );
    const payload = (await response.json()) as { files?: unknown[] };
    expect(payload.files).toEqual([]);
  });

  afterAll(async () => {
    await rm(assetsRoot, { recursive: true, force: true });
  });
});
