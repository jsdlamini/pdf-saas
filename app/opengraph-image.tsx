import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "PaperTrail Online PDF Tools";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #082f49 0%, #0f172a 40%, #115e59 100%)",
          color: "#f8fafc",
          padding: "64px",
          fontFamily: "sans-serif",
          alignItems: "stretch",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ fontSize: "28px", opacity: 0.9 }}>PaperTrail</div>
            <div style={{ fontSize: "66px", fontWeight: 800, lineHeight: 1.05, maxWidth: "760px" }}>
              Professional Online PDF Tools
            </div>
            <div style={{ fontSize: "28px", opacity: 0.92, maxWidth: "840px" }}>
              Merge, split, convert, OCR, secure, edit, and sign PDFs in one workspace.
            </div>
          </div>
          <div style={{ display: "flex", gap: "14px", fontSize: "22px", opacity: 0.95 }}>
            <span>Merge PDF</span>
            <span>•</span>
            <span>OCR PDF</span>
            <span>•</span>
            <span>Sign PDF</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
