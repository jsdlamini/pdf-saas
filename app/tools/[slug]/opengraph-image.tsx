import { ImageResponse } from "next/og";
import { getToolBySlug } from "@/lib/tools";

export const runtime = "edge";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

type ToolOgImageProps = {
  params: {
    slug: string;
  };
};

export default function Image({ params }: ToolOgImageProps) {
  const tool = getToolBySlug(params.slug);
  const title = tool ? tool.name : "PDF Tool";
  const description = tool
    ? tool.description
    : "Online PDF tools for merge, split, convert, OCR, security, editing, and signing.";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background: "linear-gradient(140deg, #0f172a 0%, #155e75 55%, #1e293b 100%)",
          color: "#f8fafc",
          padding: "64px",
          fontFamily: "sans-serif",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontSize: "28px", opacity: 0.9 }}>PaperTrail PDF Tools</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div style={{ fontSize: "72px", fontWeight: 800, lineHeight: 1.04 }}>{title}</div>
          <div style={{ fontSize: "30px", opacity: 0.94, maxWidth: "980px" }}>{description}</div>
        </div>
        <div style={{ fontSize: "22px", opacity: 0.92 }}>Run online • Fast workflow • Download instantly</div>
      </div>
    ),
    {
      ...size,
    }
  );
}
