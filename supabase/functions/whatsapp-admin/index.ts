import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.2";
import postgres from "npm:postgres@3.4.5";
import { DropeWhatsAppProvider } from "../_shared/drope-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const sha256 = async (value: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const randomSecret = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const secretKey = () => {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try { return JSON.parse(modern).default as string; } catch { /* fall through */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const databaseUrl = Deno.env.get("SUPABASE_DB_URL") ?? "";
  const adminKey = secretKey();
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !databaseUrl || !adminKey || !authorization) return json({ error: "Configuração segura indisponível" }, 500);

  const admin = createClient(supabaseUrl, adminKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerData.user) return json({ error: "Sessão inválida" }, 401);
  const { data: profile } = await admin.from("profiles").select("role,active").eq("id", callerData.user.id).single();
  if (profile?.role !== "super_admin" || !profile.active) return json({ error: "Apenas o Super Admin pode alterar a integração" }, 403);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Dados inválidos" }, 400); }
  const action = String(body.action ?? "get_config");
  const sql = postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 2, connect_timeout: 8 });

  try {
    const { data: existing } = await admin.from("whatsapp_connections").select("*").eq("provider", "drope").maybeSingle();
    let connection = existing;
    if (!connection && action !== "get_config") {
      const created = await admin.from("whatsapp_connections").insert({ provider: "drope", created_by: callerData.user.id, updated_by: callerData.user.id }).select("*").single();
      if (created.error) throw created.error;
      connection = created.data;
    }

    const readVaultSecret = async (secretId?: string | null) => {
      if (!secretId) return "";
      const rows = await sql<{ decrypted_secret: string }[]>`select decrypted_secret from vault.decrypted_secrets where id = ${secretId}::uuid limit 1`;
      return rows[0]?.decrypted_secret ?? "";
    };
    const writeVaultSecret = async (currentId: string | null | undefined, value: string, name: string, description: string) => {
      if (currentId) {
        await sql`select vault.update_secret(secret_id => ${currentId}::uuid, new_secret => ${value}, new_description => ${description})`;
        return currentId;
      }
      const rows = await sql<{ id: string }[]>`select vault.create_secret(${value}, ${name}, ${description}) as id`;
      return rows[0].id;
    };

    if (action === "get_config") {
      const events = connection ? await admin.from("whatsapp_webhook_events").select("id,event_type,processed,error,received_at").eq("connection_id", connection.id).order("received_at", { ascending: false }).limit(8) : { data: [] };
      return json({
        connection: connection ? {
          id: connection.id,
          provider: connection.provider,
          status: connection.status,
          device_name: connection.device_name,
          masked_identifier: connection.masked_identifier,
          webhook_ready: Boolean(connection.webhook_secret_hash),
          last_tested_at: connection.last_tested_at,
          last_error: connection.last_error,
        } : null,
        recent_events: events.data ?? [],
      });
    }

    if (!connection) return json({ error: "Conexão não encontrada" }, 404);

    if (action === "save_api_key") {
      const apiKey = String(body.api_key ?? "").trim();
      if (apiKey.length < 12) return json({ error: "Informe uma chave DROPE válida" }, 400);
      const secretId = await writeVaultSecret(connection.api_key_secret_id, apiKey, `whatsapp_drope_api_${connection.id}`, "DROPE API key for CRM I5Media");
      const masked = `••••••••••••${apiKey.slice(-4)}`;
      const updated = await admin.from("whatsapp_connections").update({ api_key_secret_id: secretId, masked_identifier: masked, status: "configured", last_error: null, updated_by: callerData.user.id }).eq("id", connection.id).select("id,status,masked_identifier").single();
      if (updated.error) throw updated.error;
      return json({ connection: updated.data });
    }

    const apiKey = await readVaultSecret(connection.api_key_secret_id);
    if (!apiKey) return json({ error: "Cadastre primeiro a chave da DROPE" }, 400);
    const deviceToken = await readVaultSecret(connection.device_token_secret_id);
    const provider = new DropeWhatsAppProvider(apiKey, deviceToken || undefined);

    if (action === "test_connection") {
      try {
        const devices = await provider.listDevices();
        const status = connection.device_name ? await provider.getConnectionStatus(connection.device_name) : null;
        await admin.from("whatsapp_connections").update({ status: status?.connected ? "connected" : "configured", last_tested_at: new Date().toISOString(), last_error: null, updated_by: callerData.user.id }).eq("id", connection.id);
        return json({ ok: true, devices: devices.map((item) => ({ name: item.name })), device_status: status });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao conectar com a DROPE";
        await admin.from("whatsapp_connections").update({ status: "error", last_tested_at: new Date().toISOString(), last_error: message, updated_by: callerData.user.id }).eq("id", connection.id);
        return json({ error: message }, 502);
      }
    }

    if (action === "select_device") {
      const deviceName = String(body.device_name ?? "").trim();
      const devices = await provider.listDevices();
      const selected = devices.find((item) => item.name === deviceName);
      if (!selected?.token) return json({ error: "Dispositivo DROPE não encontrado ou sem token" }, 404);
      const deviceSecretId = await writeVaultSecret(connection.device_token_secret_id, selected.token, `whatsapp_drope_device_${connection.id}`, "DROPE device token for CRM I5Media");
      const deviceProvider = new DropeWhatsAppProvider(apiKey, selected.token);
      const status = await deviceProvider.getConnectionStatus(deviceName);
      const updated = await admin.from("whatsapp_connections").update({ device_name: deviceName, device_token_secret_id: deviceSecretId, status: status.connected ? "connected" : "configured", last_tested_at: new Date().toISOString(), last_error: null, updated_by: callerData.user.id }).eq("id", connection.id).select("id,status,device_name,masked_identifier,last_tested_at").single();
      if (updated.error) throw updated.error;
      return json({ connection: updated.data, device_status: status });
    }

    if (action === "rotate_webhook_secret") {
      const webhookSecret = randomSecret();
      const webhookHash = await sha256(webhookSecret);
      const updated = await admin.from("whatsapp_connections").update({ webhook_secret_hash: webhookHash, updated_by: callerData.user.id }).eq("id", connection.id);
      if (updated.error) throw updated.error;
      return json({ webhook_url: `${supabaseUrl}/functions/v1/drope-webhook?secret=${encodeURIComponent(webhookSecret)}`, shown_once: true });
    }

    return json({ error: "Ação desconhecida" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro interno" }, 500);
  } finally {
    await sql.end({ timeout: 1 });
  }
});
