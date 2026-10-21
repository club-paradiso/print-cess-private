const DEDICATED_KIOSK_PREVIEW_BRANCH = "preview";

export function isBrowserKioskEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  if (environment.ENABLE_BROWSER_KIOSK === "true") return true;

  if (
    environment.VERCEL_ENV === "preview" &&
    environment.VERCEL_GIT_COMMIT_REF === DEDICATED_KIOSK_PREVIEW_BRANCH
  ) {
    return true;
  }

  if (environment.VERCEL_ENV === "production") {
    return environment.ENABLE_BROWSER_KIOSK !== "false";
  }

  if (environment.ENABLE_BROWSER_KIOSK === "false") return false;

  return isDemoRouteEnabled(environment);
}

export function isDemoRouteEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  if (
    environment.VERCEL_ENV === "production" ||
    (environment.NODE_ENV === "production" && !environment.VERCEL_ENV)
  ) {
    return false;
  }

  if (environment.ENABLE_DEMO_ROUTES === "true") return true;

  return (
    environment.VERCEL_ENV === "preview" &&
    environment.VERCEL_GIT_COMMIT_REF === DEDICATED_KIOSK_PREVIEW_BRANCH
  );
}
