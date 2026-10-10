import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasClerkQueryParams } from "@/lib/clerk-query-params";

const PUBLIC_PATHS = [
  "/",
  "/tools/",
  "/research-studio",
  "/history",
  "/online/",
];

export default clerkMiddleware(async (auth, req) => {
  const path = req.nextUrl.pathname;

  // Logged-out visitors landing on the home page go straight to Research
  // Studio; signed-in visitors keep the normal home page. Requests carrying
  // Clerk's own query params (sign-in/sign-up handshake, OAuth or email-link
  // return, session sync) are left alone so Clerk's auth flows can complete.
  if (path === "/") {
    const { userId } = await auth();
    if (!userId && !hasClerkQueryParams(req.nextUrl.searchParams)) {
      return NextResponse.redirect(new URL("/research-studio", req.url));
    }
  }

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