/**
 * Removes everything this origin could be holding in the visitor's browser once
 * printing is finished.
 *
 * This reaches our own origin only. A page cannot erase the browser's history,
 * cannot quit the browser, and cannot touch another site's data — see the
 * "Shutting the visitor's page down" section of `docs/PRIVACY.md` for the
 * honest boundary. Every step is best effort: a browser that refuses one of
 * them must not stop the visitor from reaching the finished screen.
 */
export async function clearBrowserSiteData(): Promise<void> {
  await Promise.allSettled([
    clearWebStorage(),
    clearCacheStorage(),
    clearIndexedDatabases(),
    unregisterServiceWorkers(),
    expireCookies(),
  ]);

  // Asks the browser to drop this origin's cache, cookies and storage as well,
  // which reaches copies the page itself cannot see. `executionContexts` is
  // deliberately absent: it would reload this browsing context, dropping the
  // visitor back onto a finished session and showing an error instead of the
  // confirmation that printing is done.
  await fetch("/api/session-end", {
    method: "POST",
    cache: "no-store",
    keepalive: true,
  }).catch(() => undefined);
}

function clearWebStorage(): Promise<void> {
  return run(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });
}

async function clearCacheStorage(): Promise<void> {
  if (typeof caches === "undefined") return;
  await run(async () => {
    const names = await caches.keys();
    await Promise.allSettled(names.map((name) => caches.delete(name)));
  });
}

async function clearIndexedDatabases(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await run(async () => {
    // `databases()` is unavailable on Safari, where there is no way to
    // enumerate them. The application stores nothing here in the first place;
    // this clears anything a dependency may have left behind.
    const databases = await indexedDB.databases?.();
    if (!databases) return;
    await Promise.allSettled(
      databases.map(({ name }) => (name ? deleteDatabase(name) : Promise.resolve())),
    );
  });
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

async function unregisterServiceWorkers(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  await run(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(registrations.map((registration) => registration.unregister()));
  });
}

function expireCookies(): Promise<void> {
  return run(() => {
    if (typeof document === "undefined" || !document.cookie) return;
    const expiry = "Thu, 01 Jan 1970 00:00:00 GMT";
    for (const pair of document.cookie.split(";")) {
      const name = pair.split("=")[0]?.trim();
      if (!name) continue;
      document.cookie = `${name}=; expires=${expiry}; path=/`;
      document.cookie = `${name}=; expires=${expiry}; path=${window.location.pathname}`;
    }
  });
}

async function run(step: () => void | Promise<void>): Promise<void> {
  try {
    await step();
  } catch {
    // A browser that refuses one step still gets the others.
  }
}
