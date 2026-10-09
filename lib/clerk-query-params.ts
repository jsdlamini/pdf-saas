/**
 * Query parameters Clerk uses for its own auth flows (handshake completion,
 * OAuth / email-link return, session sync, ticket / invitation handling).
 *
 * The logged-out home redirect in `proxy.ts` must not bounce requests that
 * carry these params. After a sign-in or sign-up completes, Clerk redirects
 * the browser back to the app — often to `/` — with one of these params so the
 * middleware can finish the session handshake. If the logged-out `/` redirect
 * fired on those requests, Clerk's flow would be bounced to `/research-studio`
 * and sign-in could never complete.
 */
const CLERK_QUERY_PARAM_PREFIX = "__clerk";

/** Suffixed-cookie probe Clerk appends in some flows (not `__clerk`-prefixed). */
const CLERK_SUFFIXED_COOKIES_PARAM = "suffixed_cookies";

export function hasClerkQueryParams(searchParams: URLSearchParams): boolean {
  for (const key of searchParams.keys()) {
    if (key.startsWith(CLERK_QUERY_PARAM_PREFIX) || key === CLERK_SUFFIXED_COOKIES_PARAM) {
      return true;
    }
  }
  return false;
}
