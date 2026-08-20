import { describe, expect, it, vi } from "vitest";
import { handleUnlockPdfPost } from "./route";

const tempDir = "/tmp/wiserfiles-unlock-test";

function buildRequest(password: string) {
  const formData = new FormData();
  formData.append(
    "file",
    new File([Buffer.from("%PDF-1.4 fake body")], "locked.pdf", { type: "application/pdf" })
  );
  formData.append("password", password);
  return new Request("http://localhost:3000/api/unlock-pdf", { method: "POST", body: formData });
}

function makeDeps(decryptImpl: (input: string, output: string, password: string) => Promise<void>) {
  return {
    mkdtemp: vi.fn().mockResolvedValue(tempDir),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from("DECRYPTED")),
    rm: vi.fn().mockResolvedValue(undefined),
    qpdfDecrypt: vi.fn(decryptImpl),
  };
}

describe("Unlock PDF route", () => {
  it("decrypts with the correct password and returns PDF bytes", async () => {
    const deps = makeDeps(async () => {});
    const res = await handleUnlockPdfPost(buildRequest("secret123"), deps);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("DECRYPTED");
    expect(deps.qpdfDecrypt).toHaveBeenCalledWith(
      `${tempDir}/locked.pdf`,
      `${tempDir}/decrypted.pdf`,
      "secret123"
    );
    // Temp dir (input + decrypted output) removed.
    expect(deps.rm).toHaveBeenCalledWith(tempDir, { recursive: true, force: true });
  });

  it("wrong password → 400 and emits no output file", async () => {
    const deps = makeDeps(async () => {
      throw Object.assign(new Error("invalid password"), { stderr: "qpdf: invalid password" });
    });
    const res = await handleUnlockPdfPost(buildRequest("WRONG"), deps);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("Incorrect password");
    expect(deps.readFile).not.toHaveBeenCalled();
    expect(deps.rm).toHaveBeenCalled();
  });

  it("owner-password-only file decrypts with an empty user password", async () => {
    const deps = makeDeps(async () => {});
    const res = await handleUnlockPdfPost(buildRequest(""), deps);

    expect(res.status).toBe(200);
    expect(deps.qpdfDecrypt).toHaveBeenCalledWith(
      `${tempDir}/locked.pdf`,
      `${tempDir}/decrypted.pdf`,
      ""
    );
  });

  it("unsupported scheme → 400 with a specific message", async () => {
    const deps = makeDeps(async () => {
      throw Object.assign(new Error("unsupported"), { stderr: "qpdf: unsupported security handler" });
    });
    const res = await handleUnlockPdfPost(buildRequest("x"), deps);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("unsupported encryption scheme");
    expect(deps.readFile).not.toHaveBeenCalled();
  });
});
