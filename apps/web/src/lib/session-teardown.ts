export async function clearBrowserSiteData(): Promise<void> {
  await Promise.allSettled([
    clearWebStorage(),
    clearCacheStorage(),
    clearIndexedDatabases(),
    unregisterServiceWorkers(),
    expireCookies(),
  ]);

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
  }
}
