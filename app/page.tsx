"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { readSheet } from "read-excel-file/browser";
import { supabase } from "../lib/supabase";

const ADMIN_EMAIL = "i5mediaagencia@gmail.com";
const stages = ["Novo lead", "Primeiro contato", "Follow-up", "Reunião marcada", "Proposta enviada", "Negociação", "Ganho", "Perdido"];
const directRegistrationStages = stages.filter((stage) => !["Follow-up", "Reunião marcada"].includes(stage));
const nav = ["Visão geral", "Leads", "Pipeline", "Follow-ups", "Reuniões", "Propostas", "Clientes", "Chamados", "Equipe", "Chat interno"];
const agentMenuOptions = nav.filter((item) => item !== "Equipe");
const navIcons: Record<string, string> = { "Visão geral": "▦", Leads: "◎", Pipeline: "▥", "Follow-ups": "◷", Reuniões: "▣", Propostas: "▤", Clientes: "♙", Chamados: "◈", Equipe: "♚", "Chat interno": "◌" };

type Profile = { id: string; email: string; full_name: string; role: "super_admin" | "executive" | "client"; active: boolean; menu_permissions: string[]; can_view_revenue: boolean };
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
  estimated_value: number | string | null; stage: string; owner_id: string | null; service_id: string | null;
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
type ImportRecord = Record<string, string | number>;

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dateTime = (value?: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "Sem agendamento";
const toInputDate = (value?: string | null) => {
  const date = value ? new Date(value) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
const roleName = (role: Profile["role"]) => role === "super_admin" ? "Super administrador" : role === "executive" ? "Executivo de vendas" : "Cliente";
const tone = (status: string) => {
  if (["Ganho", "Concluída", "Conectou", "Aprovada", "Ativo"].some((item) => status.includes(item))) return "green";
  if (["Perdido", "Não conectou", "Não compareceu", "Alta", "Urgente"].some((item) => status.includes(item))) return "red";
  if (["Reunião", "Reagendada", "Negociação"].some((item) => status.includes(item))) return "orange";
  if (["Proposta", "Enviada", "Em andamento"].some((item) => status.includes(item))) return "blue";
  return "purple";
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  if (authLoading) return <LoadingScreen/>;
  if (!session) return <AuthScreen/>;
  return <AuthenticatedApp user={session.user}/>;
}

function AuthenticatedApp({ user }: { user: User }) {
  const [page, setPage] = useState("Visão geral");
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

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    const [profileResult, teamResult, serviceResult, companyResult, followupResult, meetingResult] = await Promise.all([
      supabase.from("profiles").select("id,email,full_name,role,active,menu_permissions,can_view_revenue").eq("id", user.id).single(),
      supabase.from("profiles").select("id,email,full_name,role,active,menu_permissions,can_view_revenue").order("full_name"),
      supabase.from("services").select("id,name").eq("active", true).order("name"),
      supabase.from("companies").select("id,name,legal_name,cnpj,email,phone,address,estimated_value,stage,owner_id,service_id,contacts(name,email,phone,is_primary),services(name),followups(due_at,completed_at)").order("created_at", { ascending: false }),
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
    const active = leads.filter((lead) => !["Ganho", "Perdido"].includes(lead.stage));
    const won = leads.filter((lead) => lead.stage === "Ganho");
    const finished = leads.filter((lead) => ["Ganho", "Perdido"].includes(lead.stage));
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
    await persistStage(lead, stage);
  };

  const saveCompany = async (input: NewCompanyInput) => {
    const { data, error } = await supabase.from("companies").insert({
      name: input.name, legal_name: input.legalName || null, cnpj: input.cnpj || null, email: input.email || null, phone: input.phone || null,
      address: input.address || null, estimated_value: input.value, service_id: input.serviceId || null, owner_id: input.ownerId || user.id,
      created_by: user.id, source: input.source || "Manual", stage: input.stage,
      closed_at: input.stage === "Ganho" ? new Date().toISOString() : null,
    }).select("id").single();
    if (error) throw error;
    if (input.contact && data) {
      const { error: contactError } = await supabase.from("contacts").insert({ company_id: data.id, name: input.contact, email: input.contactEmail || null, phone: input.contactPhone || null, kind: "Responsável", is_primary: true });
      if (contactError) throw contactError;
    }
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
      const stage = stages.includes(String(record.etapa ?? "")) ? String(record.etapa) : "Novo lead";
      const { data, error } = await supabase.from("companies").insert({
        name, legal_name: String(record.razao_social ?? "") || null, cnpj: cnpj || null, email: email || null,
        phone: String(record.telefone_empresa ?? "") || null, address: String(record.localizacao ?? "") || null,
        service_id: serviceId, estimated_value: canViewRevenue ? Number(record.valor_estimado ?? 0) || 0 : 0, source: String(record.origem ?? "Manual"), stage, owner_id: ownerId, created_by: user.id,
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
  if (profile.role === "client") return <ClientPortal profile={profile} leads={leads}/>;

  const visibleNav = profile.role === "super_admin" ? nav : agentMenuOptions.filter((item) => profile.menu_permissions.includes(item));
  const activePage = visibleNav.includes(page) ? page : visibleNav[0] ?? "";
  const canViewRevenue = profile.role === "super_admin" || profile.can_view_revenue;
  const displayName = profile.full_name || profile.email.split("@")[0];
  const openLead = () => { setActiveLead(null); setModal("lead"); };
  const openClient = () => { setActiveLead(null); setModal("client"); };

  return (
    <div className="shell">
      <aside>
        <div className="brand"><b>i5</b><span><strong>I5MEDIA</strong><small>Sales Hub</small></span></div>
        <nav>{visibleNav.map((item) => <button className={activePage === item ? "active" : ""} onClick={() => setPage(item)} key={item}><i>{navIcons[item]}</i>{item}</button>)}</nav>
        <div className="storage"><span>Supabase <b>Conectado</b></span><progress value="100" max="100"/><small>Dados e segurança ativos</small></div>
      </aside>
      <main>
        <header>
          <div className="search">⌕ <input placeholder="Buscar empresa, contato ou CNPJ..."/><kbd>⌘ K</kbd></div>
          <button className="bell" aria-label="Notificações">♢<i/></button>
          <div className="user"><Avatar name={displayName}/><span><b>{displayName}</b><small>{roleName(profile.role)}</small></span></div>
          <button className="logout" onClick={() => supabase.auth.signOut()}>Sair</button>
        </header>
        <section>
          {activePage && (
            <Title page={activePage} name={displayName.split(" ")[0]} onLead={openLead} onClient={openClient} onImport={() => setModal("import")} onFollowup={() => { setActiveFollowup(null); setActiveLead(null); setModal("followup"); }} onMeeting={() => { setActiveMeeting(null); setActiveLead(null); setModal("meeting"); }}/>
          )}
          {activePage === "Visão geral" && <Dashboard leads={leads} meetings={meetings} profiles={profiles} stats={stats} canViewRevenue={canViewRevenue} go={setPage}/>}
          {activePage === "Leads" && <LeadList leads={leads} canViewRevenue={canViewRevenue}/>}
          {activePage === "Pipeline" && <Pipeline leads={leads} canViewRevenue={canViewRevenue} move={requestStageChange}/>}
          {activePage === "Follow-ups" && (
            <FollowupsView followups={followups} onComplete={completeFollowup} onEdit={(item) => { setActiveFollowup(item); setActiveLead(leads.find((lead) => lead.id === item.companyId) ?? null); setModal("followup"); }}/>
          )}
          {activePage === "Reuniões" && (
            <MeetingsView meetings={meetings} profiles={profiles} onResult={updateMeetingResult} onReschedule={(item) => { setActiveMeeting(item); setActiveLead(leads.find((lead) => lead.id === item.companyId) ?? null); setModal("meeting"); }}/>
          )}
          {activePage === "Propostas" && <Proposals leads={leads}/>}
          {activePage === "Clientes" && <Clients leads={leads.filter((lead) => lead.stage === "Ganho")} canViewRevenue={canViewRevenue} onAdd={openClient}/>}
          {activePage === "Chamados" && <Tickets/>}
          {activePage === "Equipe" && (
            <Team profiles={profiles} leads={leads} meetings={meetings} onAdd={() => { setActiveExecutive(null); setModal("user"); }} onEdit={(executive) => { setActiveExecutive(executive); setModal("permissions"); }}/>
          )}
          {activePage === "Chat interno" && <Chat profile={profile}/>}
          {!activePage && <EmptyPanel title="Nenhum módulo liberado" text="Peça ao Super Admin para selecionar ao menos um menu para este acesso."/>}
        </section>
      </main>
      {visibleNav.includes("Chat interno") && <button className="float" onClick={() => setPage("Chat interno")} aria-label="Abrir chat">◌</button>}
      {toast && <div className="toast">✓ {toast}</div>}
      {modal && <Modal close={() => setModal("")}>
        {modal === "import" && (
          <ImportModal onImport={importRecords} onDone={(message) => { setModal(""); flash(message); }}/>
        )}
        {(modal === "lead" || modal === "client") && (
          <CompanyForm services={services} profiles={staffProfiles} currentUserId={user.id} canViewRevenue={canViewRevenue} initialStage={modal === "client" ? "Ganho" : "Novo lead"} done={async (input) => { try { await saveCompany(input); setModal(""); flash(modal === "client" ? "Cliente cadastrado" : "Lead cadastrado"); } catch (error) { flash(errorMessage(error)); } }}/>
        )}
        {modal === "followup" && <FollowupForm leads={leads} profiles={staffProfiles} lead={activeLead} existing={activeFollowup} currentUserId={user.id} done={async (input) => { try { await saveFollowup(input); setModal(""); flash(input.id ? "Follow-up reagendado" : "Follow-up agendado"); } catch (error) { flash(errorMessage(error)); } }}/>}
        {modal === "meeting" && <MeetingForm leads={leads} profiles={staffProfiles} lead={activeLead} existing={activeMeeting} currentUserId={user.id} done={async (input) => { try { await saveMeeting(input); setModal(""); flash(input.rescheduledFrom ? "Reunião reagendada" : "Reunião agendada"); } catch (error) { flash(errorMessage(error)); } }}/>}
        {modal === "user" && (
          <UserForm done={() => { setModal(""); void loadData(); flash("Executivo criado com os acessos selecionados"); }}/>
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
      } else { const result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }); if (result.error) throw result.error; setMessage("Enviamos um link de recuperação para o seu e-mail."); }
    } catch (submitError) { setError(translateAuthError(errorMessage(submitError))); } finally { setBusy(false); }
  };
  return <main className="auth-screen"><section className="auth-brand"><div className="auth-logo">i5</div><span>I5MEDIA · CRM COMERCIAL</span><h1>Vendas organizadas.<br/>Relacionamentos que crescem.</h1><p>Leads, reuniões, follow-ups e resultados da equipe em uma central conectada ao Supabase.</p><div className="auth-status"><i/> Supabase conectado e protegido por RLS</div></section><section className="auth-card"><label className="tag">ACESSO SEGURO</label><h2>{mode === "login" ? "Entrar no Sales Hub" : mode === "register" ? "Criar acesso do Super Admin" : "Recuperar senha"}</h2><p>{mode === "register" ? "Não existe senha padrão. Defina uma senha forte e exclusiva." : "Use seu e-mail e senha cadastrados."}</p><form onSubmit={submit}>{mode === "register" && <label>Nome completo<input value={name} onChange={(event) => setName(event.target.value)} required/></label>}<label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required/></label>{mode !== "recover" && <label>Senha<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 8 caracteres" required/></label>}{error && <div className="auth-error">{error}</div>}{message && <div className="auth-success">{message}</div>}<button className="primary full" disabled={busy}>{busy ? "Aguarde..." : mode === "login" ? "Entrar" : mode === "register" ? "Criar meu acesso" : "Enviar link"}</button></form><div className="auth-links">{mode !== "register" && <button onClick={() => setMode("register")}>Primeiro acesso</button>}{mode !== "recover" && <button onClick={() => setMode("recover")}>Esqueci minha senha</button>}{mode !== "login" && <button onClick={() => setMode("login")}>Voltar ao login</button>}</div></section></main>;
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
    Clientes: ["Clientes", "Cadastre clientes diretamente ou converta leads ganhos."], Chamados: ["Chamados dos clientes", "Centralize solicitações após o fechamento."], Equipe: ["Equipe e desempenho", "Compare quem mais agenda e quem mais fecha contratos."], "Chat interno": ["Chat interno", "Conversas privadas e canais da equipe."],
  };
  return <div className="title"><div><span>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date()).toUpperCase()}</span><h1>{data[page]?.[0]}</h1><p>{data[page]?.[1]}</p></div><div className="title-actions">{["Visão geral", "Leads"].includes(page) && <><button className="ghost" onClick={onImport}>⇧ Importar Excel</button><button className="primary" onClick={onLead}>＋ Novo lead</button></>}{page === "Clientes" && <button className="primary" onClick={onClient}>＋ Cadastrar cliente</button>}{page === "Follow-ups" && <button className="primary" onClick={onFollowup}>＋ Agendar follow-up</button>}{page === "Reuniões" && <button className="primary" onClick={onMeeting}>＋ Agendar reunião</button>}</div></div>;
}

function Dashboard({ leads, meetings, profiles, stats, canViewRevenue, go }: { leads: Lead[]; meetings: Meeting[]; profiles: Profile[]; stats: { active: number; pipeline: number; revenue: number; conversion: number }; canViewRevenue: boolean; go: (page: string) => void }) {
  const performance = getPerformance(profiles, leads, meetings);
  const statItems = canViewRevenue
    ? [["Leads em tratamento", String(stats.active), "Carteira atual", "◎"], ["Pipeline em aberto", money(stats.pipeline), "Valor estimado", "◈"], ["Faturamento ganho", money(stats.revenue), "Contratos ganhos", "↗"], ["Taxa de conversão", `${stats.conversion.toFixed(1)}%`, "Ganho ÷ encerrados", "⌁"]]
    : [["Leads em tratamento", String(stats.active), "Carteira atual", "◎"], ["Reuniões", String(meetings.length), "Agendamentos registrados", "▣"], ["Contratos ganhos", String(leads.filter((lead) => lead.stage === "Ganho").length), "Fechamentos", "↗"], ["Taxa de conversão", `${stats.conversion.toFixed(1)}%`, "Ganho ÷ encerrados", "⌁"]];
  return <><div className="stats">{statItems.map((item, index) => <article key={item[0]}><i className={`stat s${index}`}>{item[3]}</i><span><small>{item[0]}</small><b>{item[1]}</b><em>{item[2]}</em></span></article>)}</div><div className="dashboard-grid"><article className="panel"><PanelHead title="Funil comercial" subtitle="Distribuição atual por etapa" action="Ver pipeline →" click={() => go("Pipeline")}/><div className="funnel">{stages.map((stage) => { const count = leads.filter((lead) => lead.stage === stage).length; const width = leads.length ? Math.max(7, count / leads.length * 100) : 7; return <div key={stage}><span>{stage}</span><b><i style={{ width: `${width}%` }}/></b><em>{count}</em></div>; })}</div></article><PerformancePanel rows={performance} compact showRevenue={canViewRevenue}/></div><article className="panel deals recent"><PanelHead title="Negociações recentes" subtitle="Últimas oportunidades da carteira" action="Ver todas →" click={() => go("Leads")}/>{leads.slice(0, 6).map((lead) => <div key={lead.id}><CompanyCell lead={lead}/><Pill status={lead.stage}/><strong>{canViewRevenue ? money(lead.value) : "Valor restrito"}</strong><span className="owner"><Avatar name={lead.owner}/>{lead.owner}</span><small>{lead.next}</small></div>)}</article></>;
}

function PanelHead({ title, subtitle, action, click }: { title: string; subtitle: string; action?: string; click?: () => void }) { return <div className="head"><span><b>{title}</b><small>{subtitle}</small></span>{action && <button onClick={click}>{action}</button>}</div>; }
function CompanyCell({ lead }: { lead: Lead }) { return <span className="company"><i>{lead.name[0]}</i><b>{lead.name}<small>{lead.contact}</small></b></span>; }

function Pipeline({ leads, canViewRevenue, move }: { leads: Lead[]; canViewRevenue: boolean; move: (lead: Lead, stage: string) => void }) {
  const [dropTarget, setDropTarget] = useState("");
  const drop = (stage: string, id: string) => { const lead = leads.find((item) => item.id === id); setDropTarget(""); if (lead) void move(lead, stage); };
  return <><div className="kanban-tip">↔ Arraste lateralmente para navegar · Arraste um card para mudar de etapa</div><div className="kanban">{stages.map((stage) => <section className={`kanban-column ${dropTarget === stage ? "drop-target" : ""}`} key={stage} onDragOver={(event) => { event.preventDefault(); setDropTarget(stage); }} onDragLeave={() => setDropTarget("")} onDrop={(event) => drop(stage, event.dataTransfer.getData("text/lead-id"))}><header><i/>{stage}<em>{leads.filter((lead) => lead.stage === stage).length}</em></header>{leads.filter((lead) => lead.stage === stage).map((lead) => <article draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/lead-id", lead.id); }} key={lead.id}><div className="kanban-card-top"><span className="logo">{lead.name[0]}</span><small>{lead.service}</small></div><h4>{lead.name}</h4><p>{lead.contact}</p><b>{canViewRevenue ? money(lead.value) : "Valor restrito"}</b><footer><span className="owner"><Avatar name={lead.owner}/>{lead.owner}</span><span>◷ {lead.next}</span></footer><select aria-label={`Etapa de ${lead.name}`} value={lead.stage} onChange={(event) => void move(lead, event.target.value)}>{stages.map((item) => <option key={item}>{item}</option>)}</select></article>)}</section>)}</div></>;
}

function LeadList({ leads, canViewRevenue }: { leads: Lead[]; canViewRevenue: boolean }) {
  return <article className="panel lead-table"><header><span>EMPRESA / CONTATO</span><span>CONTATOS</span><span>LOCALIZAÇÃO</span><span>{canViewRevenue ? "ETAPA / VALOR" : "ETAPA"}</span><span>RESPONSÁVEL</span></header>{leads.map((lead) => <div key={lead.id}><CompanyCell lead={lead}/><span className="contact-stack"><b>{lead.phone || "Sem telefone"}</b><small>{lead.email || lead.contactEmail || "Sem e-mail"}</small><small>{lead.cnpj || "CNPJ não informado"}</small></span><span>{lead.address || "Não informada"}</span><span><Pill status={lead.stage}/>{canViewRevenue && <strong>{money(lead.value)}</strong>}</span><span className="owner"><Avatar name={lead.owner}/>{lead.owner}</span></div>)}</article>;
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
function Clients({ leads, canViewRevenue, onAdd }: { leads: Lead[]; canViewRevenue: boolean; onAdd: () => void }) { if (!leads.length) return <EmptyPanel title="Nenhum cliente cadastrado ainda" text="Cadastre diretamente por esta aba ou mova um lead para Ganho." action="Cadastrar cliente" click={onAdd}/>; return <div className="cards">{leads.map((lead) => <article className="panel client-card" key={lead.id}><div><i>{lead.name[0]}</i><Pill status="Ativo"/></div><h2>{lead.name}</h2><p>{lead.service}</p>{canViewRevenue && <strong>{money(lead.value)}</strong>}<hr/><small>Executivo responsável</small><b className="owner"><Avatar name={lead.owner}/>{lead.owner}</b><small>{lead.email || lead.phone}</small><button>Abrir ficha do cliente →</button></article>)}</div>; }
function Tickets() { return <EmptyPanel title="Central de chamados pronta" text="Clientes autenticados podem abrir chamados vinculados à própria empresa."/>; }
function Team({ profiles, leads, meetings, onAdd, onEdit }: { profiles: Profile[]; leads: Lead[]; meetings: Meeting[]; onAdd: () => void; onEdit: (profile: Profile) => void }) {
  const executives = profiles.filter((item) => item.role === "executive");
  return <><div className="section-actions"><button className="primary" onClick={onAdd}>＋ Cadastrar executivo</button></div>{executives.length > 0 && <div className="agent-access-grid">{executives.map((executive) => <article className="panel agent-access-card" key={executive.id}><div><Avatar name={executive.full_name || executive.email}/><span><b>{executive.full_name || executive.email}</b><small>{executive.email}</small></span><Pill status={executive.active ? "Ativo" : "Inativo"}/></div><p>{executive.menu_permissions.length} módulos liberados</p><div className="permission-tags">{executive.menu_permissions.map((item) => <span key={item}>{item}</span>)}</div><b className={executive.can_view_revenue ? "financial-yes" : "financial-no"}>{executive.can_view_revenue ? "✓ Visualiza valores e faturamento" : "⊘ Valores financeiros ocultos"}</b><button className="ghost" onClick={() => onEdit(executive)}>Editar acessos</button></article>)}</div>}<PerformancePanel rows={getPerformance(profiles, leads, meetings)}/></>;
}

function Chat({ profile }: { profile: Profile }) {
  const [messages, setMessages] = useState<{ id: string; body: string; sender_id: string; created_at: string }[]>([]); const [value, setValue] = useState("");
  const loadMessages = useCallback(async () => { const { data } = await supabase.from("team_messages").select("id,body,sender_id,created_at").eq("channel", "geral").eq("is_private", false).order("created_at").limit(100); setMessages(data ?? []); }, []);
  useEffect(() => { const timer = window.setTimeout(() => void loadMessages(), 0); const channel = supabase.channel("team-chat").on("postgres_changes", { event: "INSERT", schema: "public", table: "team_messages" }, () => void loadMessages()).subscribe(); return () => { window.clearTimeout(timer); void supabase.removeChannel(channel); }; }, [loadMessages]);
  const send = async () => { const body = value.trim(); if (!body) return; const { error } = await supabase.from("team_messages").insert({ sender_id: profile.id, channel: "geral", body, is_private: false }); if (!error) { setValue(""); await loadMessages(); } };
  return <div className="chat"><aside className="panel"><h3>CANAIS</h3><button className="selected"># Geral</button><button># Comercial</button><button># Projetos</button><h3>MENSAGENS DIRETAS</h3><small>Conversas privadas protegidas por RLS</small></aside><article className="panel"><header><b># Geral</b><small>Canal interno da equipe</small></header><main>{messages.length ? messages.map((message) => <div key={message.id}><Avatar name={message.sender_id === profile.id ? profile.full_name : "Equipe"}/><p><b>{message.sender_id === profile.id ? "Você" : "Equipe"}</b>{message.body}</p></div>) : <div className="empty-chat">Envie a primeira mensagem para a equipe.</div>}</main><footer><input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void send(); }} placeholder="Escreva uma mensagem..."/><button onClick={() => void send()}>➤</button></footer></article></div>;
}

function ClientPortal({ profile, leads }: { profile: Profile; leads: Lead[] }) { const company = leads[0]; return <main className="client-portal"><header><div className="brand"><b>i5</b><span><strong>I5MEDIA</strong><small>Portal do cliente</small></span></div><div className="user"><Avatar name={profile.full_name || profile.email}/><span><b>{profile.full_name || profile.email}</b><small>Cliente</small></span></div><button className="logout" onClick={() => supabase.auth.signOut()}>Sair</button></header><section><label className="tag">ÁREA DO CLIENTE</label><h1>{company?.name ?? "Bem-vindo ao portal"}</h1><p>Acompanhe contrato, propostas e chamados em um ambiente seguro.</p><div className="client-grid"><article className="panel"><i>▤</i><h2>Contrato e documentos</h2><p>PDFs anexados à sua empresa aparecerão aqui.</p><button>Acessar documentos</button></article><article className="panel"><i>◈</i><h2>Abrir chamado</h2><p>Fale com o executivo responsável.</p><button>Novo chamado</button></article><article className="panel"><i>♙</i><h2>Seu executivo</h2><p>{company?.owner ?? "A equipe I5Media"}</p><button>Iniciar conversa</button></article></div></section></main>; }

function Modal({ children, close }: { children: ReactNode; close: () => void }) { return <div className="back" onMouseDown={close}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><button className="x" onClick={close}>×</button>{children}</div></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty"><b>{title}</b><p>{text}</p></div>; }
function EmptyPanel({ title, text, action, click }: { title: string; text: string; action?: string; click?: () => void }) { return <article className="panel empty-state"><b>{title}</b><p>{text}</p>{action && <button className="primary" onClick={click}>{action}</button>}</article>; }

function CompanyForm({ services, profiles, currentUserId, canViewRevenue, initialStage, done }: { services: Service[]; profiles: Profile[]; currentUserId: string; canViewRevenue: boolean; initialStage: string; done: (input: NewCompanyInput) => Promise<void> }) {
  const [form, setForm] = useState<NewCompanyInput>({ name: "", legalName: "", cnpj: "", email: "", phone: "", address: "", contact: "", contactEmail: "", contactPhone: "", serviceId: services[0]?.id ?? "", ownerId: profiles[0]?.id ?? currentUserId, value: 0, source: "Manual", stage: initialStage });
  const [busy, setBusy] = useState(false);
  const field = (key: keyof NewCompanyInput, value: string | number) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => { if (!form.name || !form.contact) return; setBusy(true); try { await done(form); } finally { setBusy(false); } };
  return <><label className="tag">{initialStage === "Ganho" ? "NOVO CLIENTE" : "NOVO LEAD"}</label><h2>{initialStage === "Ganho" ? "Cadastrar cliente" : "Cadastrar lead"}</h2><p>Dados completos da empresa, contato e oportunidade.</p><div className="form form-3"><label>Nome da empresa *<input value={form.name} onChange={(event) => field("name", event.target.value)} placeholder="Nome fantasia"/></label><label>Razão social<input value={form.legalName} onChange={(event) => field("legalName", event.target.value)} placeholder="Razão social"/></label><label>CNPJ<input value={form.cnpj} onChange={(event) => field("cnpj", event.target.value)} placeholder="00.000.000/0001-00"/></label><label>E-mail da empresa<input type="email" value={form.email} onChange={(event) => field("email", event.target.value)} placeholder="contato@empresa.com.br"/></label><label>Telefone da empresa<input value={form.phone} onChange={(event) => field("phone", event.target.value)} placeholder="(11) 99999-9999"/></label><label>Localização<input value={form.address} onChange={(event) => field("address", event.target.value)} placeholder="Cidade/UF ou endereço"/></label><label>Contato principal *<input value={form.contact} onChange={(event) => field("contact", event.target.value)} placeholder="Nome completo"/></label><label>E-mail do contato<input type="email" value={form.contactEmail} onChange={(event) => field("contactEmail", event.target.value)}/></label><label>Telefone do contato<input value={form.contactPhone} onChange={(event) => field("contactPhone", event.target.value)}/></label><label>Executivo<select value={form.ownerId} onChange={(event) => field("ownerId", event.target.value)}>{profiles.map((item) => <option value={item.id} key={item.id}>{item.full_name || item.email}</option>)}</select></label><label>Serviço<select value={form.serviceId} onChange={(event) => field("serviceId", event.target.value)}>{services.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select></label>{canViewRevenue && <label>Valor estimado<input type="number" min="0" value={form.value} onChange={(event) => field("value", Number(event.target.value))}/></label>}<label>Origem<select value={form.source} onChange={(event) => field("source", event.target.value)}><option>Manual</option><option>Indicação</option><option>Site</option><option>Instagram</option><option>Google</option><option>Prospecção</option></select></label><label>Etapa<select value={form.stage} onChange={(event) => field("stage", event.target.value)}>{directRegistrationStages.map((stage) => <option key={stage}>{stage}</option>)}</select></label></div><small className="form-hint">Follow-up e Reunião marcada são definidos no Kanban para exigir responsável e data.</small><button className="primary full" disabled={busy || !form.name || !form.contact} onClick={() => void submit()}>{busy ? "Salvando..." : initialStage === "Ganho" ? "Cadastrar cliente" : "Cadastrar lead"}</button></>;
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
      const result = await onImport(records, mode); onDone(`${result.imported} leads importados; ${result.duplicates} duplicados ignorados`);
    } catch (processError) { setError(errorMessage(processError)); } finally { setBusy(false); }
  };
  return <><label className="tag">IMPORTAÇÃO INTELIGENTE</label><h2>Carregar leads do Excel</h2><p>Baixe o modelo, preencha sem alterar os cabeçalhos e envie o arquivo.</p><a className="template-download" href="/modelo_importacao_leads_i5media.xlsx" download>↓ Baixar modelo oficial do Excel</a><label className="drop">⇧<b>{file?.name ?? "Selecione a planilha preenchida"}</b><small>Formato .xlsx · até 10 MB</small><input type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)}/></label><div className="radios"><b>Como distribuir os leads?</b><label><input type="radio" name="distribution" checked={mode === "manual"} onChange={() => setMode("manual")}/> Usar executivo_email da planilha</label><label><input type="radio" name="distribution" checked={mode === "automatic"} onChange={() => setMode("automatic")}/> Distribuição automática e equilibrada</label></div>{error && <div className="auth-error">{error}</div>}<button className="primary full" disabled={!file || busy} onClick={() => void process()}>{busy ? "Importando..." : "Processar planilha"}</button></>;
}

function UserForm({ done }: { done: () => void }) {
  const [fullName, setFullName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [menus, setMenus] = useState<string[]>(agentMenuOptions); const [canViewRevenue, setCanViewRevenue] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const submit = async () => { setBusy(true); setError(""); const { error: invokeError } = await supabase.functions.invoke("admin-create-user", { body: { full_name: fullName, email, password, role: "executive", menu_permissions: menus, can_view_revenue: canViewRevenue } }); setBusy(false); if (invokeError) { setError(invokeError.message); return; } done(); };
  return <><label className="tag">EQUIPE COMERCIAL</label><h2>Cadastrar executivo</h2><p>Crie um acesso individual e escolha exatamente o que este usuário poderá visualizar.</p><div className="form"><label>Nome completo<input value={fullName} onChange={(event) => setFullName(event.target.value)} required/></label><label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required/></label></div><label>Senha temporária<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 8 caracteres" required/></label><AccessFields menus={menus} setMenus={setMenus} canViewRevenue={canViewRevenue} setCanViewRevenue={setCanViewRevenue}/>{error && <div className="auth-error">{error}</div>}<button className="primary full" onClick={() => void submit()} disabled={busy || !fullName || !email || password.length < 8 || menus.length === 0}>{busy ? "Criando..." : "Criar executivo com estes acessos"}</button></>;
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
