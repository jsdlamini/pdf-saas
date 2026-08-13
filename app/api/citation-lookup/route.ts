export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function sanitizeBibtex(text: string): string {
  // Keep it reasonable length and strip control chars
  return text.slice(0, 20_000).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const doi = (url.searchParams.get("doi") || "").trim();

  if (!doi) {
    return jsonError("Provide a 'doi' query parameter.", 400);
  }

  // Basic DOI sanity check: must look like a DOI (contains a slash)
  if (!doi.includes("/") || doi.length > 300) {
    return jsonError("That does not look like a valid DOI.", 400);
  }

  const encoded = encodeURIComponent(doi);
  const crossrefUrl = `https://api.crossref.org/works/${encoded}/transform/application/x-bibtex`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(crossrefUrl, {
      headers: {
        Accept: "application/x-bibtex",
        "User-Agent": "WiserFilesResearchStudio/1.0 (mailto:johnsjdsd@gmail.com)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 404) {
        return jsonError("DOI not found in Crossref.", 404);
      }
      return jsonError(`Crossref lookup failed (${response.status}).`, 502);
    }

    const bibtex = sanitizeBibtex(await response.text());

    if (!bibtex.trim() || !bibtex.includes("@")) {
      return jsonError("Crossref returned no usable BibTeX for this DOI.", 502);
    }

    return Response.json({ bibtex, doi });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Citation lookup timed out."
      : error instanceof Error ? error.message : "Citation lookup failed.";
    return jsonError(message, 502);
  } finally {
    clearTimeout(timeout);
  }
}
