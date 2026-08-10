import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const sha256 = async (value: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const secretKey = () => {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try { return JSON.parse(modern).default as string; } catch { /* fall through */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const stringValue = (...values: unknown[]) => {
  const value = values.find((item) => typeof item === "string" && item.trim());
  return typeof value === "string" ? value : undefined;
};

Deno.serve(async (request) => {
  if (request.method === "GET") return json({ ok: true, provider: "drope", service: "CRM I5Media webhook" });
  if (request.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const adminKey = secretKey();
  const suppliedSecret = new URL(request.url).searchParams.get("secret") ?? "";
  if (!supabaseUrl || !adminKey || !suppliedSecret) return json({ error: "Webhook não autorizado" }, 401);

  const admin = createClient(supabaseUrl, adminKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suppliedHash = await sha256(suppliedSecret);
  const { data: connection } = await admin.from("whatsapp_connections").select("id,provider").eq("provider", "drope").eq("webhook_secret_hash", suppliedHash).maybeSingle();
  if (!connection) return json({ error: "Webhook não autorizado" }, 401);

  const raw = await request.text();
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return json({ error: "JSON inválido" }, 400); }

  const root = record(payload);
  const data = record(root?.data);
  const message = record(data?.message) ?? record(root?.message);
  const key = record(data?.key) ?? record(message?.key);
  const eventType = stringValue(root?.event, root?.type, root?.action, data?.event, data?.type) ?? "unknown";
  const externalId = stringValue(root?.event_id, root?.id, data?.event_id, data?.id, message?.id, key?.id);
  const fingerprint = await sha256(`${connection.id}:${externalId ?? raw}`);

  const inserted = await admin.from("whatsapp_webhook_events").insert({
    connection_id: connection.id,
    provider: "drope",
    event_type: eventType,
    external_id: externalId ?? null,
    event_fingerprint: fingerprint,
    payload,
  }).select("id").single();

  if (inserted.error?.code === "23505") return json({ ok: true, duplicate: true });
  if (inserted.error) return json({ error: "Não foi possível registrar o evento" }, 500);
  return json({ ok: true, event_id: inserted.data.id });
});
