import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");

  if (!supabaseUrl || !serviceRoleKey || !authorization) {
    return json({ error: "Configuração de autenticação ausente" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerData.user) return json({ error: "Sessão inválida" }, 401);

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role,active")
    .eq("id", callerData.user.id)
    .single();

  if (callerProfile?.role !== "super_admin" || !callerProfile.active) {
    return json({ error: "Apenas o Super Admin pode criar acessos" }, 403);
  }

  let payload: { email?: string; password?: string; full_name?: string; role?: string; company_id?: string };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Dados inválidos" }, 400);
  }

  const email = payload.email?.trim().toLowerCase();
  const fullName = payload.full_name?.trim();
  const role = payload.role === "client" ? "client" : "executive";
  if (!email || !email.includes("@") || !fullName || !payload.password || payload.password.length < 8) {
    return json({ error: "Informe nome, e-mail e senha com no mínimo 8 caracteres" }, 400);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: payload.password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError || !created.user) {
    return json({ error: createError?.message ?? "Não foi possível criar o usuário" }, 400);
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ full_name: fullName, role, active: true })
    .eq("id", created.user.id);

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: "Não foi possível concluir o perfil" }, 500);
  }

  if (role === "client" && payload.company_id) {
    const { error: companyError } = await admin
      .from("companies")
      .update({ client_user_id: created.user.id })
      .eq("id", payload.company_id);
    if (companyError) return json({ error: "Usuário criado, mas não foi possível vinculá-lo à empresa" }, 500);
  }

  return json({
    user: { id: created.user.id, email, full_name: fullName, role },
  }, 201);
});
