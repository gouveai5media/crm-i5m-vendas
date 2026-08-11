import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const defaultAppUrl = "https://i5media-crm-comercial.gouvea47.chatgpt.site";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const safeRedirect = (requested?: string) => {
  const configured = Deno.env.get("CRM_APP_URL") ?? defaultAppUrl;
  try {
    const base = new URL(configured);
    const candidate = requested ? new URL(requested) : new URL("/?first_access=1", base);
    return candidate.origin === base.origin ? candidate.toString() : new URL("/?first_access=1", base).toString();
  } catch {
    return `${defaultAppUrl}/?first_access=1`;
  }
};

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

  let payload: {
    action?: string;
    email?: string;
    full_name?: string;
    role?: string;
    company_id?: string;
    menu_permissions?: string[];
    can_view_revenue?: boolean;
    redirect_to?: string;
  };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Dados inválidos" }, 400);
  }

  if (payload.action === "complete_first_access") {
    const { error: completionError } = await admin
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", callerData.user.id);
    if (completionError) return json({ error: "Não foi possível concluir o primeiro acesso" }, 500);
    return json({ completed: true });
  }

  if (!callerProfile?.active || !["super_admin", "executive"].includes(callerProfile.role)) {
    return json({ error: "Apenas usuários ativos da equipe podem enviar convites" }, 403);
  }

  const email = payload.email?.trim().toLowerCase();
  const fullName = payload.full_name?.trim();
  const role = payload.role === "client" ? "client" : "executive";
  const allowedMenus = ["Visão geral", "Leads", "Pipeline", "Follow-ups", "Reuniões", "Propostas", "Clientes", "Chamados", "WhatsApp", "Chat interno"];
  const menuPermissions = role === "executive" && Array.isArray(payload.menu_permissions)
    ? [...new Set(payload.menu_permissions)].filter((item) => allowedMenus.includes(item))
    : [];
  const canViewRevenue = role === "executive" && payload.can_view_revenue === true;

  if (!email || !email.includes("@") || !fullName) {
    return json({ error: "Informe nome completo e um e-mail válido" }, 400);
  }
  if (role === "executive" && callerProfile.role !== "super_admin") {
    return json({ error: "Apenas o Super Admin pode cadastrar executivos" }, 403);
  }
  if (role === "executive" && menuPermissions.length === 0) {
    return json({ error: "Selecione ao menos um menu para o executivo" }, 400);
  }
  if (role === "client" && !payload.company_id) {
    return json({ error: "Selecione a empresa do cliente" }, 400);
  }

  if (role === "client" && callerProfile.role !== "super_admin") {
    const { data: ownedCompany } = await admin
      .from("companies")
      .select("id")
      .eq("id", payload.company_id)
      .eq("owner_id", callerData.user.id)
      .maybeSingle();
    if (!ownedCompany) return json({ error: "Você só pode convidar clientes da sua carteira" }, 403);
  }

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id,role")
    .eq("email", email)
    .maybeSingle();

  if (existingProfile && existingProfile.role !== role) {
    return json({ error: "Este e-mail já pertence a outro tipo de usuário no CRM" }, 409);
  }

  let invitedUserId = existingProfile?.id ?? "";
  const redirectTo = safeRedirect(payload.redirect_to);

  if (existingProfile) {
    if (role === "client") {
      const { data: otherCompany } = await admin
        .from("companies")
        .select("id")
        .eq("client_user_id", existingProfile.id)
        .neq("id", payload.company_id as string)
        .maybeSingle();
      if (otherCompany) return json({ error: "Este e-mail já está vinculado a outro cliente" }, 409);
    }
    const { error: recoveryError } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
    if (recoveryError) return json({ error: recoveryError.message }, 400);
  } else {
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { full_name: fullName, access_role: role },
    });
    if (inviteError || !invited.user) {
      return json({ error: inviteError?.message ?? "Não foi possível enviar o convite" }, 400);
    }
    invitedUserId = invited.user.id;
  }

  const invitedAt = new Date().toISOString();
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      full_name: fullName,
      role,
      active: true,
      menu_permissions: menuPermissions,
      can_view_revenue: canViewRevenue,
      must_change_password: true,
      invited_at: invitedAt,
      invited_by: callerData.user.id,
    })
    .eq("id", invitedUserId);

  if (profileError) {
    return json({ error: "O convite foi enviado, mas o perfil não pôde ser concluído" }, 500);
  }

  if (role === "client" && payload.company_id) {
    const { error: companyError } = await admin
      .from("companies")
      .update({
        client_user_id: invitedUserId,
        client_invited_at: invitedAt,
        client_invited_by: callerData.user.id,
      })
      .eq("id", payload.company_id);
    if (companyError) return json({ error: "Convite enviado, mas não foi possível vinculá-lo à empresa" }, 500);
  }

  return json({
    invitation_sent: true,
    user: {
      id: invitedUserId,
      email,
      full_name: fullName,
      role,
      menu_permissions: menuPermissions,
      can_view_revenue: canViewRevenue,
    },
  }, existingProfile ? 200 : 201);
});
