import { CATEGORY_COLORS } from "@/lib/tools";

// Category-based tool icons. One consistent 24×24 stroke icon per tool
// category, coloured by category (currentColor inherits unless a colour is
// applied via the category map).
const PATHS: Record<string, React.ReactNode> = {
  Organize: (
    <>
      <path d="M12 2l9 5-9 5-9-5 9-5z" />
      <path d="M3 12l9 5 9-5" />
      <path d="M3 17l9 5 9-5" />
    </>
  ),
  Optimize: (
    <>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </>
  ),
  Convert: (
    <>
      <path d="M4 7h13" />
      <path d="M14 3l4 4-4 4" />
      <path d="M20 17H7" />
      <path d="M10 13l-4 4 4 4" />
    </>
  ),
  Security: (
    <>
      <path d="M12 3l7 2.5v5.5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V5.5L12 3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  Edit: (
    <path d="M17 3l4 4L8 20l-5 1 1-5L17 3z" />
  ),
  Sign: (
    <>
      <path d="M12 19l7-7-4-4-7 7-1 5 5-1z" />
      <path d="M15 8l1-1" />
    </>
  ),
  default: (
    <>
      <path d="M6 2h9l4 4v16H6V2z" />
      <path d="M15 2v5h5" />
    </>
  ),
};

export function ToolIcon({
  category,
  className,
}: {
  category: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      style={CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] ? { color: CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] } : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[category] ?? PATHS.default}
    </svg>
  );
}
