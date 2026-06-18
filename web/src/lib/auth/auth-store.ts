import { writable } from "svelte/store";

export type Role = "open" | "user" | "guest" | null;

/** null = noch unbekannt, true = eingeloggt/offen/gast, false = Login nötig. */
export const authed = writable<boolean | null>(null);
export const role = writable<Role>(null);
export const guestEnabled = writable<boolean>(false);

export async function checkAuth(): Promise<void> {
  try {
    const res = await fetch("/api/me");
    const data = (await res.json()) as { authenticated?: boolean; role?: Role; guestEnabled?: boolean };
    authed.set(!!data.authenticated);
    role.set(data.role ?? null);
    guestEnabled.set(!!data.guestEnabled);
  } catch {
    authed.set(false);
    role.set(null);
  }
}

export async function login(password: string): Promise<boolean> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  authed.set(res.ok);
  if (res.ok) role.set("user");
  return res.ok;
}

export async function loginAsGuest(): Promise<boolean> {
  const res = await fetch("/api/guest", { method: "POST" });
  authed.set(res.ok);
  if (res.ok) {
    role.set("guest");
  } else {
    role.set(null);
  }
  return res.ok;
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
  authed.set(false);
  role.set(null);
}
