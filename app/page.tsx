"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { readSheet } from "read-excel-file/browser";
import { supabase } from "../lib/supabase";

const ADMIN_EMAIL = "i5mediaagencia@gmail.com";
const stages = ["Novo lead", "Primeiro contato", "Follow-up", "Reunião marcada", "Proposta enviada", "Negociação", "Ganho", "Perdido"];
const directRegistrationStages = stages.filter((stage) => !["Follow-up", "Reunião marcada"].includes(stage));
const nav = ["Visão geral", "Leads", "Pipeline", "Follow-ups", "Reuniões", "Propostas", "Clientes", "Chamados", "WhatsApp", "Equipe", "Chat interno", "Configurações"];
const agentMenuOptions = nav.filter((item) => !["Equipe", "Configurações"].includes(item));
const navIcons: Record<string, string> = { "Visão geral": "▦", Leads: "◎", Pipeline: "▥", "Follow-ups": "◷", Reuniões: "▣", Propostas: "▤", Clientes: "♙", Chamados: "◈", WhatsApp: "◉", Equipe: "♚", "Chat interno": "◌", Configurações: "⚙" };

type Profile = { id: string; email: string; full_name: string; role: "super_admin" | "executive" | "client"; active: boolean; menu_permissions: string[]; can_view_revenue: boolean; must_change_password: boolean; invited_at: string | null };
type Service = { id: string; name: string };

type Lead = {
  id: string;
  name: string;
  legalName: string;
  cnpj: string;
  email: string;
  phone: string;
  address: string;
  contact: string;
  contactEmail: string;
  contactPhone: string;
  service: string;
  serviceId: string | null;
  value: number;
  stage: string;
  owner: string;
  ownerId: string | null;
  next: string;
  source: string;
  isActivated: boolean;
  activatedAt: string | null;
  clientUserId: string | null;
  clientInvitedAt: string | null;
};

type Followup = {
  id: string;
  companyId: string;
  companyName: string;
  assignedTo: string | null;
  executiveName: string;
  type: string;
  title: string;
  notes: string;
  dueAt: string | null;
  completedAt: string | null;
};

type Meeting = {
  id: string;
  companyId: string;
  companyName: string;
  executiveId: string;
  executiveName: string;
  scheduledAt: string;
  status: string;
  connected: boolean | null;
  notes: string;
  rescheduledFrom: string | null;
};

type CompanyRow = {
  id: string; name: string; legal_name: string | null; cnpj: string | null; email: string | null; phone: string | null; address: string | null;
  estimated_value: number | string | null; stage: string; owner_id: string | null; service_id: string | null; source: string;
  is_activated: boolean; activated_at: string | null; client_user_id: string | null; client_invited_at: string | null;
  contacts: { name: string; email: string | null; phone: string | null; is_primary: boolean }[] | null;
  services: { name: string } | null;
  followups: { due_at: string | null; completed_at: string | null }[] | null;
};

type FollowupRow = {
  id: string; company_id: string; assigned_to: string | null; type: string; title: string; notes: string | null; due_at: string | null; completed_at: string | null;
  companies: { name: string } | null;
};

type MeetingRow = {
  id: string; company_id: string; executive_id: string; scheduled_at: string; status: string; connected: boolean | null; notes: string | null; rescheduled_from: string | null;
  companies: { name: string } | null;
};

type NewCompanyInput = {
  name: string; legalName: string; cnpj: string; email: string; phone: string; address: string;
  contact: string; contactEmail: string; contactPhone: string; serviceId: string; ownerId: string; value: number; source: string; stage: string;
};

type FollowupInput = { id?: string; companyId: string; assignedTo: string; type: string; title: string; notes: string; dueAt: string };
type MeetingInput = { companyId: string; executiveId: string; scheduledAt: string; notes: string; rescheduledFrom?: string };
type ActivationInput = { stage: string; executiveId: string; scheduledAt: string };
type ImportRecord = Record<string, string | number>;
type CrmDocument = { id: string; company_id: string; type: string; file_name: string; storage_path: string; mime_type: string | null; size_bytes: number | null; created_at: string };
type Ticket = { id: string; company_id: string; subject: string; description: string; priority: string; status: string; assigned_to: string | null; opened_by: string | null; created_at: string; companies?: { name: string } | null };
type TicketMessage = { id: string; ticket_id: string; sender_id: string; body: string; created_at: string };
type WhatsAppConnectionConfig = {
  id: string;
  provider: string;
  status: "not_configured" | "configured" | "connected" | "disconnected" | "error";
  device_name: string | null;
  masked_identifier: string | null;
  webhook_ready: boolean;
  last_tested_at: string | null;
  last_error: string | null;
};
type WhatsAppWebhookEvent = { id: string; event_type: string; processed: boolean; error: string | null; received_at: string };

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const moneyInput = (value: number) => value ? value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }) : "";
const parseMoneyInput = (raw: string) => {
  const cleaned = raw.replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const dateTime = (value?: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "Sem agendamento";
const toInputDate = (value?: string | null) => {
  const date = value ? new Date(value) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
const whatsappNumber = (lead: Lead) => {
  let digits = (lead.contactPhone || lead.phone).replace(/\D/g, "");
  if (!digits) return "";
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) digits = `55${digits}`;
  return digits;
};
const whatsappHref = (lead: Lead) => {
  const number = whatsappNumber(lead);
  return number ? `https://wa.me/${number}` : "";
};
const roleName = (role: Profile["role"]) => role === "super_admin" ? "Super administrador" : role === "executive" ? "Executivo de vendas" : "Cliente";
const tone = (status: string) => {
  if (["Ganho", "Concluída", "Conectou", "Aprovada", "Ativo"].some((item) => status.includes(item))) return "green";
  if (["Perdido", "Não conectou", "Não compareceu", "Alta", "Urgente"].some((item) => status.includes(item))) return "red";
  if (["Reunião", "Reagendada", "Negociação", "Não contatado"].some((item) => status.includes(item))) return "orange";
  if (["Proposta", "Enviada", "Em andamento"].some((item) => status.includes(item))) return "blue";
  return "purple";
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (authLoading) return <LoadingScreen/>;
  if (!session) return <AuthScreen/>;
  if (passwordRecovery) return <PasswordSetup name={session.user.user_metadata?.full_name ?? session.user.email ?? "Usuário"} done={async () => setPasswordRecovery(false)}/>;
  return <AuthenticatedApp user={session.user}/>;
}

function AuthenticatedApp({ user }: { user: User }) {
  const [page, setPage] = useState("Visão geral");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState("");
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [activeFollowup, setActiveFollowup] = useState<Followup | null>(null);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [activeExecutive, setActiveExecutive] = useState<Profile | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("i5media-crm-theme");
    const timer = window.setTimeout(() => {
      if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("i5media-crm-theme", theme);
    return () => { delete document.documentElement.dataset.theme; };
  }, [theme]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileNavOpen]);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    const [profileResult, teamResult, serviceResult, companyResult, followupResult, meetingResult] = await Promise.all([
      supabase.from("profiles").select("id,email,full_name,role,active,menu_permissions,can_view_revenue,must_change_password,invited_at").eq("id", user.id).single(),
      supabase.from("profiles").select("id,email,full_name,role,active,menu_permissions,can_view_revenue,must_change_password,invited_at").order("full_name"),
      supabase.from("services").select("id,name").eq("active", true).order("name"),
      supabase.from("companies").select("id,name,legal_name,cnpj,email,phone,address,estimated_value,stage,owner_id,service_id,source,is_activated,activated_at,client_user_id,client_invited_at,contacts(name,email,phone,is_primary),services(name),followups(due_at,completed_at)").order("created_at", { ascending: false }),
      supabase.from("followups").select("id,company_id,assigned_to,type,title,notes,due_at,completed_at,companies(name)").order("due_at", { ascending: true }),
      supabase.from("meetings").select("id,company_id,executive_id,scheduled_at,status,connected,notes,rescheduled_from,companies(name)").order("scheduled_at", { ascending: false }),
    ]);

    if (profileResult.data) setProfile(profileResult.data as Profile);
    const team = (teamResult.data ?? []) as Profile[];
    const names = new Map(team.map((item) => [item.id, item.full_name || item.email]));
    setProfiles(team);
    setServices((serviceResult.data ?? []) as Service[]);

    if (companyResult.error) {
      flash(`Não foi possível carregar os dados: ${companyResult.error.message}`);
      setLoading(false);
      return;
    }

    const companyRows = (companyResult.data ?? []) as unknown as CompanyRow[];
    setLeads(companyRows.map((item) => {
      const primary = item.contacts?.find((contact) => contact.is_primary) ?? item.contacts?.[0];
      const next = item.followups?.filter((followup) => !followup.completed_at && followup.due_at).sort((a, b) => new Date(a.due_at ?? 0).getTime() - new Date(b.due_at ?? 0).getTime())[0];
      return {
        id: item.id, name: item.name, legalName: item.legal_name ?? "", cnpj: item.cnpj ?? "", email: item.email ?? "", phone: item.phone ?? "", address: item.address ?? "",
        contact: primary?.name ?? "Contato não informado", contactEmail: primary?.email ?? "", contactPhone: primary?.phone ?? "",
        service: item.services?.name ?? "Serviço não informado", serviceId: item.service_id, value: Number(item.estimated_value ?? 0), stage: item.stage,
        owner: item.owner_id ? names.get(item.owner_id) ?? "Executivo" : "Não atribuído", ownerId: item.owner_id, next: dateTime(next?.due_at),
        source: item.source, isActivated: item.is_activated, activatedAt: item.activated_at, clientUserId: item.client_user_id, clientInvitedAt: item.client_invited_at,
      };
    }));

    const followupRows = (followupResult.data ?? []) as unknown as FollowupRow[];
    setFollowups(followupRows.map((item) => ({
      id: item.id, companyId: item.company_id, companyName: item.companies?.name ?? "Empresa", assignedTo: item.assigned_to,
      executiveName: item.assigned_to ? names.get(item.assigned_to) ?? "Executivo" : "Não atribuído", type: item.type, title: item.title,
      notes: item.notes ?? "", dueAt: item.due_at, completedAt: item.completed_at,
    })));

    const meetingRows = (meetingResult.data ?? []) as unknown as MeetingRow[];
    setMeetings(meetingRows.map((item) => ({
      id: item.id, companyId: item.company_id, companyName: item.companies?.name ?? "Empresa", executiveId: item.executive_id,
      executiveName: names.get(item.executive_id) ?? "Executivo", scheduledAt: item.scheduled_at, status: item.status,
      connected: item.connected, notes: item.notes ?? "", rescheduledFrom: item.rescheduled_from,
    })));
    setLoading(false);
  }, [user.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const staffProfiles = useMemo(() => {
    const active = profiles.filter((item) => item.active && item.role !== "client");
    return profile?.role === "super_admin" ? active : active.filter((item) => item.id === user.id);
  }, [profiles, profile?.role, user.id]);

  const stats = useMemo(() => {
    const pipelineLeads = leads.filter((lead) => lead.isActivated);
    const active = pipelineLeads.filter((lead) => !["Ganho", "Perdido"].includes(lead.stage));
    const won = pipelineLeads.filter((lead) => lead.stage === "Ganho");
    const finished = pipelineLeads.filter((lead) => ["Ganho", "Perdido"].includes(lead.stage));
    return { active: active.length, pipeline: active.reduce((sum, lead) => sum + lead.value, 0), revenue: won.reduce((sum, lead) => sum + lead.value, 0), conversion: finished.length ? won.length / finished.length * 100 : 0 };
  }, [leads]);

  const persistStage = async (lead: Lead, stage: string) => {
    const previous = lead.stage;
    setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, stage } : item));
    const { error } = await supabase.from("companies").update({ stage, closed_at: ["Ganho", "Perdido"].includes(stage) ? new Date().toISOString() : null }).eq("id", lead.id);
    if (error) {
      setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, stage: previous } : item));
      flash(error.message);
      return false;
    }
    flash(`Lead movido para ${stage}`);
    return true;
  };

  const requestStageChange = async (lead: Lead, stage: string) => {
    if (stage === lead.stage) return;
    if (stage === "Reunião marcada") { setActiveLead(lead); setActiveMeeting(null); setModal("meeting"); return; }
    if (stage === "Follow-up") { setActiveLead(lead); setActiveFollowup(null); setModal("followup"); return; }
    if (stage === "Ganho") { setActiveLead(lead); setModal("client-access"); return; }
    await persistStage(lead, stage);
  };

  const saveCompany = async (input: NewCompanyInput) => {
    const { data, error } = await supabase.from("companies").insert({
      name: input.name, legal_name: input.legalName || null, cnpj: input.cnpj || null, email: input.email || null, phone: input.phone || null,
      address: input.address || null, estimated_value: input.value, service_id: input.serviceId || null, owner_id: input.ownerId || user.id,
      created_by: user.id, source: input.source || "Manual", stage: input.stage,
      is_activated: true, activated_at: new Date().toISOString(), activated_by: user.id,
      closed_at: input.stage === "Ganho" ? new Date().toISOString() : null,
    }).select("id").single();
    if (error) throw error;
    if (input.contact && data) {
      const { error: contactError } = await supabase.from("contacts").insert({ company_id: data.id, name: input.contact, email: input.contactEmail || null, phone: input.contactPhone || null, kind: "Responsável", is_primary: true });
      if (contactError) { await loadData(); throw contactError; }
    }
    await loadData();
    return data.id as string;
  };

  const sendAccessInvite = async (input: { role: "executive" | "client"; fullName: string; email: string; companyId?: string; menuPermissions?: string[]; canViewRevenue?: boolean }) => {
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: {
        full_name: input.fullName,
        email: input.email,
        role: input.role,
        company_id: input.companyId,
        menu_permissions: input.menuPermissions ?? [],
        can_view_revenue: input.canViewRevenue === true,
        redirect_to: `${window.location.origin}/?first_access=1`,
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const closeContractAndInvite = async (lead: Lead, fullName: string, email: string) => {
    if (lead.stage !== "Ganho") {
      const moved = await persistStage(lead, "Ganho");
      if (!moved) throw new Error("Não foi possível concluir o fechamento.");
    }
    await sendAccessInvite({ role: "client", fullName, email, companyId: lead.id });
    await loadData();
  };

  const saveFollowup = async (input: FollowupInput) => {
    const payload = { company_id: input.companyId, assigned_to: input.assignedTo, type: input.type, title: input.title, notes: input.notes || null, due_at: new Date(input.dueAt).toISOString(), created_by: user.id, completed_at: null };
    const result = input.id ? await supabase.from("followups").update(payload).eq("id", input.id) : await supabase.from("followups").insert(payload);
    if (result.error) throw result.error;
    const lead = leads.find((item) => item.id === input.companyId);
    if (lead && lead.stage !== "Follow-up") await persistStage(lead, "Follow-up");
    await loadData();
  };

  const completeFollowup = async (item: Followup) => {
    const { error } = await supabase.from("followups").update({ completed_at: item.completedAt ? null : new Date().toISOString() }).eq("id", item.id);
    if (error) flash(error.message); else { flash(item.completedAt ? "Follow-up reaberto" : "Follow-up concluído"); await loadData(); }
  };

  const saveMeeting = async (input: MeetingInput) => {
    if (input.rescheduledFrom) {
      const { error } = await supabase.from("meetings").update({ status: "Reagendada" }).eq("id", input.rescheduledFrom);
      if (error) throw error;
    }
    const { error } = await supabase.from("meetings").insert({ company_id: input.companyId, executive_id: input.executiveId, scheduled_at: new Date(input.scheduledAt).toISOString(), notes: input.notes || null, rescheduled_from: input.rescheduledFrom || null, created_by: user.id });
    if (error) throw error;
    const lead = leads.find((item) => item.id === input.companyId);
    if (lead && lead.stage !== "Reunião marcada") await persistStage(lead, "Reunião marcada");
    await loadData();
  };

  const updateMeetingResult = async (meeting: Meeting, connected: boolean) => {
    const { error } = await supabase.from("meetings").update({ status: "Concluída", connected }).eq("id", meeting.id);
    if (error) flash(error.message); else { flash(connected ? "Reunião marcada como conectada" : "Reunião marcada como não conectada"); await loadData(); }
  };

  const activateLead = async (lead: Lead, input: ActivationInput) => {
    const now = new Date().toISOString();
    const executiveId = input.executiveId || lead.ownerId || user.id;
    const { error } = await supabase.from("companies").update({
      is_activated: true,
      activated_at: now,
      activated_by: user.id,
      stage: input.stage,
      closed_at: ["Ganho", "Perdido"].includes(input.stage) ? now : null,
    }).eq("id", lead.id);
    if (error) throw error;

    let scheduleError: { message: string } | null = null;
    if (input.stage === "Follow-up") {
      const result = await supabase.from("followups").insert({ company_id: lead.id, assigned_to: executiveId, type: "Follow-up", title: "Primeiro retorno comercial", due_at: new Date(input.scheduledAt).toISOString(), created_by: user.id });
      scheduleError = result.error;
    }
    if (input.stage === "Reunião marcada") {
      const result = await supabase.from("meetings").insert({ company_id: lead.id, executive_id: executiveId, scheduled_at: new Date(input.scheduledAt).toISOString(), created_by: user.id });
      scheduleError = result.error;
    }
    if (scheduleError) {
      await supabase.from("companies").update({ is_activated: false, activated_at: null, activated_by: null, stage: "Novo lead", closed_at: null }).eq("id", lead.id);
      throw new Error(scheduleError.message);
    }
    await loadData();
  };

  const importRecords = async (records: ImportRecord[], mode: "manual" | "automatic") => {
    const executives = staffProfiles.length ? staffProfiles : profiles.filter((item) => item.role !== "client" && item.active);
    const serviceMap = new Map(services.map((item) => [item.name.toLowerCase(), item.id]));
    const executiveMap = new Map(executives.map((item) => [item.email.toLowerCase(), item.id]));
    const existing = new Set(leads.flatMap((lead) => [lead.cnpj.replace(/\D/g, ""), lead.email.toLowerCase()].filter(Boolean)));
    let imported = 0;
    let duplicates = 0;
    let pointer = 0;

    const { data: batch } = await supabase.from("import_batches").insert({ file_name: "modelo_importacao_leads_i5media.xlsx", distribution_mode: mode, created_by: user.id, total_rows: records.length }).select("id").single();

    for (const record of records) {
      const name = String(record.empresa_nome ?? "").trim();
      const cnpj = String(record.cnpj ?? "").trim();
      const email = String(record.email_empresa ?? "").trim().toLowerCase();
      const keys = [cnpj.replace(/\D/g, ""), email].filter(Boolean);
      if (!name || keys.some((key) => existing.has(key))) { duplicates += 1; continue; }
      const manualOwner = executiveMap.get(String(record.executivo_email ?? "").toLowerCase());
      const ownerId = mode === "manual" && manualOwner ? manualOwner : executives[pointer++ % Math.max(executives.length, 1)]?.id ?? user.id;
      const serviceId = serviceMap.get(String(record.servico ?? "").toLowerCase()) ?? null;
      const { data, error } = await supabase.from("companies").insert({
        name, legal_name: String(record.razao_social ?? "") || null, cnpj: cnpj || null, email: email || null,
        phone: String(record.telefone_empresa ?? "") || null, address: String(record.localizacao ?? "") || null,
        service_id: serviceId, estimated_value: canViewRevenue ? Number(record.valor_estimado ?? 0) || 0 : 0, source: String(record.origem ?? "Importação Excel"), stage: "Novo lead", owner_id: ownerId, created_by: user.id,
        is_activated: false, activated_at: null, activated_by: null,
      }).select("id").single();
      if (error || !data) continue;
      const contactName = String(record.contato_nome ?? "").trim();
      if (contactName) await supabase.from("contacts").insert({ company_id: data.id, name: contactName, email: String(record.contato_email ?? "") || null, phone: String(record.contato_telefone ?? "") || null, kind: "Responsável", is_primary: true });
      keys.forEach((key) => existing.add(key));
      imported += 1;
    }
    if (batch) await supabase.from("import_batches").update({ status: "completed", imported_rows: imported, duplicate_rows: duplicates, completed_at: new Date().toISOString() }).eq("id", batch.id);
    await loadData();
    return { imported, duplicates };
  };

  if (loading || !profile) return <LoadingScreen/>;
  if (profile.must_change_password) return <PasswordSetup name={profile.full_name || profile.email} done={loadData}/>;
  if (profile.role === "client") return <ClientPortal profile={profile} leads={leads} profiles={profiles} theme={theme} toggleTheme={() => setTheme((current) => current === "light" ? "dark" : "light")}/>;

  const visibleNav = profile.role === "super_admin" ? nav : agentMenuOptions.filter((item) => profile.menu_permissions.includes(item));
  const activePage = visibleNav.includes(page) ? page : visibleNav[0] ?? "";
  const canViewRevenue = profile.role === "super_admin" || profile.can_view_revenue;
  const displayName = profile.full_name || profile.email.split("@")[0];
  const openLead = () => { setActiveLead(null); setModal("lead"); };
  const openClient = () => { setActiveLead(null); setModal("client"); };

  return (
    <div className={`shell theme-${theme}`}>
      <aside className={mobileNavOpen ? "mobile-open" : ""} aria-label="Menu principal">
        <div className="brand"><b>i5</b><span><strong>I5MEDIA</strong><small>Sales Hub</small></span></div>
        <nav>{visibleNav.map((item) => <button className={activePage === item ? "active" : ""} onClick={() => { setPage(item); setMobileNavOpen(false); }} key={item}><i>{navIcons[item]}</i>{item}</button>)}</nav>
        <div className="storage"><span>Supabase <b>Conectado</b></span><progress value="100" max="100"/><small>Dados e segurança ativos</small></div>
      </aside>
      {mobileNavOpen && <button className="nav-backdrop" aria-label="Fechar menu" onClick={() => setMobileNavOpen(false)}/>}
      <main>
        <header>
          <button className="mobile-menu" aria-label="Abrir menu" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>☰</button>
          <div className="search">⌕ <input placeholder="Buscar empresa, contato ou CNPJ..."/><kbd>⌘ K</kbd></div>
          <button className="theme-toggle" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")} aria-label={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"} title={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"}><i>{theme === "light" ? "☾" : "☀"}</i><span>{theme === "light" ? "Escuro" : "Claro"}</span></button>
          <button className="bell" aria-label="Ver agenda e notificações" onClick={() => setPage("Visão geral")}>♢<i/>{meetings.filter((item) => item.status === "Agendada" && new Date(item.scheduledAt) >= new Date()).length + followups.filter((item) => !item.completedAt && item.dueAt).length > 0 && <em>{meetings.filter((item) => item.status === "Agendada" && new Date(item.scheduledAt) >= new Date()).length + followups.filter((item) => !item.completedAt && item.dueAt).length}</em>}</button>
          <div className="user"><Avatar name={displayName}/><span><b>{displayName}</b><small>{roleName(profile.role)}</small></span></div>
          <button className="logout" onClick={() => supabase.auth.signOut()}>Sair</button>
        </header>
        <section>
          {activePage && (
            <Title page={activePage} name={displayName.split(" ")[0]} onLead={openLead} onClient={openClient} onImport={() => setModal("import")} onFollowup={() => { setActiveFollowup(null); setActiveLead(null); setModal("followup"); }} onMeeting={() => { setActiveMeeting(null); setActiveLead(null); setModal("meeting"); }}/>
          )}
          {activePage === "Visão geral" && <Dashboard leads={leads.filter((lead) => lead.isActivated)} meetings={meetings} followups={followups} profiles={profiles} profile={profile} stats={stats} canViewRevenue={canViewRevenue} go={setPage}/>}
          {activePage === "Leads" && <LeadList leads={leads} canViewRevenue={canViewRevenue} onActivate={(lead) => { setActiveLead(lead); setModal("activate"); }} onOpen={(lead) => { setActiveLead(lead); setModal("details"); }}/>}
          {activePage === "Pipeline" && <Pipeline leads={leads} canViewRevenue={canViewRevenue} move={requestStageChange} profile={profile} profiles={profiles} onOpen={(lead) => { setActiveLead(lead); setModal("details"); }}/>}
          {activePage === "Follow-ups" && (
            <FollowupsView followups={followups} onComplete={completeFollowup} onEdit={(item) => { setActiveFollowup(item); setActiveLead(leads.find((lead) => lead.id === item.companyId) ?? null); setModal("followup"); }}/>
          )}
          {activePage === "Reuniões" && (
            <MeetingsView meetings={meetings} profiles={profiles} onResult={updateMeetingResult} onReschedule={(item) => { setActiveMeeting(item); setActiveLead(leads.find((lead) => lead.id === item.companyId) ?? null); setModal("meeting"); }}/>
          )}
          {activePage === "Propostas" && <Proposals leads={leads}/>}
          {activePage === "Clientes" && <Clients leads={leads.filter((lead) => lead.stage === "Ganho")} canViewRevenue={canViewRevenue} onAdd={openClient} onOpen={(lead) => { setActiveLead(lead); setModal("client-workspace"); }}/>} 
          {activePage === "Chamados" && <TicketCenter profile={profile} leads={leads.filter((lead) => lead.stage === "Ganho")}/>} 
          {activePage === "WhatsApp" && <WhatsAppFoundation profile={profile} go={setPage}/>}
          {activePage === "Equipe" && (
            <Team profiles={profiles} leads={leads.filter((lead) => lead.isActivated)} meetings={meetings} onAdd={() => { setActiveExecutive(null); setModal("user"); }} onEdit={(executive) => { setActiveExecutive(executive); setModal("permissions"); }}/>
          )}
          {activePage === "Chat interno" && <Chat profile={profile} profiles={profiles} leads={leads}/>}
          {activePage === "Configurações" && profile.role === "super_admin" && <WhatsAppSettings/>}
          {!activePage && <EmptyPanel title="Nenhum módulo liberado" text="Peça ao Super Admin para selecionar ao menos um menu para este acesso."/>}
        </section>
      </main>
      {visibleNav.includes("Chat interno") && <button className="float" onClick={() => setPage("Chat interno")} aria-label="Abrir chat">◌</button>}
      {toast && <div className="toast">✓ {toast}</div>}
      {modal && <Modal close={() => setModal("")}>
        {modal === "import" && (
          <ImportModal onImport={importRecords} onDone={(message) => { setModal(""); setPage("Leads"); flash(message); }}/>
        )}
        {(modal === "lead" || modal === "client") && (
          <CompanyForm services={services} profiles={staffProfiles} currentUserId={user.id} canViewRevenue={canViewRevenue} initialStage={modal === "client" ? "Ganho" : "Novo lead"} done={async (input) => { try { const companyId = await saveCompany(input); if (input.stage === "Ganho") await sendAccessInvite({ role: "client", fullName: input.contact, email: input.contactEmail || input.email, companyId }); setModal(""); setPage(input.stage === "Ganho" ? "Clientes" : "Leads"); flash(input.stage === "Ganho" ? "Cliente cadastrado e convite de acesso enviado" : "Lead cadastrado e exibido na lista"); } catch (error) { flash(errorMessage(error)); } }}/>
        )}
        {modal === "followup" && <FollowupForm leads={leads.filter((lead) => lead.isActivated)} profiles={staffProfiles} lead={activeLead} existing={activeFollowup} currentUserId={user.id} done={async (input) => { try { await saveFollowup(input); setModal(""); flash(input.id ? "Follow-up reagendado" : "Follow-up agendado"); } catch (error) { flash(errorMessage(error)); } }}/>}
        {modal === "meeting" && <MeetingForm leads={leads.filter((lead) => lead.isActivated)} profiles={staffProfiles} lead={activeLead} existing={activeMeeting} currentUserId={user.id} done={async (input) => { try { await saveMeeting(input); setModal(""); flash(input.rescheduledFrom ? "Reunião reagendada" : "Reunião agendada"); } catch (error) { flash(errorMessage(error)); } }}/>}
        {modal === "details" && activeLead && <LeadDetails lead={activeLead} canViewRevenue={canViewRevenue} onFollowup={() => { setActiveFollowup(null); setModal("followup"); }} onMeeting={() => { setActiveMeeting(null); setModal("meeting"); }}/>}
        {modal === "activate" && activeLead && <ActivateLeadForm lead={activeLead} profiles={staffProfiles} currentUserId={user.id} done={async (input) => { try { await activateLead(activeLead, input); setModal(""); flash(`Lead ativado em ${input.stage}`); } catch (error) { flash(errorMessage(error)); } }}/>} 
        {modal === "client-access" && activeLead && <ClientAccessForm lead={activeLead} done={async (fullName, email) => { try { await closeContractAndInvite(activeLead, fullName, email); setModal(""); setPage("Clientes"); flash("Contrato fechado e convite de boas-vindas enviado ao cliente"); } catch (error) { flash(errorMessage(error)); } }}/>} 
        {modal === "client-workspace" && activeLead && <ClientWorkspace lead={activeLead} profile={profile} profiles={profiles} onInvite={async (fullName, email) => { await sendAccessInvite({ role: "client", fullName, email, companyId: activeLead.id }); await loadData(); flash("Convite de acesso enviado ao cliente"); }}/>} 
        {modal === "user" && (
          <UserForm invite={sendAccessInvite} done={() => { setModal(""); void loadData(); flash("Executivo criado e convite enviado por e-mail"); }}/>
        )}
        {modal === "permissions" && activeExecutive && (
          <PermissionForm profile={activeExecutive} done={async (permissions, canView) => { const { error } = await supabase.from("profiles").update({ menu_permissions: permissions, can_view_revenue: canView }).eq("id", activeExecutive.id); if (error) { flash(error.message); return; } setModal(""); await loadData(); flash("Permissões atualizadas"); }}/>
        )}
      </Modal>}
    </div>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<"login" | "register" | "recover">("login");
  const [email, setEmail] = useState(ADMIN_EMAIL);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("Matheus Gouvea");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "login") { const result = await supabase.auth.signInWithPassword({ email, password }); if (result.error) throw result.error; }
      else if (mode === "register") {
        if (email.toLowerCase() !== ADMIN_EMAIL) throw new Error("O primeiro acesso está reservado ao e-mail do Super Admin.");
        const result = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } }); if (result.error) throw result.error;
        setMessage(result.data.session ? "Conta criada e acesso liberado." : "Conta criada. Confirme o e-mail recebido e depois entre.");
      } else { const result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/?first_access=1` }); if (result.error) throw result.error; setMessage("Enviamos um link de recuperação para o seu e-mail."); }
    } catch (submitError) { setError(translateAuthError(errorMessage(submitError))); } finally { setBusy(false); }
  };
  return <main className="auth-screen"><section className="auth-brand"><div className="auth-logo">i5</div><span>I5MEDIA · CRM COMERCIAL</span><h1>Vendas organizadas.<br/>Relacionamentos que crescem.</h1><p>Leads, reuniões, follow-ups e resultados da equipe em uma central conectada ao Supabase.</p><div className="auth-status"><i/> Supabase conectado e protegido por RLS</div></section><section className="auth-card"><label className="tag">ACESSO SEGURO</label><h2>{mode === "login" ? "Entrar no Sales Hub" : mode === "register" ? "Criar acesso do Super Admin" : "Recuperar senha"}</h2><p>{mode === "register" ? "Não existe senha padrão. Defina uma senha forte e exclusiva." : "Use seu e-mail e senha cadastrados."}</p><form onSubmit={submit}>{mode === "register" && <label>Nome completo<input value={name} onChange={(event) => setName(event.target.value)} required/></label>}<label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required/></label>{mode !== "recover" && <label>Senha<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 8 caracteres" required/></label>}{error && <div className="auth-error">{error}</div>}{message && <div className="auth-success">{message}</div>}<button className="primary full" disabled={busy}>{busy ? "Aguarde..." : mode === "login" ? "Entrar" : mode === "register" ? "Criar meu acesso" : "Enviar link"}</button></form><div className="auth-links">{mode !== "register" && <button onClick={() => setMode("register")}>Primeiro acesso</button>}{mode !== "recover" && <button onClick={() => setMode("recover")}>Esqueci minha senha</button>}{mode !== "login" && <button onClick={() => setMode("login")}>Voltar ao login</button>}</div></section></main>;
}

function PasswordSetup({ name, done }: { name: string; done: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (password.length < 8) { setError("A senha precisa ter pelo menos 8 caracteres."); return; }
    if (password !== confirmation) { setError("As senhas não coincidem."); return; }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      const { data, error: completionError } = await supabase.functions.invoke("admin-create-user", { body: { action: "complete_first_access" } });
      if (completionError) throw completionError;
      if (data?.error) throw new Error(data.error);
      await done();
    } catch (submitError) { setError(translateAuthError(errorMessage(submitError))); }
    finally { setBusy(false); }
  };
  return <main className="auth-screen first-access"><section className="auth-brand"><div className="auth-logo">i5</div><span>PRIMEIRO ACESSO</span><h1>Bem-vindo,<br/>{name}.</h1><p>Crie sua senha pessoal para concluir o convite. Depois da confirmação, seu painel será liberado automaticamente.</p><div className="auth-status"><i/> Link temporário validado</div></section><section className="auth-card"><label className="tag">CRIAR SENHA</label><h2>Proteja seu acesso</h2><p>Use pelo menos 8 caracteres. Essa senha será pessoal e não ficará visível para o administrador.</p><form onSubmit={submit}><label>Nova senha<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required/></label><label>Confirmar nova senha<input type="password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required/></label>{error && <div className="auth-error">{error}</div>}<button className="primary full" disabled={busy || password.length < 8 || confirmation.length < 8}>{busy ? "Confirmando..." : "Criar senha e acessar"}</button></form></section></main>;
}

function translateAuthError(message: string) {
  if (message.includes("Invalid login credentials")) return "E-mail ou senha incorretos.";
  if (message.includes("already registered")) return "Este e-mail já está cadastrado.";
  if (message.includes("Password should")) return "A senha precisa ter pelo menos 8 caracteres.";
  return message;
}

function LoadingScreen() { return <main className="loading-screen"><div className="auth-logo">i5</div><span>Conectando ao Sales Hub...</span></main>; }
function Avatar({ name }: { name: string }) { return <i className="avatar">{name.split(" ").filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</i>; }
function Pill({ status }: { status: string }) { return <span className={`pill ${tone(status)}`}>{status}</span>; }

function Title({ page, name, onLead, onClient, onImport, onFollowup, onMeeting }: { page: string; name: string; onLead: () => void; onClient: () => void; onImport: () => void; onFollowup: () => void; onMeeting: () => void }) {
  const data: Record<string, [string, string]> = {
    "Visão geral": [`Olá, ${name}! 👋`, "Resultados, agenda e desempenho comercial em tempo real."], Leads: ["Leads e contatos", "Cadastros completos com empresa, responsável e localização."], Pipeline: ["Pipeline de vendas", "Arraste os cards e acompanhe cada oportunidade."],
    "Follow-ups": ["Follow-ups e agenda", "Próximas ações com data, responsável e conclusão."], Reuniões: ["Central de reuniões", "Agendamentos, reagendamentos e resultado da conexão."], Propostas: ["Propostas e orçamentos", "Crie, envie e acompanhe propostas comerciais."],
    Clientes: ["Clientes", "Cadastre clientes diretamente ou converta leads ganhos."], Chamados: ["Chamados dos clientes", "Centralize solicitações após o fechamento."], WhatsApp: ["WhatsApp Multiatendimento", "Acompanhe a conexão da DROPE e prepare as filas de atendimento."], Equipe: ["Equipe e desempenho", "Compare quem mais agenda e quem mais fecha contratos."], "Chat interno": ["Chat interno", "Conversas privadas e canais da equipe."], Configurações: ["Configurações", "Integrações e regras administrativas do CRM."],
  };
  return <div className="title"><div><span>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date()).toUpperCase()}</span><h1>{data[page]?.[0]}</h1><p>{data[page]?.[1]}</p></div><div className="title-actions">{["Visão geral", "Leads"].includes(page) && <><button className="ghost" onClick={onImport}>⇧ Importar Excel</button><button className="primary" onClick={onLead}>＋ Novo lead</button></>}{page === "Clientes" && <button className="primary" onClick={onClient}>＋ Cadastrar cliente</button>}{page === "Follow-ups" && <button className="primary" onClick={onFollowup}>＋ Agendar follow-up</button>}{page === "Reuniões" && <button className="primary" onClick={onMeeting}>＋ Agendar reunião</button>}</div></div>;
}

function Dashboard({ leads, meetings, followups, profiles, profile, stats, canViewRevenue, go }: { leads: Lead[]; meetings: Meeting[]; followups: Followup[]; profiles: Profile[]; profile: Profile; stats: { active: number; pipeline: number; revenue: number; conversion: number }; canViewRevenue: boolean; go: (page: string) => void }) {
  const performance = getPerformance(profiles, leads, meetings);
  const now = new Date();
  const ownMeetings = meetings.filter((item) => profile.role === "super_admin" || item.executiveId === profile.id);
  const ownFollowups = followups.filter((item) => profile.role === "super_admin" || item.assignedTo === profile.id);
  const upcomingMeetings = ownMeetings.filter((item) => item.status === "Agendada" && new Date(item.scheduledAt) >= now).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const pendingFollowups = ownFollowups.filter((item) => !item.completedAt && item.dueAt).sort((a, b) => new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime());
  const overdueFollowups = pendingFollowups.filter((item) => new Date(item.dueAt ?? 0) < now);
  const agenda = [
    ...upcomingMeetings.map((item) => ({ id: `meeting-${item.id}`, kind: "Reunião", company: item.companyName, when: item.scheduledAt, executive: item.executiveName, page: "Reuniões" })),
    ...pendingFollowups.filter((item) => new Date(item.dueAt ?? 0) >= now).map((item) => ({ id: `followup-${item.id}`, kind: item.type, company: item.companyName, when: item.dueAt ?? "", executive: item.executiveName, page: "Follow-ups" })),
  ].sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime()).slice(0, 6);
  const statItems = canViewRevenue
    ? [["Leads em tratamento", String(stats.active), "Carteira atual", "◎"], ["Pipeline em aberto", money(stats.pipeline), "Valor estimado", "◈"], ["Faturamento ganho", money(stats.revenue), "Contratos ganhos", "↗"], ["Taxa de conversão", `${stats.conversion.toFixed(1)}%`, "Ganho ÷ encerrados", "⌁"]]
    : [["Leads em tratamento", String(stats.active), "Carteira atual", "◎"], ["Reuniões", String(meetings.length), "Agendamentos registrados", "▣"], ["Contratos ganhos", String(leads.filter((lead) => lead.stage === "Ganho").length), "Fechamentos", "↗"], ["Taxa de conversão", `${stats.conversion.toFixed(1)}%`, "Ganho ÷ encerrados", "⌁"]];
  return <><div className="stats">{statItems.map((item, index) => <article key={item[0]}><i className={`stat s${index}`}>{item[3]}</i><span><small>{item[0]}</small><b>{item[1]}</b><em>{item[2]}</em></span></article>)}</div><article className="panel executive-agenda"><div className="agenda-summary"><span><label className="tag">{profile.role === "super_admin" ? "AGENDA DA EQUIPE" : "MINHA AGENDA"}</label><h2>Próximos compromissos comerciais</h2><p>Reuniões, agendamentos e follow-ups que precisam de atenção.</p></span><div><button onClick={() => go("Reuniões")}><small>Próximas reuniões</small><b>{upcomingMeetings.length}</b></button><button onClick={() => go("Follow-ups")}><small>Follow-ups pendentes</small><b>{pendingFollowups.length}</b></button><button className={overdueFollowups.length ? "urgent" : ""} onClick={() => go("Follow-ups")}><small>Follow-ups atrasados</small><b>{overdueFollowups.length}</b></button></div></div><div className="agenda-items">{agenda.length ? agenda.map((item) => <button key={item.id} onClick={() => go(item.page)}><i className={item.kind === "Reunião" ? "meeting" : "followup"}>{item.kind === "Reunião" ? "▣" : "◷"}</i><span><b>{item.company}</b><small>{item.kind} · {item.executive}</small></span><em>{dateTime(item.when)}</em></button>) : <Empty title="Agenda livre" text="As próximas reuniões e ações comerciais aparecerão aqui."/>}</div></article><div className="dashboard-grid"><article className="panel"><PanelHead title="Funil comercial" subtitle="Distribuição atual por etapa" action="Ver pipeline →" click={() => go("Pipeline")}/><div className="funnel">{stages.map((stage) => { const count = leads.filter((lead) => lead.stage === stage).length; const width = leads.length ? Math.max(7, count / leads.length * 100) : 7; return <div key={stage}><span>{stage}</span><b><i style={{ width: `${width}%` }}/></b><em>{count}</em></div>; })}</div></article><PerformancePanel rows={performance} compact showRevenue={canViewRevenue}/></div><article className="panel deals recent"><PanelHead title="Negociações recentes" subtitle="Últimas oportunidades da carteira" action="Ver todas →" click={() => go("Leads")}/>{leads.slice(0, 6).map((lead) => <div key={lead.id}><CompanyCell lead={lead}/><Pill status={lead.stage}/><strong>{canViewRevenue ? money(lead.value) : "Valor restrito"}</strong><span className="owner"><Avatar name={lead.owner}/>{lead.owner}</span><small>{lead.next}</small></div>)}</article></>;
}

function PanelHead({ title, subtitle, action, click }: { title: string; subtitle: string; action?: string; click?: () => void }) { return <div className="head"><span><b>{title}</b><small>{subtitle}</small></span>{action && <button onClick={click}>{action}</button>}</div>; }
function CompanyCell({ lead }: { lead: Lead }) { return <span className="company"><i>{lead.name[0]}</i><b>{lead.name}<small>{lead.contact}</small></b></span>; }

function Pipeline({ leads, canViewRevenue, move, profile, profiles, onOpen }: { leads: Lead[]; canViewRevenue: boolean; move: (lead: Lead, stage: string) => void; profile: Profile; profiles: Profile[]; onOpen: (lead: Lead) => void }) {
  const [dropTarget, setDropTarget] = useState("");
  const [draggingId, setDraggingId] = useState("");
  const [ownerFilter, setOwnerFilter] = useState(profile.role === "super_admin" ? "all" : profile.id);
  const activeLeads = leads.filter((lead) => lead.isActivated);
  const visibleLeads = profile.role === "super_admin" && ownerFilter !== "all" ? activeLeads.filter((lead) => lead.ownerId === ownerFilter) : activeLeads;
  const staff = profiles.filter((item) => item.role !== "client" && item.active);
  const drop = (stage: string, id: string) => { const lead = visibleLeads.find((item) => item.id === id); setDropTarget(""); if (lead) void move(lead, stage); };
  return <>{profile.role === "super_admin" && <div className="pipeline-view panel"><span><b>Visão do Kanban</b><small>Veja o funil geral, o seu ou o de cada executivo.</small></span><label>Carteira<select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="all">Visão geral — todos</option>{staff.map((item) => <option value={item.id} key={item.id}>{item.id === profile.id ? "Meu funil" : item.full_name || item.email}</option>)}</select></label></div>}<div className="kanban-tip">↔ Arraste lateralmente para navegar · Clique no card para abrir a ficha · Arraste para mudar de etapa</div><div className="kanban">{stages.map((stage) => <section className={`kanban-column ${dropTarget === stage ? "drop-target" : ""}`} key={stage} onDragOver={(event) => { event.preventDefault(); setDropTarget(stage); }} onDragLeave={() => setDropTarget("")} onDrop={(event) => drop(stage, event.dataTransfer.getData("text/lead-id"))}><header><i/>{stage}<em>{visibleLeads.filter((lead) => lead.stage === stage).length}</em></header>{visibleLeads.filter((lead) => lead.stage === stage).map((lead) => { const wa = whatsappHref(lead); return <article className="kanban-card" draggable onClick={() => { if (draggingId !== lead.id) onOpen(lead); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(lead); }} tabIndex={0} role="button" aria-label={`Abrir ficha de ${lead.name}`} onDragStart={(event) => { setDraggingId(lead.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/lead-id", lead.id); }} onDragEnd={() => window.setTimeout(() => setDraggingId(""), 0)} key={lead.id}><div className="kanban-card-top"><span className="logo">{lead.name[0]}</span><small>{lead.service}</small></div><h4>{lead.name}</h4><p>{lead.contact}</p><div className="kanban-contact-actions"><b>{canViewRevenue ? money(lead.value) : "Valor restrito"}</b>{wa ? <a href={wa} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>WhatsApp ↗</a> : <small>Sem WhatsApp</small>}</div><footer><span className="owner"><Avatar name={lead.owner}/>{lead.owner}</span><span>◷ {lead.next}</span></footer><select aria-label={`Etapa de ${lead.name}`} value={lead.stage} onClick={(event) => event.stopPropagation()} onChange={(event) => void move(lead, event.target.value)}>{stages.map((item) => <option key={item}>{item}</option>)}</select></article>; })}</section>)}</div></>;
}

function LeadList({ leads, canViewRevenue, onActivate, onOpen }: { leads: Lead[]; canViewRevenue: boolean; onActivate: (lead: Lead) => void; onOpen: (lead: Lead) => void }) {
  const [filter, setFilter] = useState("all");
  const list = leads.filter((lead) => filter === "all" || (filter === "pending" ? !lead.isActivated : lead.isActivated));
  return <><div className="lead-activation-summary"><button className={filter === "pending" ? "selected" : ""} onClick={() => setFilter("pending")}><small>Não contatados</small><b>{leads.filter((lead) => !lead.isActivated).length}</b></button><button className={filter === "active" ? "selected" : ""} onClick={() => setFilter("active")}><small>Em tratamento</small><b>{leads.filter((lead) => lead.isActivated).length}</b></button><button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}><small>Todos os leads</small><b>{leads.length}</b></button></div><article className="panel lead-table lead-activation-table"><header><span>EMPRESA / CONTATO</span><span>CONTATOS</span><span>LOCALIZAÇÃO</span><span>{canViewRevenue ? "STATUS / VALOR" : "STATUS"}</span><span>RESPONSÁVEL</span><span>AÇÃO</span></header>{list.length ? list.map((lead) => <div className={!lead.isActivated ? "pending-lead" : ""} key={lead.id} onClick={() => onOpen(lead)}><CompanyCell lead={lead}/><span className="contact-stack"><b>{lead.phone || lead.contactPhone || "Sem telefone"}</b><small>{lead.email || lead.contactEmail || "Sem e-mail"}</small><small>{lead.cnpj || "CNPJ não informado"}</small></span><span>{lead.address || "Não informada"}</span><span><Pill status={lead.isActivated ? lead.stage : "Não contatado"}/>{canViewRevenue && <strong>{money(lead.value)}</strong>}</span><span className="owner"><Avatar name={lead.owner}/>{lead.owner}</span><span className="lead-row-actions">{!lead.isActivated ? <button className="activate-button" onClick={(event) => { event.stopPropagation(); onActivate(lead); }}>Ativar lead</button> : <button className="ghost-small" onClick={(event) => { event.stopPropagation(); onOpen(lead); }}>Abrir ficha</button>}{whatsappHref(lead) && <a href={whatsappHref(lead)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>WhatsApp</a>}</span></div>) : <Empty title={filter === "pending" ? "Nenhum lead aguardando contato" : "Nenhum lead neste filtro"} text={filter === "pending" ? "Os próximos contatos importados aparecerão aqui para ativação." : "Altere o filtro para visualizar outros contatos."}/>}</article></>;
}

function FollowupsView({ followups, onComplete, onEdit }: { followups: Followup[]; onComplete: (item: Followup) => void; onEdit: (item: Followup) => void }) {
  const [filter, setFilter] = useState("open");
  const list = followups.filter((item) => filter === "all" || (filter === "done" ? item.completedAt : !item.completedAt));
  const overdue = followups.filter((item) => !item.completedAt && item.dueAt && new Date(item.dueAt) < new Date()).length;
  return <><div className="mini-stats"><article><small>Pendentes</small><b>{followups.filter((item) => !item.completedAt).length}</b></article><article><small>Atrasados</small><b>{overdue}</b></article><article><small>Concluídos</small><b>{followups.filter((item) => item.completedAt).length}</b></article></div><div className="filters"><button className={filter === "open" ? "selected" : ""} onClick={() => setFilter("open")}>Pendentes</button><button className={filter === "done" ? "selected" : ""} onClick={() => setFilter("done")}>Concluídos</button><button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>Todos</button></div><article className="panel activity-list">{list.length ? list.map((item) => { const late = !item.completedAt && item.dueAt && new Date(item.dueAt) < new Date(); return <div className={item.completedAt ? "completed" : ""} key={item.id}><button className="check" onClick={() => onComplete(item)}>✓</button><span><b>{item.title}</b><small>{item.companyName} · {item.type}</small></span><span className="owner"><Avatar name={item.executiveName}/>{item.executiveName}</span><span className={late ? "late" : ""}>◷ {dateTime(item.dueAt)}</span><button className="link-button" onClick={() => onEdit(item)}>Reagendar</button></div>; }) : <Empty title="Nenhum follow-up neste filtro" text="Use Agendar follow-up ou mova um card para a coluna Follow-up."/>}</article></>;
}

function MeetingsView({ meetings, profiles, onResult, onReschedule }: { meetings: Meeting[]; profiles: Profile[]; onResult: (meeting: Meeting, connected: boolean) => void; onReschedule: (meeting: Meeting) => void }) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [from, setFrom] = useState(first); const [to, setTo] = useState(last); const [executive, setExecutive] = useState("all");
  const list = meetings.filter((item) => { const day = item.scheduledAt.slice(0, 10); return day >= from && day <= to && (executive === "all" || item.executiveId === executive); });
  const concluded = list.filter((item) => item.status === "Concluída");
  return <><div className="meeting-filters panel"><label>De<input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label><label>Até<input type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label><label>Executivo<select value={executive} onChange={(event) => setExecutive(event.target.value)}><option value="all">Todos</option>{profiles.filter((item) => item.role !== "client").map((item) => <option key={item.id} value={item.id}>{item.full_name || item.email}</option>)}</select></label></div><div className="mini-stats"><article><small>Agendadas no período</small><b>{list.length}</b></article><article><small>Conectaram</small><b>{concluded.filter((item) => item.connected).length}</b></article><article><small>Não conectaram</small><b>{concluded.filter((item) => item.connected === false).length}</b></article><article><small>Taxa de conexão</small><b>{concluded.length ? `${Math.round(concluded.filter((item) => item.connected).length / concluded.length * 100)}%` : "0%"}</b></article></div><article className="panel meeting-list">{list.length ? list.map((item) => <div key={item.id}><span className="date-badge"><b>{new Date(item.scheduledAt).getDate()}</b><small>{new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(item.scheduledAt))}</small></span><span><b>{item.companyName}</b><small>{dateTime(item.scheduledAt)}</small></span><span className="owner"><Avatar name={item.executiveName}/>{item.executiveName}</span><Pill status={item.connected === true ? "Conectou" : item.connected === false ? "Não conectou" : item.status}/><div className="row-actions">{item.status === "Agendada" && <><button className="success-button" onClick={() => onResult(item, true)}>Conectou</button><button className="danger-button" onClick={() => onResult(item, false)}>Não conectou</button></>}<button className="ghost-small" onClick={() => onReschedule(item)}>Reagendar</button></div></div>) : <Empty title="Nenhuma reunião no período" text="Altere os filtros ou agende uma nova reunião."/>}</article></>;
}

type PerformanceRow = { id: string; name: string; active: number; meetings: number; connected: number; won: number; revenue: number; conversion: number };
function getPerformance(profiles: Profile[], leads: Lead[], meetings: Meeting[]): PerformanceRow[] {
  return profiles.filter((profile) => profile.role !== "client" && profile.active).map((profile) => {
    const owned = leads.filter((lead) => lead.ownerId === profile.id); const won = owned.filter((lead) => lead.stage === "Ganho"); const lost = owned.filter((lead) => lead.stage === "Perdido"); const execMeetings = meetings.filter((meeting) => meeting.executiveId === profile.id);
    return { id: profile.id, name: profile.full_name || profile.email, active: owned.filter((lead) => !["Ganho", "Perdido"].includes(lead.stage)).length, meetings: execMeetings.length, connected: execMeetings.filter((meeting) => meeting.connected).length, won: won.length, revenue: won.reduce((sum, lead) => sum + lead.value, 0), conversion: won.length + lost.length ? won.length / (won.length + lost.length) * 100 : 0 };
  }).sort((a, b) => b.won - a.won || b.meetings - a.meetings);
}

function PerformancePanel({ rows, compact = false, showRevenue = true }: { rows: PerformanceRow[]; compact?: boolean; showRevenue?: boolean }) {
  const maxMeetings = Math.max(...rows.map((row) => row.meetings), 1); const maxWon = Math.max(...rows.map((row) => row.won), 1);
  return <article className={`panel performance ${compact ? "compact-performance" : ""}`}><PanelHead title="Desempenho dos executivos" subtitle="Agendamentos e contratos fechados"/>{rows.length ? rows.map((row, index) => <div className="performance-row" key={row.id}><span className="rank">{index + 1}</span><span className="owner"><Avatar name={row.name}/><b>{row.name}</b></span><span><small>Reuniões</small><b>{row.meetings}</b><i><em style={{ width: `${row.meetings / maxMeetings * 100}%` }}/></i></span><span><small>Contratos</small><b>{row.won}</b><i className="green-bar"><em style={{ width: `${row.won / maxWon * 100}%` }}/></i></span>{!compact && <>{showRevenue && <span><small>Faturamento</small><b>{money(row.revenue)}</b></span>}<span><small>Conversão</small><b>{row.conversion.toFixed(1)}%</b></span></>}</div>) : <Empty title="Cadastre executivos" text="O ranking aparece assim que a equipe começar a trabalhar os leads."/>}</article>;
}

function Proposals({ leads }: { leads: Lead[] }) { const sent = leads.filter((lead) => ["Proposta enviada", "Negociação", "Ganho"].includes(lead.stage)); return <><div className="stats compact">{[["Em elaboração", "0"], ["Enviadas", String(sent.length)], ["Aprovadas", String(leads.filter((lead) => lead.stage === "Ganho").length)], ["Aguardando retorno", String(leads.filter((lead) => lead.stage === "Proposta enviada").length)]].map((item, index) => <article key={item[0]}><i className={`stat s${index}`}>▤</i><span><small>{item[0]}</small><b>{item[1]}</b></span></article>)}</div><EmptyPanel title="Orçamentos conectados ao cadastro" text="Os serviços estão cadastrados e cada orçamento pode ficar vinculado à empresa."/></>; }
function Clients({ leads, canViewRevenue, onAdd, onOpen }: { leads: Lead[]; canViewRevenue: boolean; onAdd: () => void; onOpen: (lead: Lead) => void }) { if (!leads.length) return <EmptyPanel title="Nenhum cliente cadastrado ainda" text="Cadastre diretamente por esta aba ou mova um lead para Ganho." action="Cadastrar cliente" click={onAdd}/>; return <div className="cards">{leads.map((lead) => <article className="panel client-card" key={lead.id}><div><i>{lead.name[0]}</i><Pill status={lead.clientUserId ? "Acesso enviado" : "Sem acesso"}/></div><h2>{lead.name}</h2><p>{lead.service}</p>{canViewRevenue && <strong>{money(lead.value)}</strong>}<hr/><small>Executivo responsável</small><b className="owner"><Avatar name={lead.owner}/>{lead.owner}</b><small>{lead.email || lead.phone}</small><button onClick={() => onOpen(lead)}>Acessos, documentos e arquivos →</button></article>)}</div>; }

function ClientAccessForm({ lead, done }: { lead: Lead; done: (fullName: string, email: string) => Promise<void> }) {
  const [fullName, setFullName] = useState(lead.contact === "Contato não informado" ? "" : lead.contact);
  const [email, setEmail] = useState(lead.contactEmail || lead.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => { setBusy(true); setError(""); try { await done(fullName, email); } catch (submitError) { setError(errorMessage(submitError)); } finally { setBusy(false); } };
  return <><label className="tag">FECHAMENTO E BOAS-VINDAS</label><h2>Transformar {lead.name} em cliente</h2><p>Confirme quem receberá o acesso ao portal. O contrato será marcado como ganho e o convite será enviado por e-mail.</p><div className="invite-note"><i>✓</i><span><b>Primeiro acesso protegido</b><small>O cliente abrirá o link, criará a senha pessoal e entrará direto no próprio painel.</small></span></div><div className="form"><label>Nome do responsável<input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Nome completo"/></label><label>E-mail para acesso<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="cliente@empresa.com.br"/></label></div>{error && <div className="auth-error">{error}</div>}<button className="primary full" onClick={() => void submit()} disabled={busy || !fullName || !email}>{busy ? "Fechando e enviando..." : "Fechar contrato e enviar boas-vindas"}</button></>;
}

function ClientWorkspace({ lead, profile, profiles, onInvite }: { lead: Lead; profile: Profile; profiles: Profile[]; onInvite: (fullName: string, email: string) => Promise<void> }) {
  const [name, setName] = useState(lead.contact === "Contato não informado" ? "" : lead.contact);
  const [email, setEmail] = useState(lead.contactEmail || lead.email);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const executive = profiles.find((item) => item.id === lead.ownerId);
  const invite = async () => { setBusy(true); setNotice(""); try { await onInvite(name, email); setNotice("Convite enviado. O cliente receberá o link para criar a senha."); } catch (inviteError) { setNotice(errorMessage(inviteError)); } finally { setBusy(false); } };
  return <div className="client-workspace"><div className="lead-detail-head"><span className="lead-detail-logo">{lead.name[0]}</span><span><label className="tag">PAINEL DO CLIENTE</label><h2>{lead.name}</h2><p>{lead.cnpj || "CNPJ não informado"} · responsável: {executive?.full_name || lead.owner}</p></span><Pill status={lead.clientUserId ? "Acesso enviado" : "Aguardando acesso"}/></div><section className="access-invite panel"><span><b>{lead.clientUserId ? "Reenviar acesso ao portal" : "Liberar acesso ao portal"}</b><small>O link temporário abre o cadastro da senha pessoal.</small></span><div className="form"><label>Responsável<input value={name} onChange={(event) => setName(event.target.value)}/></label><label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)}/></label></div><button className="primary" disabled={busy || !name || !email} onClick={() => void invite()}>{busy ? "Enviando..." : lead.clientUserId ? "Reenviar convite" : "Enviar convite"}</button>{notice && <small className="workspace-notice">{notice}</small>}</section><DocumentsPanel companyId={lead.id} canUpload={profile.role === "super_admin" || lead.ownerId === profile.id}/></div>;
}

function DocumentsPanel({ companyId, canUpload }: { companyId: string; canUpload: boolean }) {
  const [documents, setDocuments] = useState<CrmDocument[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState("Contrato");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => { const { data, error: loadError } = await supabase.from("documents").select("id,company_id,type,file_name,storage_path,mime_type,size_bytes,created_at").eq("company_id", companyId).order("created_at", { ascending: false }); if (loadError) setError(loadError.message); else setDocuments((data ?? []) as CrmDocument[]); }, [companyId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const open = async (document: CrmDocument) => { const { data, error: signedError } = await supabase.storage.from("contracts").createSignedUrl(document.storage_path, 120); if (signedError) setError(signedError.message); else window.open(data.signedUrl, "_blank", "noopener,noreferrer"); };
  const upload = async () => {
    if (!file) return; setBusy(true); setError("");
    const safeName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-");
    const storagePath = `${companyId}/${crypto.randomUUID()}-${safeName}`;
    try {
      const { error: uploadError } = await supabase.storage.from("contracts").upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: rowError } = await supabase.from("documents").insert({ company_id: companyId, type, file_name: file.name, storage_path: storagePath, mime_type: file.type || null, size_bytes: file.size, uploaded_by: (await supabase.auth.getUser()).data.user?.id });
      if (rowError) { await supabase.storage.from("contracts").remove([storagePath]); throw rowError; }
      setFile(null); await load();
    } catch (uploadFailure) { setError(errorMessage(uploadFailure)); }
    finally { setBusy(false); }
  };
  return <section className="documents-panel panel"><div className="workspace-head"><span><b>Contratos, documentos e arquivos</b><small>Arquivos privados, disponíveis apenas para a equipe autorizada e este cliente.</small></span><Pill status={`${documents.length} arquivo${documents.length === 1 ? "" : "s"}`}/></div>{canUpload && <div className="document-upload"><label>Tipo<select value={type} onChange={(event) => setType(event.target.value)}><option>Contrato</option><option>Proposta</option><option>Briefing</option><option>Outro</option></select></label><label className="file-picker">{file?.name ?? "Selecionar arquivo"}<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)}/></label><button className="primary" disabled={!file || busy} onClick={() => void upload()}>{busy ? "Enviando..." : "Anexar ao cliente"}</button></div>}{error && <div className="auth-error">{error}</div>}<div className="document-list">{documents.length ? documents.map((document) => <button key={document.id} onClick={() => void open(document)}><i>{document.type === "Contrato" ? "▤" : "◇"}</i><span><b>{document.file_name}</b><small>{document.type} · {new Intl.DateTimeFormat("pt-BR").format(new Date(document.created_at))}</small></span><em>Abrir ↗</em></button>) : <Empty title="Nenhum arquivo anexado" text={canUpload ? "Selecione um contrato ou documento para liberar no portal." : "Os arquivos enviados pela I5Media aparecerão aqui."}/>}</div></section>;
}

function TicketCenter({ profile, leads }: { profile: Profile; leads: Lead[] }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [subject, setSubject] = useState(""); const [description, setDescription] = useState(""); const [priority, setPriority] = useState("Média"); const [companyId, setCompanyId] = useState(leads[0]?.id ?? ""); const [reply, setReply] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const isStaff = profile.role !== "client";
  const loadTickets = useCallback(async () => { const { data, error: loadError } = await supabase.from("tickets").select("id,company_id,subject,description,priority,status,assigned_to,opened_by,created_at,companies(name)").order("created_at", { ascending: false }); if (loadError) setError(loadError.message); else { const next = (data ?? []) as unknown as Ticket[]; setTickets(next); setSelectedId((current) => current || next[0]?.id || ""); } }, []);
  const loadMessages = useCallback(async () => { if (!selectedId) { setMessages([]); return; } const { data } = await supabase.from("ticket_messages").select("id,ticket_id,sender_id,body,created_at").eq("ticket_id", selectedId).order("created_at"); setMessages((data ?? []) as TicketMessage[]); }, [selectedId]);
  useEffect(() => { const timer = window.setTimeout(() => void loadTickets(), 0); return () => window.clearTimeout(timer); }, [loadTickets]);
  useEffect(() => { const timer = window.setTimeout(() => void loadMessages(), 0); return () => window.clearTimeout(timer); }, [loadMessages]);
  const createTicket = async () => { if (!companyId || !subject || !description) return; setBusy(true); setError(""); const lead = leads.find((item) => item.id === companyId); const { data, error: createError } = await supabase.from("tickets").insert({ company_id: companyId, subject, description, priority, assigned_to: lead?.ownerId ?? null, opened_by: profile.id }).select("id").single(); if (createError) setError(createError.message); else { setSubject(""); setDescription(""); await loadTickets(); if (data) setSelectedId(data.id); } setBusy(false); };
  const sendReply = async () => { const body = reply.trim(); if (!body || !selectedId) return; const { error: sendError } = await supabase.from("ticket_messages").insert({ ticket_id: selectedId, sender_id: profile.id, body }); if (sendError) setError(sendError.message); else { setReply(""); await loadMessages(); } };
  const updateStatus = async (status: string) => { if (!selectedId) return; const { error: statusError } = await supabase.from("tickets").update({ status, closed_at: status === "Concluído" ? new Date().toISOString() : null }).eq("id", selectedId); if (statusError) setError(statusError.message); else await loadTickets(); };
  const selected = tickets.find((item) => item.id === selectedId);
  if (!leads.length) return <EmptyPanel title="Nenhum cliente disponível" text="Os chamados serão liberados depois que uma oportunidade for convertida em cliente."/>;
  return <div className="ticket-center"><aside className="panel ticket-sidebar"><div className="workspace-head"><span><b>Chamados</b><small>{tickets.length} solicitação{tickets.length === 1 ? "" : "ões"}</small></span></div>{tickets.map((ticket) => <button className={selectedId === ticket.id ? "selected" : ""} key={ticket.id} onClick={() => setSelectedId(ticket.id)}><span><b>{ticket.subject}</b><small>{ticket.companies?.name ?? "Cliente"}</small></span><Pill status={ticket.status}/></button>)}</aside><main className="ticket-main"><section className="panel new-ticket"><label className="tag">NOVO CHAMADO</label><div className="form form-3"><label>Cliente<select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name}</option>)}</select></label><label>Assunto<input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Como podemos ajudar?"/></label><label>Prioridade<select value={priority} onChange={(event) => setPriority(event.target.value)}><option>Baixa</option><option>Média</option><option>Alta</option><option>Urgente</option></select></label></div><label>Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descreva a solicitação"/></label><button className="primary" disabled={busy || !companyId || !subject || !description} onClick={() => void createTicket()}>{busy ? "Abrindo..." : "Abrir chamado"}</button></section>{selected ? <section className="panel ticket-thread"><header><span><b>{selected.subject}</b><small>{selected.companies?.name ?? "Cliente"} · {dateTime(selected.created_at)}</small></span><Pill status={selected.status}/>{isStaff && <select value={selected.status} onChange={(event) => void updateStatus(event.target.value)}><option>Aberto</option><option>Em andamento</option><option>Aguardando cliente</option><option>Concluído</option><option>Cancelado</option></select>}</header><div className="ticket-description">{selected.description}</div><main>{messages.map((message) => <div className={message.sender_id === profile.id ? "mine" : ""} key={message.id}><span><b>{message.sender_id === profile.id ? "Você" : "Equipe / cliente"}</b>{message.body}</span><small>{dateTime(message.created_at)}</small></div>)}</main><footer><input value={reply} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void sendReply(); }} placeholder="Responder ao chamado..."/><button onClick={() => void sendReply()}>Enviar</button></footer></section> : <EmptyPanel title="Selecione um chamado" text="O histórico e as respostas aparecerão aqui."/>}{error && <div className="auth-error">{error}</div>}</main></div>;
}
function Team({ profiles, leads, meetings, onAdd, onEdit }: { profiles: Profile[]; leads: Lead[]; meetings: Meeting[]; onAdd: () => void; onEdit: (profile: Profile) => void }) {
  const executives = profiles.filter((item) => item.role === "executive");
  return <><div className="section-actions"><button className="primary" onClick={onAdd}>＋ Cadastrar executivo</button></div>{executives.length > 0 && <div className="agent-access-grid">{executives.map((executive) => <article className="panel agent-access-card" key={executive.id}><div><Avatar name={executive.full_name || executive.email}/><span><b>{executive.full_name || executive.email}</b><small>{executive.email}</small></span><Pill status={executive.active ? "Ativo" : "Inativo"}/></div><p>{executive.menu_permissions.length} módulos liberados</p><div className="permission-tags">{executive.menu_permissions.map((item) => <span key={item}>{item}</span>)}</div><b className={executive.can_view_revenue ? "financial-yes" : "financial-no"}>{executive.can_view_revenue ? "✓ Visualiza valores e faturamento" : "⊘ Valores financeiros ocultos"}</b><button className="ghost" onClick={() => onEdit(executive)}>Editar acessos</button></article>)}</div>}<PerformancePanel rows={getPerformance(profiles, leads, meetings)}/></>;
}

function WhatsAppFoundation({ profile, go }: { profile: Profile; go: (page: string) => void }) {
  return <div className="whatsapp-foundation"><div className="wa-foundation-hero panel"><div className="wa-mark">◉</div><span><label className="tag">MÓDULO EM ATIVAÇÃO</label><h2>WhatsApp Multiatendimento</h2><p>A base segura para receber eventos da DROPE, organizar filas e vincular cada conversa aos leads do CRM já está sendo configurada.</p></span>{profile.role === "super_admin" && <button className="primary" onClick={() => go("Configurações")}>Configurar DROPE</button>}</div><div className="wa-phase-grid"><article className="panel done"><i>✓</i><b>Arquitetura preservada</b><small>Perfis, empresas, contatos e funil continuam sendo a fonte oficial.</small></article><article className="panel done"><i>✓</i><b>Estrutura isolada</b><small>Conversas externas não utilizam o chat interno da equipe.</small></article><article className="panel active"><i>3</i><b>Conexão real</b><small>O próximo marco é receber o primeiro webhook verdadeiro da DROPE.</small></article></div><article className="panel wa-no-mock"><b>Nenhuma conversa fictícia será criada</b><p>A caixa de atendimento será liberada depois que uma mensagem real percorrer WhatsApp → DROPE → Supabase, conforme a regra do projeto.</p></article></div>;
}

function WhatsAppSettings() {
  const [connection, setConnection] = useState<WhatsAppConnectionConfig | null>(null);
  const [events, setEvents] = useState<WhatsAppWebhookEvent[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [devices, setDevices] = useState<string[]>([]);
  const [deviceName, setDeviceName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const invoke = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    const { data, error: invokeError } = await supabase.functions.invoke("whatsapp-admin", { body: { action, ...payload } });
    if (invokeError) throw invokeError;
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const load = useCallback(async () => {
    setBusy("load"); setError("");
    try {
      const data = await invoke("get_config");
      setConnection(data.connection ?? null);
      setEvents(data.recent_events ?? []);
      if (data.connection?.device_name) setDeviceName(data.connection.device_name);
    } catch (loadError) { setError(errorMessage(loadError)); }
    finally { setBusy(""); }
  }, [invoke]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const run = async (action: string, payload: Record<string, unknown>, success: string) => {
    setBusy(action); setError(""); setNotice("");
    try {
      const data = await invoke(action, payload);
      if (data.devices) {
        const next = (data.devices as { name: string }[]).map((item) => item.name);
        setDevices(next);
        if (!deviceName && next[0]) setDeviceName(next[0]);
      }
      if (data.webhook_url) setWebhookUrl(data.webhook_url);
      setNotice(success);
      if (action !== "rotate_webhook_secret") await load();
    } catch (runError) { setError(errorMessage(runError)); }
    finally { setBusy(""); }
  };

  const status = connection?.status ?? "not_configured";
  const statusText: Record<string, string> = { not_configured: "Não configurado", configured: "Chave configurada", connected: "Conectado", disconnected: "Desconectado", error: "Erro de conexão" };

  return <div className="wa-settings"><aside className="panel wa-settings-nav"><b>WHATSAPP</b>{["Integração", "Agentes", "Setores e filas", "Triagem", "Distribuição", "Inteligência Artificial"].map((item, index) => <button className={index === 0 ? "selected" : ""} disabled={index !== 0} key={item}><span>{["⌁", "♙", "▦", "◇", "↻", "✦"][index]}</span>{item}{index !== 0 && <small>Próxima fase</small>}</button>)}</aside><main className="wa-settings-main"><article className="panel wa-integration-card"><div className="wa-integration-head"><span><label className="tag">PROVEDOR</label><h2>DROPE WhatsApp API</h2><p>A chave é enviada somente ao backend e armazenada criptografada no Supabase Vault.</p></span><b className={`wa-status ${status}`}><i/>{statusText[status]}</b></div><div className="wa-secret-field"><label>Chave API DROPE<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={connection?.masked_identifier ?? "Cole a chave da sua conta DROPE"} autoComplete="off"/></label><button className="primary" disabled={apiKey.trim().length < 12 || Boolean(busy)} onClick={() => void run("save_api_key", { api_key: apiKey }, "Chave salva com segurança")}>{busy === "save_api_key" ? "Salvando..." : connection?.masked_identifier ? "Trocar chave" : "Salvar chave"}</button></div>{connection?.masked_identifier && <small className="wa-masked">Chave armazenada: {connection.masked_identifier}</small>}<div className="wa-integration-actions"><button className="ghost" disabled={!connection?.masked_identifier || Boolean(busy)} onClick={() => void run("test_connection", {}, "Conexão com a DROPE validada")}>{busy === "test_connection" ? "Testando..." : "Testar conexão"}</button><button className="ghost" disabled={!connection?.masked_identifier || Boolean(busy)} onClick={() => void run("rotate_webhook_secret", {}, "Novo endereço seguro de webhook gerado")}>Gerar webhook seguro</button></div>{devices.length > 0 && <div className="wa-device-picker"><label>Dispositivo WhatsApp<select value={deviceName} onChange={(event) => setDeviceName(event.target.value)}>{devices.map((item) => <option key={item}>{item}</option>)}</select></label><button className="primary" disabled={!deviceName || Boolean(busy)} onClick={() => void run("select_device", { device_name: deviceName }, "Dispositivo vinculado ao CRM")}>{busy === "select_device" ? "Vinculando..." : "Vincular dispositivo"}</button></div>}{webhookUrl && <div className="wa-webhook-once"><b>Copie este webhook agora</b><p>Por segurança, o endereço completo é exibido somente nesta geração.</p><code>{webhookUrl}</code><button className="ghost-small" onClick={() => void navigator.clipboard.writeText(webhookUrl)}>Copiar endereço</button></div>}{error && <div className="auth-error">{error}</div>}{notice && <div className="auth-success">✓ {notice}</div>}</article><div className="wa-security-grid"><article className="panel"><i>▣</i><span><b>Credencial protegida</b><small>Nunca é gravada no frontend, código ou GitHub.</small></span></article><article className="panel"><i>⌁</i><span><b>Dispositivo</b><small>{connection?.device_name ?? "Ainda não selecionado"}</small></span></article><article className="panel"><i>◈</i><span><b>Webhook</b><small>{connection?.webhook_ready ? "Token de entrada gerado" : "Aguardando geração"}</small></span></article></div><article className="panel wa-events"><PanelHead title="Eventos reais recebidos" subtitle="Diagnóstico do webhook DROPE"/>{busy === "load" ? <p>Carregando...</p> : events.length ? events.map((item) => <div key={item.id}><span><b>{item.event_type}</b><small>{dateTime(item.received_at)}</small></span><Pill status={item.error ? "Erro" : item.processed ? "Processado" : "Recebido"}/></div>) : <Empty title="Nenhum evento recebido" text="Depois de configurar o webhook na DROPE, envie uma mensagem real para validar esta etapa."/>}</article></main></div>;
}

function Chat({ profile, profiles, leads, clientMode = false }: { profile: Profile; profiles: Profile[]; leads: Lead[]; clientMode?: boolean }) {
  type ChatMessage = { id: string; body: string; sender_id: string; recipient_id: string | null; company_id: string | null; created_at: string };
  const contacts = useMemo(() => profiles.filter((item) => {
    if (!item.active || item.id === profile.id) return false;
    if (profile.role === "client") return leads.some((lead) => lead.clientUserId === profile.id && lead.ownerId === item.id);
    if (item.role !== "client") return true;
    return profile.role === "super_admin" || leads.some((lead) => lead.clientUserId === item.id && lead.ownerId === profile.id);
  }), [profiles, leads, profile.id, profile.role]);
  const [target, setTarget] = useState(profile.role === "client" ? contacts[0]?.id ?? "" : "general");
  const [messages, setMessages] = useState<ChatMessage[]>([]); const [value, setValue] = useState(""); const [error, setError] = useState("");
  const loadMessages = useCallback(async () => {
    if (!target) { setMessages([]); return; }
    let query = supabase.from("team_messages").select("id,body,sender_id,recipient_id,company_id,created_at").order("created_at").limit(150);
    query = target === "general"
      ? query.eq("channel", "geral").eq("is_private", false)
      : query.eq("is_private", true).or(`and(sender_id.eq.${profile.id},recipient_id.eq.${target}),and(sender_id.eq.${target},recipient_id.eq.${profile.id})`);
    const { data, error: loadError } = await query;
    if (loadError) setError(loadError.message); else setMessages((data ?? []) as ChatMessage[]);
  }, [profile.id, target]);
  useEffect(() => { const timer = window.setTimeout(() => void loadMessages(), 0); const channel = supabase.channel(`team-chat-${profile.id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "team_messages" }, () => void loadMessages()).subscribe(); return () => { window.clearTimeout(timer); void supabase.removeChannel(channel); }; }, [loadMessages, profile.id]);
  const send = async () => {
    const body = value.trim(); if (!body || !target) return; setError("");
    const targetProfile = profiles.find((item) => item.id === target);
    const relatedCompany = targetProfile?.role === "client" ? leads.find((lead) => lead.clientUserId === targetProfile.id) : profile.role === "client" ? leads.find((lead) => lead.clientUserId === profile.id) : null;
    const { error: sendError } = target === "general"
      ? await supabase.from("team_messages").insert({ sender_id: profile.id, channel: "geral", body, is_private: false })
      : await supabase.from("team_messages").insert({ sender_id: profile.id, recipient_id: target, company_id: relatedCompany?.id ?? null, channel: "direct", body, is_private: true });
    if (sendError) setError(sendError.message); else { setValue(""); await loadMessages(); }
  };
  const names = new Map(profiles.map((item) => [item.id, item.full_name || item.email]));
  const selectedProfile = profiles.find((item) => item.id === target);
  return <div className={`chat ${clientMode ? "client-chat" : ""}`}><aside className="panel">{profile.role !== "client" && <><h3>CANAIS</h3><button className={target === "general" ? "selected" : ""} onClick={() => setTarget("general")}># Geral <b>Equipe</b></button></>}<h3>{profile.role === "client" ? "ATENDIMENTO" : "MENSAGENS DIRETAS"}</h3>{contacts.map((contact) => <button className={target === contact.id ? "selected" : ""} onClick={() => setTarget(contact.id)} key={contact.id}><Avatar name={contact.full_name || contact.email}/><span>{contact.full_name || contact.email}<small>{contact.role === "client" ? "Cliente" : roleName(contact.role)}</small></span></button>)}{!contacts.length && <small>{profile.role === "client" ? "Seu executivo aparecerá aqui." : "Novos executivos e clientes aparecem automaticamente após o cadastro."}</small>}</aside><article className="panel"><header><b>{target === "general" ? "# Geral" : selectedProfile?.full_name || selectedProfile?.email || "Conversa"}</b><small>{target === "general" ? "Canal interno da equipe" : "Conversa privada e protegida"}</small></header><main>{messages.length ? messages.map((message) => { const senderName = message.sender_id === profile.id ? "Você" : names.get(message.sender_id) ?? "Usuário"; return <div className={message.sender_id === profile.id ? "mine" : ""} key={message.id}><Avatar name={senderName}/><p><b>{senderName}</b>{message.body}</p></div>; }) : <div className="empty-chat">{target ? "Envie a primeira mensagem desta conversa." : "Aguardando o executivo responsável."}</div>}</main>{target && <footer><input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void send(); }} placeholder="Escreva uma mensagem..."/><button onClick={() => void send()}>➤</button></footer>}{error && <div className="chat-error">{error}</div>}</article></div>;
}

function ClientPortal({ profile, leads, profiles, theme, toggleTheme }: { profile: Profile; leads: Lead[]; profiles: Profile[]; theme: "light" | "dark"; toggleTheme: () => void }) {
  const [tab, setTab] = useState("resumo");
  const company = leads[0];
  const themeButton = <button className="theme-toggle" onClick={toggleTheme} aria-label={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"}><i>{theme === "light" ? "☾" : "☀"}</i><span>{theme === "light" ? "Escuro" : "Claro"}</span></button>;
  if (!company) return <main className={`client-portal theme-${theme}`}><header><div className="brand"><b>i5</b><span><strong>I5MEDIA</strong><small>Portal do cliente</small></span></div>{themeButton}<button className="logout" onClick={() => supabase.auth.signOut()}>Sair</button></header><section><EmptyPanel title="Acesso ainda não vinculado" text="Fale com a I5Media para vincular este login à sua empresa."/></section></main>;
  return <main className={`client-portal theme-${theme}`}><header><div className="brand"><b>i5</b><span><strong>I5MEDIA</strong><small>Portal do cliente</small></span></div><div className="user"><Avatar name={profile.full_name || profile.email}/><span><b>{profile.full_name || profile.email}</b><small>Cliente</small></span></div>{themeButton}<button className="logout" onClick={() => supabase.auth.signOut()}>Sair</button></header><section><label className="tag">ÁREA DO CLIENTE</label><h1>{company.name}</h1><p>Acompanhe contrato, arquivos, chamados e conversas com seu executivo em um ambiente seguro.</p><nav className="client-tabs">{[["resumo", "Visão geral"], ["documentos", "Documentos"], ["chamados", "Chamados"], ["conversa", "Conversa"]].map(([id, label]) => <button className={tab === id ? "selected" : ""} onClick={() => setTab(id)} key={id}>{label}</button>)}</nav>{tab === "resumo" && <div className="client-grid"><article className="panel"><i>▤</i><h2>Contrato e documentos</h2><p>Consulte PDFs, propostas e arquivos compartilhados pela equipe.</p><button onClick={() => setTab("documentos")}>Acessar documentos</button></article><article className="panel"><i>◈</i><h2>Abrir chamado</h2><p>Solicite suporte e acompanhe todas as respostas.</p><button onClick={() => setTab("chamados")}>Novo chamado</button></article><article className="panel"><i>♙</i><h2>Seu executivo</h2><p>{company.owner || "A equipe I5Media"}</p><button onClick={() => setTab("conversa")}>Iniciar conversa</button></article></div>}{tab === "documentos" && <DocumentsPanel companyId={company.id} canUpload={false}/>} {tab === "chamados" && <TicketCenter profile={profile} leads={[company]}/>} {tab === "conversa" && <Chat profile={profile} profiles={profiles} leads={[company]} clientMode/>}</section></main>;
}

function Modal({ children, close }: { children: ReactNode; close: () => void }) { return <div className="back" onMouseDown={close}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><button className="x" onClick={close}>×</button>{children}</div></div>; }

function LeadDetails({ lead, canViewRevenue, onFollowup, onMeeting }: { lead: Lead; canViewRevenue: boolean; onFollowup: () => void; onMeeting: () => void }) {
  const wa = whatsappHref(lead);
  return <><div className="lead-detail-head"><span className="lead-detail-logo">{lead.name[0]}</span><span><label className="tag">FICHA DO CONTATO</label><h2>{lead.name}</h2><p>{lead.legalName || "Razão social não informada"}</p></span><Pill status={lead.isActivated ? lead.stage : "Não contatado"}/></div><div className="lead-detail-grid"><article><small>CNPJ</small><b>{lead.cnpj || "Não informado"}</b></article><article><small>Localização</small><b>{lead.address || "Não informada"}</b></article><article><small>E-mail da empresa</small><b>{lead.email || "Não informado"}</b></article><article><small>Telefone da empresa</small><b>{lead.phone || "Não informado"}</b></article><article><small>Contato principal</small><b>{lead.contact || "Não informado"}</b></article><article><small>Telefone do contato</small><b>{lead.contactPhone || "Não informado"}</b></article><article><small>E-mail do contato</small><b>{lead.contactEmail || "Não informado"}</b></article><article><small>Serviço de interesse</small><b>{lead.service}</b></article><article><small>Origem</small><b>{lead.source}</b></article><article><small>Executivo responsável</small><b>{lead.owner}</b></article><article><small>Próxima ação</small><b>{lead.next}</b></article>{canViewRevenue && <article><small>Valor estimado</small><b>{money(lead.value)}</b></article>}</div><div className="lead-detail-actions">{wa ? <a className="whatsapp-primary" href={wa} target="_blank" rel="noreferrer">Conversar no WhatsApp ↗</a> : <span className="whatsapp-disabled">Cadastre um telefone para abrir o WhatsApp</span>}{lead.isActivated && <><button className="ghost" onClick={onFollowup}>Agendar follow-up</button><button className="ghost" onClick={onMeeting}>Agendar reunião</button></>}</div></>;
}

function ActivateLeadForm({ lead, profiles, currentUserId, done }: { lead: Lead; profiles: Profile[]; currentUserId: string; done: (input: ActivationInput) => Promise<void> }) {
  const [form, setForm] = useState<ActivationInput>({ stage: "Primeiro contato", executiveId: lead.ownerId ?? profiles[0]?.id ?? currentUserId, scheduledAt: toInputDate() });
  const [busy, setBusy] = useState(false);
  const requiresSchedule = ["Follow-up", "Reunião marcada"].includes(form.stage);
  const submit = async () => { setBusy(true); try { await done(form); } finally { setBusy(false); } };
  return <><label className="tag">PRIMEIRO CONTATO REALIZADO</label><h2>Ativar {lead.name} no Kanban</h2><p>Escolha em qual etapa este lead deve entrar. Depois de ativado, ele aparecerá somente no funil do executivo responsável e na visão geral do Super Admin.</p><div className="activation-company"><Avatar name={lead.name}/><span><b>{lead.contact}</b><small>{lead.contactPhone || lead.phone || "Telefone não informado"} · {lead.email || lead.contactEmail || "E-mail não informado"}</small></span></div><div className="form"><label>Etapa inicial<select value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value })}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></label><label>Executivo responsável<select value={form.executiveId} onChange={(event) => setForm({ ...form, executiveId: event.target.value })}>{profiles.map((item) => <option value={item.id} key={item.id}>{item.full_name || item.email}</option>)}</select></label>{requiresSchedule && <label>{form.stage === "Reunião marcada" ? "Data e hora da reunião" : "Data e hora do follow-up"}<input type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })}/></label>}</div>{requiresSchedule && <small className="form-hint">O agendamento será criado automaticamente junto com a ativação.</small>}<button className="primary full" disabled={busy || !form.stage || !form.executiveId || (requiresSchedule && !form.scheduledAt)} onClick={() => void submit()}>{busy ? "Ativando..." : "Ativar lead no Kanban"}</button></>;
}

function Empty({ title, text }: { title: string; text: string }) { return <div className="empty"><b>{title}</b><p>{text}</p></div>; }
function EmptyPanel({ title, text, action, click }: { title: string; text: string; action?: string; click?: () => void }) { return <article className="panel empty-state"><b>{title}</b><p>{text}</p>{action && <button className="primary" onClick={click}>{action}</button>}</article>; }

function CompanyForm({ services, profiles, currentUserId, canViewRevenue, initialStage, done }: { services: Service[]; profiles: Profile[]; currentUserId: string; canViewRevenue: boolean; initialStage: string; done: (input: NewCompanyInput) => Promise<void> }) {
  const [form, setForm] = useState<NewCompanyInput>({ name: "", legalName: "", cnpj: "", email: "", phone: "", address: "", contact: "", contactEmail: "", contactPhone: "", serviceId: services[0]?.id ?? "", ownerId: profiles[0]?.id ?? currentUserId, value: 0, source: "Manual", stage: initialStage });
  const [valueText, setValueText] = useState("");
  const [busy, setBusy] = useState(false);
  const field = (key: keyof NewCompanyInput, value: string | number) => setForm((current) => ({ ...current, [key]: value }));
  const requiresClientEmail = form.stage === "Ganho";
  const submit = async () => { if (!form.name || !form.contact || (requiresClientEmail && !(form.contactEmail || form.email))) return; setBusy(true); try { await done(form); } finally { setBusy(false); } };
  return <><label className="tag">{initialStage === "Ganho" ? "NOVO CLIENTE" : "NOVO LEAD"}</label><h2>{initialStage === "Ganho" ? "Cadastrar cliente" : "Cadastrar lead"}</h2><p>Dados completos da empresa, contato e oportunidade.</p><div className="form form-3"><label>Nome da empresa *<input value={form.name} onChange={(event) => field("name", event.target.value)} placeholder="Nome fantasia"/></label><label>Razão social<input value={form.legalName} onChange={(event) => field("legalName", event.target.value)} placeholder="Razão social"/></label><label>CNPJ<input value={form.cnpj} onChange={(event) => field("cnpj", event.target.value)} placeholder="00.000.000/0001-00"/></label><label>E-mail da empresa{requiresClientEmail ? " *" : ""}<input type="email" value={form.email} onChange={(event) => field("email", event.target.value)} placeholder="contato@empresa.com.br"/></label><label>Telefone da empresa<input value={form.phone} onChange={(event) => field("phone", event.target.value)} placeholder="(11) 99999-9999"/></label><label>Localização<input value={form.address} onChange={(event) => field("address", event.target.value)} placeholder="Cidade/UF ou endereço"/></label><label>Contato principal *<input value={form.contact} onChange={(event) => field("contact", event.target.value)} placeholder="Nome completo"/></label><label>E-mail do contato{requiresClientEmail ? " *" : ""}<input type="email" value={form.contactEmail} onChange={(event) => field("contactEmail", event.target.value)}/></label><label>Telefone do contato<input value={form.contactPhone} onChange={(event) => field("contactPhone", event.target.value)}/></label><label>Executivo<select value={form.ownerId} onChange={(event) => field("ownerId", event.target.value)}>{profiles.map((item) => <option value={item.id} key={item.id}>{item.full_name || item.email}</option>)}</select></label><label>Serviço<select value={form.serviceId} onChange={(event) => field("serviceId", event.target.value)}>{services.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select></label>{canViewRevenue && <label>Valor estimado<input type="text" inputMode="decimal" value={valueText} onFocus={(event) => event.currentTarget.select()} onChange={(event) => { setValueText(event.target.value); field("value", parseMoneyInput(event.target.value)); }} onBlur={() => setValueText(moneyInput(form.value))} placeholder="Digite, por exemplo: 4500"/><small className="input-help">Digite o valor normalmente; o sistema formata em reais.</small></label>}<label>Origem<select value={form.source} onChange={(event) => field("source", event.target.value)}><option>Manual</option><option>Indicação</option><option>Site</option><option>Instagram</option><option>Google</option><option>Prospecção</option></select></label><label>Etapa<select value={form.stage} onChange={(event) => field("stage", event.target.value)}>{directRegistrationStages.map((stage) => <option key={stage}>{stage}</option>)}</select></label></div><small className="form-hint">Follow-up e Reunião marcada são definidos no Kanban para exigir responsável e data.{requiresClientEmail ? " Ao salvar, o cliente receberá o convite de acesso por e-mail." : ""}</small><button className="primary full" disabled={busy || !form.name || !form.contact || (requiresClientEmail && !(form.contactEmail || form.email))} onClick={() => void submit()}>{busy ? "Salvando..." : initialStage === "Ganho" ? "Cadastrar cliente e enviar acesso" : "Cadastrar lead"}</button></>;
}

function FollowupForm({ leads, profiles, lead, existing, currentUserId, done }: { leads: Lead[]; profiles: Profile[]; lead: Lead | null; existing: Followup | null; currentUserId: string; done: (input: FollowupInput) => Promise<void> }) {
  const [form, setForm] = useState<FollowupInput>({ id: existing?.id, companyId: existing?.companyId ?? lead?.id ?? leads[0]?.id ?? "", assignedTo: existing?.assignedTo ?? lead?.ownerId ?? profiles[0]?.id ?? currentUserId, type: existing?.type ?? "Follow-up", title: existing?.title ?? "Retorno comercial", notes: existing?.notes ?? "", dueAt: toInputDate(existing?.dueAt) }); const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); try { await done(form); } finally { setBusy(false); } };
  return <><label className="tag">AGENDA COMERCIAL</label><h2>{existing ? "Reagendar follow-up" : "Agendar follow-up"}</h2><p>Defina a próxima ação, responsável e data.</p><div className="form"><label>Empresa<select value={form.companyId} onChange={(event) => setForm({ ...form, companyId: event.target.value })}>{leads.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Executivo<select value={form.assignedTo} onChange={(event) => setForm({ ...form, assignedTo: event.target.value })}>{profiles.map((item) => <option value={item.id} key={item.id}>{item.full_name || item.email}</option>)}</select></label><label>Tipo<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option>Follow-up</option><option>Ligação</option><option>WhatsApp</option><option>E-mail</option><option>Tarefa</option></select></label><label>Data e hora<input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })}/></label></div><label>Título<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })}/></label><label>Observações<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })}/></label><button className="primary full" disabled={busy || !form.companyId || !form.dueAt} onClick={() => void submit()}>{busy ? "Salvando..." : existing ? "Salvar reagendamento" : "Agendar follow-up"}</button></>;
}

function MeetingForm({ leads, profiles, lead, existing, currentUserId, done }: { leads: Lead[]; profiles: Profile[]; lead: Lead | null; existing: Meeting | null; currentUserId: string; done: (input: MeetingInput) => Promise<void> }) {
  const [form, setForm] = useState<MeetingInput>({ companyId: existing?.companyId ?? lead?.id ?? leads[0]?.id ?? "", executiveId: existing?.executiveId ?? lead?.ownerId ?? profiles[0]?.id ?? currentUserId, scheduledAt: toInputDate(existing?.scheduledAt), notes: existing?.notes ?? "", rescheduledFrom: existing?.id }); const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); try { await done(form); } finally { setBusy(false); } };
  return <><label className="tag">REUNIÃO COMERCIAL</label><h2>{existing ? "Reagendar reunião" : "Agendar reunião"}</h2><p>Ao salvar, o lead será movido para Reunião marcada.</p><div className="form"><label>Empresa<select value={form.companyId} onChange={(event) => setForm({ ...form, companyId: event.target.value })}>{leads.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Executivo que participará<select value={form.executiveId} onChange={(event) => setForm({ ...form, executiveId: event.target.value })}>{profiles.map((item) => <option value={item.id} key={item.id}>{item.full_name || item.email}</option>)}</select></label><label>Data e hora<input type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })}/></label></div><label>Observações<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Link, pauta ou observações da reunião"/></label><button className="primary full" disabled={busy || !form.companyId || !form.scheduledAt} onClick={() => void submit()}>{busy ? "Salvando..." : existing ? "Confirmar reagendamento" : "Agendar reunião"}</button></>;
}

function ImportModal({ onImport, onDone }: { onImport: (records: ImportRecord[], mode: "manual" | "automatic") => Promise<{ imported: number; duplicates: number }>; onDone: (message: string) => void }) {
  const [file, setFile] = useState<File | null>(null); const [mode, setMode] = useState<"manual" | "automatic">("manual"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const process = async () => {
    if (!file) return; setBusy(true); setError("");
    try {
      const rows = await readSheet(file, "Modelo de Leads"); const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell ?? "").replace("*", "").trim() === "empresa_nome"));
      if (headerIndex < 0) throw new Error("Cabeçalho empresa_nome não encontrado. Use o modelo oficial.");
      const headers = rows[headerIndex].map((cell) => String(cell ?? "").replace("*", "").trim());
      const records = rows.slice(headerIndex + 1).filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== "")).map((row) => Object.fromEntries(headers.map((header, index) => [header, typeof row[index] === "number" ? row[index] as number : String(row[index] ?? "").trim()])) as ImportRecord);
      const result = await onImport(records, mode); onDone(`${result.imported} leads importados e aguardando ativação; ${result.duplicates} duplicados ignorados`);
    } catch (processError) { setError(errorMessage(processError)); } finally { setBusy(false); }
  };
  return <><label className="tag">IMPORTAÇÃO INTELIGENTE</label><h2>Carregar leads do Excel</h2><p>Baixe o modelo, preencha sem alterar os cabeçalhos e envie o arquivo. Todos os contatos importados entrarão como não contatados; o executivo escolherá a etapa ao ativar cada lead.</p><a className="template-download" href="/modelo_importacao_leads_i5media.xlsx" download>↓ Baixar modelo oficial do Excel</a><label className="drop">⇧<b>{file?.name ?? "Selecione a planilha preenchida"}</b><small>Formato .xlsx · até 10 MB</small><input type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)}/></label><div className="radios"><b>Como distribuir os leads?</b><label><input type="radio" name="distribution" checked={mode === "manual"} onChange={() => setMode("manual")}/> Usar executivo_email da planilha</label><label><input type="radio" name="distribution" checked={mode === "automatic"} onChange={() => setMode("automatic")}/> Distribuição automática e equilibrada</label></div>{error && <div className="auth-error">{error}</div>}<button className="primary full" disabled={!file || busy} onClick={() => void process()}>{busy ? "Importando..." : "Processar planilha"}</button></>;
}

function UserForm({ invite, done }: { invite: (input: { role: "executive"; fullName: string; email: string; menuPermissions: string[]; canViewRevenue: boolean }) => Promise<unknown>; done: () => void }) {
  const [fullName, setFullName] = useState(""); const [email, setEmail] = useState(""); const [menus, setMenus] = useState<string[]>(agentMenuOptions); const [canViewRevenue, setCanViewRevenue] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const submit = async () => { setBusy(true); setError(""); try { await invite({ role: "executive", fullName, email, menuPermissions: menus, canViewRevenue }); done(); } catch (submitError) { setError(errorMessage(submitError)); } finally { setBusy(false); } };
  return <><label className="tag">EQUIPE COMERCIAL</label><h2>Cadastrar executivo</h2><p>Escolha os acessos. O executivo receberá um link temporário por e-mail para criar a própria senha.</p><div className="form"><label>Nome completo<input value={fullName} onChange={(event) => setFullName(event.target.value)} required/></label><label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required/></label></div><div className="invite-note"><i>✉</i><span><b>Convite seguro por e-mail</b><small>Nenhuma senha será enviada em texto. No primeiro acesso, o executivo cria e confirma a senha pessoal.</small></span></div><AccessFields menus={menus} setMenus={setMenus} canViewRevenue={canViewRevenue} setCanViewRevenue={setCanViewRevenue}/>{error && <div className="auth-error">{error}</div>}<button className="primary full" onClick={() => void submit()} disabled={busy || !fullName || !email || menus.length === 0}>{busy ? "Enviando convite..." : "Cadastrar e enviar convite"}</button></>;
}

function PermissionForm({ profile, done }: { profile: Profile; done: (permissions: string[], canViewRevenue: boolean) => Promise<void> }) {
  const [menus, setMenus] = useState<string[]>(profile.menu_permissions); const [canViewRevenue, setCanViewRevenue] = useState(profile.can_view_revenue); const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); try { await done(menus, canViewRevenue); } finally { setBusy(false); } };
  return <><label className="tag">CONTROLE DE ACESSO</label><h2>Editar acessos de {profile.full_name || profile.email}</h2><p>{profile.email}</p><AccessFields menus={menus} setMenus={setMenus} canViewRevenue={canViewRevenue} setCanViewRevenue={setCanViewRevenue}/><button className="primary full" onClick={() => void submit()} disabled={busy || menus.length === 0}>{busy ? "Salvando..." : "Salvar permissões"}</button></>;
}

function AccessFields({ menus, setMenus, canViewRevenue, setCanViewRevenue }: { menus: string[]; setMenus: (menus: string[]) => void; canViewRevenue: boolean; setCanViewRevenue: (value: boolean) => void }) {
  const toggle = (item: string) => setMenus(menus.includes(item) ? menus.filter((menu) => menu !== item) : [...menus, item]);
  return <div className="access-fields"><div className="access-heading"><span><b>Menus liberados</b><small>Marque as funções que aparecerão na lateral do sistema.</small></span><button type="button" onClick={() => setMenus(menus.length === agentMenuOptions.length ? [] : agentMenuOptions)}>{menus.length === agentMenuOptions.length ? "Desmarcar todos" : "Marcar todos"}</button></div><div className="permission-grid">{agentMenuOptions.map((item) => <label className={menus.includes(item) ? "selected" : ""} key={item}><input type="checkbox" checked={menus.includes(item)} onChange={() => toggle(item)}/><i>{navIcons[item]}</i><span>{item}</span><b>✓</b></label>)}</div><label className={`financial-toggle ${canViewRevenue ? "selected" : ""}`}><input type="checkbox" checked={canViewRevenue} onChange={(event) => setCanViewRevenue(event.target.checked)}/><span><b>Acesso aos valores financeiros</b><small>Permite visualizar faturamento, valores do pipeline, contratos e campos de orçamento.</small></span><i>{canViewRevenue ? "Liberado" : "Bloqueado"}</i></label><small className="access-summary">{menus.length} de {agentMenuOptions.length} menus selecionados · valores financeiros {canViewRevenue ? "liberados" : "ocultos"}</small></div>;
}
