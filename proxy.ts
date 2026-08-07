import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = [
  "/",
  "/tools/",
  "/research-studio",
  "/history",
  "/online/",
];

export default clerkMiddleware(async (auth, req) => {
  const path = req.nextUrl.pathname;
  if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(p))) {
    return NextResponse.next();
  }
  return;
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};