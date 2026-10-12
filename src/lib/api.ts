// Every request goes through wings.fetch, which adds the token in Wings, so this page never holds it.

export const API = "https://cyclops-api.prototyp.digital/api";
export const WEB = "https://cyclops.prototyp.digital";

export class SignedOut extends Error {}

export async function api<T = unknown>(path: string, { method = "GET", body }: { method?: string; body?: object } = {}, retried = false): Promise<T> {
  const res = await wings.fetch(API + path, {
    method,
    bearer: "token",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new SignedOut();
  const data = (res.body ? safeJson(res.body) : null) as { message?: unknown } | null;
  const message = typeof data?.message === "string" ? data.message : Array.isArray(data?.message) ? data.message.join(", ") : "";
  // Cyclops says a 409 ending in "try again" is a lost race worth one plain retry.
  if (res.status === 409 && /try again$/i.test(message) && !retried) return api(path, { method, body }, true);
  if (res.status === 429) throw new Error("Cyclops is limiting requests from this token. Try again in a minute.");
  if (res.status >= 400) throw new Error(message || `Cyclops answered ${res.status}`);
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
