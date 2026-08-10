"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

const ADMIN_EMAIL = "i5mediaagencia@gmail.com";
const nav = ["Visão geral", "Leads", "Pipeline", "Follow-ups", "Propostas", "Clientes", "Chamados", "Equipe", "Chat interno"];
const stages = ["Novo lead", "Primeiro contato", "Reunião marcada", "Proposta enviada", "Negociação", "Ganho", "Perdido"];

type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: "super_admin" | "executive" | "client";
  active: boolean;
};

type Service = { id: string; name: string };

type Lead = {
  id: string;
  name: string;
  contact: string;
  service: string;
  serviceId: string | null;
  value: number;
  stage: string;
  owner: string;
  ownerId: string | null;
  next: string;
};

type CompanyRow = {
  id: string;
  name: string;
  estimated_value: number | string | null;
  stage: string;
  owner_id: string | null;
  service_id: string | null;
  contacts: { name: string; is_primary: boolean }[] | null;
  services: { name: string } | null;
  followups: { due_at: string | null; type: string; completed_at: string | null }[] | null;
};

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const tone = (status: string) => {
  if (["Ganho", "Aprovada", "Concluído", "Ativo"].some((x) => status.includes(x))) return "green";
  if (["Reunião", "Alta", "Urgente", "Perdido"].some((x) => status.includes(x))) return "orange";
  if (["Proposta", "Enviada", "Em andamento"].some((x) => status.includes(x))) return "blue";
  return "purple";
};

function formatDate(value?: string | null) {
  if (!value) return "Sem agendamento";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  if (authLoading) return <LoadingScreen />;
  if (!session) return <AuthScreen />;
  return <AuthenticatedApp user={session.user} />;
}

function AuthenticatedApp({ user }: { user: User }) {
  const [page, setPage] = useState("Visão geral");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState("");
  const [toast, setToast] = useState("");

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: profileData }, { data: teamData }, { data: serviceData }, { data: companyData, error }] = await Promise.all([
      supabase.from("profiles").select("id,email,full_name,role,active").eq("id", user.id).single(),
      supabase.from("profiles").select("id,email,full_name,role,active").order("full_name"),
      supabase.from("services").select("id,name").eq("active", true).order("name"),
      supabase
        .from("companies")
        .select("id,name,estimated_value,stage,owner_id,service_id,contacts(name,is_primary),services(name),followups(due_at,type,completed_at)")
        .order("created_at", { ascending: false }),
    ]);

    if (profileData) setProfile(profileData as Profile);
    const team = (teamData ?? []) as Profile[];
    setProfiles(team);
    setServices((serviceData ?? []) as Service[]);

    if (error) {
      flash(`Não foi possível carregar os leads: ${error.message}`);
      setLoading(false);
      return;
    }

    const ownerNames = new Map(team.map((item) => [item.id, item.full_name || item.email]));
    const rows = (companyData ?? []) as unknown as CompanyRow[];
    const normalized = rows.map((item) => {
      const primary = item.contacts?.find((contact) => contact.is_primary) ?? item.contacts?.[0];
      const nextFollowup = item.followups
        ?.filter((followup) => !followup.completed_at && followup.due_at)
        .sort((a, b) => new Date(a.due_at ?? 0).getTime() - new Date(b.due_at ?? 0).getTime())[0];
      return {
        id: item.id,
        name: item.name,
        contact: primary?.name ?? "Contato não informado",
        service: item.services?.name ?? "Serviço não informado",
        serviceId: item.service_id,
        value: Number(item.estimated_value ?? 0),
        stage: item.stage,
        owner: item.owner_id ? ownerNames.get(item.owner_id) ?? "Executivo" : "Não atribuído",
        ownerId: item.owner_id,
        next: formatDate(nextFollowup?.due_at),
      } satisfies Lead;
    });
    setLeads(normalized);
    setLoading(false);
  }, [user.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const stats = useMemo(() => {
    const active = leads.filter((lead) => !["Ganho", "Perdido"].includes(lead.stage));
    const won = leads.filter((lead) => lead.stage === "Ganho");
    const finished = leads.filter((lead) => ["Ganho", "Perdido"].includes(lead.stage));
    return {
      active: active.length,
      pipeline: active.reduce((total, lead) => total + lead.value, 0),
      revenue: won.reduce((total, lead) => total + lead.value, 0),
      conversion: finished.length ? (won.length / finished.length) * 100 : 0,
    };
  }, [leads]);

  const moveLead = async (lead: Lead, stage: string) => {
    setLeads((current) => current.map((item) => (item.id === lead.id ? { ...item, stage } : item)));
    const { error } = await supabase
      .from("companies")
      .update({ stage, closed_at: ["Ganho", "Perdido"].includes(stage) ? new Date().toISOString() : null })
      .eq("id", lead.id);
    if (error) {
      flash(error.message);
      await loadData();
      return;
    }
    flash(`Lead movido para ${stage}`);
  };

  const addLead = async (input: NewLeadInput) => {
    const { data, error } = await supabase
      .from("companies")
      .insert({
        name: input.name,
        estimated_value: input.value,
        service_id: input.serviceId || null,
        owner_id: input.ownerId || user.id,
        created_by: user.id,
        source: input.source || "Manual",
      })
      .select("id")
      .single();
    if (error) throw error;
    if (input.contact && data) {
      const { error: contactError } = await supabase.from("contacts").insert({
        company_id: data.id,
        name: input.contact,
        kind: "Responsável",
        is_primary: true,
      });
      if (contactError) throw contactError;
    }
    await loadData();
  };

  if (loading || !profile) return <LoadingScreen />;
  if (profile.role === "client") return <ClientPortal profile={profile} leads={leads} />;

  const visibleNav = profile.role === "super_admin" ? nav : nav.filter((item) => item !== "Equipe");
  const displayName = profile.full_name || profile.email.split("@")[0];

  return (
    <div className="shell">
      <aside>
        <div className="brand"><b>i5</b><span><strong>I5MEDIA</strong><small>Sales Hub</small></span></div>
        <nav>
          {visibleNav.map((item, index) => (
            <button className={page === item ? "active" : ""} onClick={() => setPage(item)} key={item}>
              <i>{["▦", "◎", "▥", "◷", "▤", "♙", "◈", "♚", "◌"][index]}</i>{item}
            </button>
          ))}
        </nav>
        <div className="storage"><span>Supabase <b>Conectado</b></span><progress value="100" max="100"/><small>Banco, login e segurança ativos</small></div>
      </aside>
      <main>
        <header>
          <div className="search">⌕ <input placeholder="Buscar empresa, contato ou CNPJ..."/><kbd>⌘ K</kbd></div>
          <button className="bell" aria-label="Notificações">♢<i/></button>
          <div className="user"><Avatar name={displayName}/><span><b>{displayName}</b><small>{roleName(profile.role)}</small></span></div>
          <button className="logout" onClick={() => supabase.auth.signOut()}>Sair</button>
        </header>
        <section>
          <Title page={page} name={displayName.split(" ")[0]} add={() => setModal("lead")} imp={() => setModal("import")}/>
          {page === "Visão geral" && <Dashboard leads={leads} stats={stats} go={setPage}/>} 
          {page === "Pipeline" && <Pipeline leads={leads} move={moveLead}/>} 
          {page === "Leads" && <LeadList leads={leads}/>} 
          {page === "Follow-ups" && <Follow leads={leads}/>} 
          {page === "Propostas" && <Proposals leads={leads}/>} 
          {page === "Clientes" && <Clients leads={leads.filter((lead) => lead.stage === "Ganho")}/>} 
          {page === "Chamados" && <Tickets/>} 
          {page === "Equipe" && <Team profiles={profiles} onAdd={() => setModal("user")}/>} 
          {page === "Chat interno" && <Chat profile={profile}/>} 
        </section>
      </main>
      <button className="float" onClick={() => setPage("Chat interno")}>◌</button>
      {toast && <div className="toast">✓ {toast}</div>}
      {modal && (
        <Modal close={() => setModal("")}>
          {modal === "import" && <Import done={() => { setModal(""); flash("Planilha pronta para processamento; integração do parser será a próxima etapa."); }}/>} 
          {modal === "lead" && <LeadForm services={services} profiles={profiles} currentUserId={user.id} done={async (input) => { try { await addLead(input); setModal(""); flash("Lead cadastrado no Supabase"); } catch (error: unknown) { flash(errorMessage(error)); } }}/>} 
          {modal === "user" && <UserForm done={() => { setModal(""); loadData(); flash("Usuário criado com acesso seguro"); }}/>} 
        </Modal>
      )}
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
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
      } else if (mode === "register") {
        if (email.toLowerCase() !== ADMIN_EMAIL) throw new Error("O primeiro acesso está reservado ao e-mail do Super Admin.");
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } },
        });
        if (authError) throw authError;
        setMessage(data.session ? "Conta criada e acesso liberado." : "Conta criada. Confirme o e-mail recebido e depois entre no sistema.");
        if (!data.session) setMode("login");
      } else {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (authError) throw authError;
        setMessage("Enviamos um link de recuperação para o seu e-mail.");
      }
    } catch (submitError: unknown) {
      setError(translateAuthError(errorMessage(submitError)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-brand">
        <div className="auth-logo">i5</div>
        <span>I5MEDIA · CRM COMERCIAL</span>
        <h1>Vendas organizadas.<br/>Relacionamentos que crescem.</h1>
        <p>Pipeline, propostas, follow-ups, clientes e equipe em uma única central conectada ao Supabase.</p>
        <div className="auth-status"><i/> Supabase conectado e protegido por RLS</div>
      </section>
      <section className="auth-card">
        <label className="tag">ACESSO SEGURO</label>
        <h2>{mode === "login" ? "Entrar no Sales Hub" : mode === "register" ? "Criar acesso do Super Admin" : "Recuperar senha"}</h2>
        <p>{mode === "register" ? "Não existe senha padrão. Defina uma senha forte e exclusiva." : "Use seu e-mail e senha cadastrados no Supabase."}</p>
        <form onSubmit={submit}>
          {mode === "register" && <label>Nome completo<input value={name} onChange={(event) => setName(event.target.value)} required/></label>}
          <label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required/></label>
          {mode !== "recover" && <label>Senha<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 8 caracteres" required/></label>}
          {error && <div className="auth-error">{error}</div>}
          {message && <div className="auth-success">{message}</div>}
          <button className="primary full" disabled={busy}>{busy ? "Aguarde..." : mode === "login" ? "Entrar" : mode === "register" ? "Criar meu acesso" : "Enviar link"}</button>
        </form>
        <div className="auth-links">
          {mode !== "register" && <button onClick={() => setMode("register")}>Primeiro acesso</button>}
          {mode !== "recover" && <button onClick={() => setMode("recover")}>Esqueci minha senha</button>}
          {mode !== "login" && <button onClick={() => setMode("login")}>Voltar ao login</button>}
        </div>
      </section>
    </main>
  );
}

function translateAuthError(message: string) {
  if (message.includes("Invalid login credentials")) return "E-mail ou senha incorretos.";
  if (message.includes("already registered")) return "Este e-mail já está cadastrado. Use Entrar ou recupere a senha.";
  if (message.includes("Password should")) return "A senha precisa ter pelo menos 8 caracteres.";
  return message;
}

function LoadingScreen() {
  return <main className="loading-screen"><div className="auth-logo">i5</div><span>Conectando ao Sales Hub...</span></main>;
}

function roleName(role: Profile["role"]) {
  return role === "super_admin" ? "Super administrador" : role === "executive" ? "Executivo de vendas" : "Cliente";
}

function Avatar({ name }: { name: string }) {
  return <i className="avatar">{name.split(" ").filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</i>;
}

function Title({ page, name, add, imp }: { page: string; name: string; add: () => void; imp: () => void }) {
  const data: Record<string, [string, string]> = {
    "Visão geral": [`Olá, ${name}! 👋`, "Aqui está o panorama comercial da sua agência hoje."],
    Leads: ["Leads e contatos", "Toda a base comercial da agência em um só lugar."],
    Pipeline: ["Pipeline de vendas", "Acompanhe cada oportunidade até o fechamento."],
    "Follow-ups": ["Follow-ups e agenda", "Nenhuma oportunidade fica esquecida."],
    Propostas: ["Propostas e orçamentos", "Crie, envie e acompanhe propostas comerciais."],
    Clientes: ["Clientes", "Contratos, acessos e relacionamento em um só lugar."],
    Chamados: ["Chamados dos clientes", "Centralize as solicitações após o fechamento."],
    Equipe: ["Equipe comercial", "Cadastre executivos, metas, carteiras e produtividade."],
    "Chat interno": ["Chat interno", "Conversas privadas e canais da equipe."],
  };
  return <div className="title"><div><span>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date()).toUpperCase()}</span><h1>{data[page]?.[0]}</h1><p>{data[page]?.[1]}</p></div>{["Visão geral", "Leads"].includes(page) && <div><button className="ghost" onClick={imp}>⇧ Importar Excel</button><button className="primary" onClick={add}>＋ Novo lead</button></div>}</div>;
}

function Dashboard({ leads, stats, go }: { leads: Lead[]; stats: { active: number; pipeline: number; revenue: number; conversion: number }; go: (page: string) => void }) {
  return <><div className="stats">{[
    ["Leads em tratamento", String(stats.active), "Carteira atual", "◎"],
    ["Pipeline em aberto", money(stats.pipeline), "Valor estimado", "◈"],
    ["Faturamento ganho", money(stats.revenue), "Contratos ganhos", "↗"],
    ["Taxa de conversão", `${stats.conversion.toFixed(1)}%`, "Ganho ÷ encerrados", "⌁"],
  ].map((item, index) => <article key={item[0]}><i className={`stat s${index}`}>{item[3]}</i><span><small>{item[0]}</small><b>{item[1]}</b><em>{item[2]}</em></span></article>)}</div><div className="two"><article className="panel"><Head title="Pipeline por etapa" subtitle="Dados atualizados no Supabase" action="Ver pipeline →" click={() => go("Pipeline")}/><div className="funnel">{stages.map((stage) => { const count = leads.filter((lead) => lead.stage === stage).length; const width = leads.length ? Math.max(8, (count / leads.length) * 100) : 8; return <div key={stage}><span>{stage}</span><b><i style={{ width: `${width}%` }}/></b><em>{count}</em></div>; })}</div></article><article className="panel agenda"><Head title="Próximos follow-ups" subtitle="Agenda da carteira" action="Ver agenda →" click={() => go("Follow-ups")}/>{leads.slice(0, 5).map((lead) => <div key={lead.id}><b>◷</b><i/><span><Pill status="Follow-up"/><strong>{lead.name}</strong><small>{lead.next}</small></span></div>)}</article></div><article className="panel deals recent"><Head title="Negociações recentes" subtitle="Últimas oportunidades da carteira" action="Ver todas →" click={() => go("Leads")}/>{leads.slice(0, 6).map((lead) => <div key={lead.id}><span className="company"><i>{lead.name[0]}</i><b>{lead.name}<small>{lead.service}</small></b></span><Pill status={lead.stage}/><strong>{money(lead.value)}</strong><span className="owner"><Avatar name={lead.owner}/>{lead.owner}</span><small>{lead.next}</small></div>)}</article></>;
}

function Head({ title, subtitle, action, click }: { title: string; subtitle: string; action: string; click?: () => void }) {
  return <div className="head"><span><b>{title}</b><small>{subtitle}</small></span><button onClick={click}>{action}</button></div>;
}

function Pill({ status }: { status: string }) {
  return <span className={`pill ${tone(status)}`}>{status}</span>;
}

function Pipeline({ leads, move }: { leads: Lead[]; move: (lead: Lead, stage: string) => void }) {
  return <div className="kanban">{stages.map((stage, index) => <div key={stage}><h3><i/>{stage}<em>{leads.filter((lead) => lead.stage === stage).length}</em></h3>{leads.filter((lead) => lead.stage === stage).map((lead) => <article key={lead.id}><span className="logo">{lead.name[0]}</span><small>{lead.service}</small><h4>{lead.name}</h4><p>{lead.contact}</p><b>{money(lead.value)}</b><footer><Avatar name={lead.owner}/><span>◷ {lead.next}</span></footer><select value={lead.stage} onChange={(event) => move(lead, event.target.value)}>{stages.map((item) => <option key={item}>{item}</option>)}</select>{index < 5 && <button onClick={() => move(lead, stages[index + 1])}>Avançar →</button>}</article>)}</div>)}</div>;
}

function LeadList({ leads }: { leads: Lead[] }) {
  return <article className="panel table"><header><span>EMPRESA / CONTATO</span><span>SERVIÇO</span><span>ETAPA</span><span>VALOR</span><span>RESPONSÁVEL</span></header>{leads.map((lead) => <div key={lead.id}><span className="company"><i>{lead.name[0]}</i><b>{lead.name}<small>{lead.contact}</small></b></span><span>{lead.service}</span><Pill status={lead.stage}/><strong>{money(lead.value)}</strong><span className="owner"><Avatar name={lead.owner}/>{lead.owner}</span></div>)}</article>;
}

function Follow({ leads }: { leads: Lead[] }) {
  return <div className="follow"><article className="panel"><h2>Próximas atividades <Pill status={`${leads.length} leads`}/></h2>{leads.slice(0, 8).map((lead) => <div key={lead.id}><button>✓</button><span><b>{lead.name}</b><small>Follow-up · {lead.next}</small></span><Avatar name={lead.owner}/></div>)}</article><article className="panel calendar"><h2>Agenda comercial</h2><div>{["D", "S", "T", "Q", "Q", "S", "S", ...Array.from({ length: 31 }, (_, index) => index + 1)].map((day, index) => <span className={day === new Date().getDate() ? "today" : ""} key={index}>{day}</span>)}</div><p><b>Follow-ups rastreados</b><small>Cada atividade fica vinculada à empresa e ao executivo responsável.</small></p></article></div>;
}

function Proposals({ leads }: { leads: Lead[] }) {
  const sent = leads.filter((lead) => ["Proposta enviada", "Negociação", "Ganho"].includes(lead.stage));
  return <><div className="stats compact">{[["Em elaboração", "0"], ["Enviadas", String(sent.length)], ["Aprovadas", String(leads.filter((lead) => lead.stage === "Ganho").length)], ["Aguardando retorno", String(leads.filter((lead) => lead.stage === "Proposta enviada").length)]].map((item, index) => <article key={item[0]}><i className={`stat s${index}`}>▤</i><span><small>{item[0]}</small><b>{item[1]}</b></span></article>)}</div><article className="panel empty-state"><b>Orçamentos conectados ao cadastro</b><p>Os serviços iniciais já estão cadastrados no Supabase. A criação do PDF será liberada na próxima evolução da tela.</p></article></>;
}

function Clients({ leads }: { leads: Lead[] }) {
  if (!leads.length) return <article className="panel empty-state"><b>Nenhum contrato ganho ainda</b><p>Ao mover uma negociação para “Ganho”, ela aparecerá aqui para gerar o acesso do cliente.</p></article>;
  return <div className="cards">{leads.map((lead) => <article className="panel" key={lead.id}><div><i>{lead.name[0]}</i><Pill status="Ativo"/></div><h2>{lead.name}</h2><p>{lead.service}</p><strong>{money(lead.value)}</strong><hr/><small>Executivo responsável</small><b className="owner"><Avatar name={lead.owner}/>{lead.owner}</b><button>Abrir ficha do cliente →</button></article>)}</div>;
}

function Tickets() {
  return <article className="panel empty-state"><b>Central de chamados pronta</b><p>Clientes autenticados podem abrir chamados vinculados à própria empresa; a equipe visualiza conforme as permissões do Supabase.</p></article>;
}

function Team({ profiles, onAdd }: { profiles: Profile[]; onAdd: () => void }) {
  return <><div className="section-actions"><button className="primary" onClick={onAdd}>＋ Cadastrar executivo</button></div><div className="cards team">{profiles.filter((profile) => profile.role !== "client").map((profile) => <article className="panel" key={profile.id}><Avatar name={profile.full_name || profile.email}/><h2>{profile.full_name || "Sem nome"}</h2><p>{roleName(profile.role)}</p><div><span>Status<b>{profile.active ? "Ativo" : "Inativo"}</b></span><span>Carteira<b>Rastreada</b></span><span>Acesso<b>Seguro</b></span></div><small>{profile.email}</small><button>Ver desempenho</button></article>)}</div></>;
}

function Chat({ profile }: { profile: Profile }) {
  const [messages, setMessages] = useState<{ id: string; body: string; sender_id: string; created_at: string }[]>([]);
  const [value, setValue] = useState("");

  const loadMessages = useCallback(async () => {
    const { data } = await supabase.from("team_messages").select("id,body,sender_id,created_at").eq("channel", "geral").eq("is_private", false).order("created_at").limit(100);
    setMessages(data ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMessages(), 0);
    const channel = supabase.channel("team-chat").on("postgres_changes", { event: "INSERT", schema: "public", table: "team_messages" }, () => loadMessages()).subscribe();
    return () => { window.clearTimeout(timer); supabase.removeChannel(channel); };
  }, [loadMessages]);

  const send = async () => {
    const body = value.trim();
    if (!body) return;
    const { error } = await supabase.from("team_messages").insert({ sender_id: profile.id, channel: "geral", body, is_private: false });
    if (!error) { setValue(""); await loadMessages(); }
  };

  return <div className="chat"><aside className="panel"><h3>CANAIS</h3><button className="selected"># Geral</button><button># Comercial</button><button># Projetos</button><h3>MENSAGENS DIRETAS</h3><small>Conversas privadas protegidas por RLS</small></aside><article className="panel"><header><b># Geral</b><small>Canal interno da equipe</small></header><main>{messages.length ? messages.map((message) => <div key={message.id}><Avatar name={message.sender_id === profile.id ? profile.full_name : "Equipe"}/><p><b>{message.sender_id === profile.id ? "Você" : "Equipe"}</b>{message.body}</p></div>) : <div className="empty-chat">Envie a primeira mensagem para a equipe.</div>}</main><footer><input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder="Escreva uma mensagem..."/><button onClick={send}>➤</button></footer></article></div>;
}

function ClientPortal({ profile, leads }: { profile: Profile; leads: Lead[] }) {
  const company = leads[0];
  return <main className="client-portal"><header><div className="brand"><b>i5</b><span><strong>I5MEDIA</strong><small>Portal do cliente</small></span></div><div className="user"><Avatar name={profile.full_name || profile.email}/><span><b>{profile.full_name || profile.email}</b><small>Cliente</small></span></div><button className="logout" onClick={() => supabase.auth.signOut()}>Sair</button></header><section><label className="tag">ÁREA DO CLIENTE</label><h1>{company?.name ?? "Bem-vindo ao portal"}</h1><p>Acompanhe contrato, propostas e chamados em um ambiente seguro.</p><div className="client-grid"><article className="panel"><i>▤</i><h2>Contrato e documentos</h2><p>PDFs anexados à sua empresa aparecerão aqui.</p><button>Acessar documentos</button></article><article className="panel"><i>◈</i><h2>Abrir chamado</h2><p>Fale com o executivo responsável pelo atendimento.</p><button>Novo chamado</button></article><article className="panel"><i>♙</i><h2>Seu executivo</h2><p>{company?.owner ?? "A equipe I5Media"}</p><button>Iniciar conversa</button></article></div></section></main>;
}

function Modal({ children, close }: { children: ReactNode; close: () => void }) {
  return <div className="back" onMouseDown={close}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><button className="x" onClick={close}>×</button>{children}</div></div>;
}

function Import({ done }: { done: () => void }) {
  return <><label className="tag">IMPORTAÇÃO INTELIGENTE</label><h2>Carregar contatos do Excel</h2><p>Envie XLSX ou CSV. Duplicidades serão identificadas automaticamente.</p><label className="drop">⇧<b>Arraste sua planilha aqui</b><small>ou clique para selecionar · até 10 MB</small><input type="file" accept=".xlsx,.xls,.csv"/></label><div className="radios"><b>Como distribuir os leads?</b><label><input type="radio" name="distribution" defaultChecked/> Escolher manualmente</label><label><input type="radio" name="distribution"/> Distribuição automática e equilibrada</label></div><button className="primary full" onClick={done}>Processar planilha</button></>;
}

type NewLeadInput = { name: string; contact: string; serviceId: string; ownerId: string; value: number; source: string };

function LeadForm({ services, profiles, currentUserId, done }: { services: Service[]; profiles: Profile[]; currentUserId: string; done: (input: NewLeadInput) => Promise<void> }) {
  const [form, setForm] = useState<NewLeadInput>({ name: "", contact: "", serviceId: services[0]?.id ?? "", ownerId: currentUserId, value: 0, source: "Manual" });
  const [busy, setBusy] = useState(false);
  const submit = async () => { if (!form.name) return; setBusy(true); try { await done(form); } finally { setBusy(false); } };
  return <><label className="tag">NOVO CADASTRO</label><h2>Adicionar lead</h2><p>O lead será salvo e rastreado no Supabase.</p><label>Empresa<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nome da empresa"/></label><div className="form"><label>Contato principal<input value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} placeholder="Nome completo"/></label><label>Executivo<select value={form.ownerId} onChange={(event) => setForm({ ...form, ownerId: event.target.value })}>{profiles.filter((item) => item.role !== "client" && item.active).map((item) => <option value={item.id} key={item.id}>{item.full_name || item.email}</option>)}</select></label><label>Serviço<select value={form.serviceId} onChange={(event) => setForm({ ...form, serviceId: event.target.value })}>{services.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select></label><label>Valor estimado<input type="number" min="0" value={form.value} onChange={(event) => setForm({ ...form, value: Number(event.target.value) })}/></label><label>Origem<select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}><option>Manual</option><option>Indicação</option><option>Site</option><option>Instagram</option><option>Google</option><option>Prospecção</option></select></label></div><button className="primary full" disabled={busy} onClick={submit}>{busy ? "Salvando..." : "Cadastrar lead"}</button></>;
}

function UserForm({ done }: { done: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true); setError("");
    const { error: invokeError } = await supabase.functions.invoke("admin-create-user", { body: { full_name: fullName, email, password, role: "executive" } });
    setBusy(false);
    if (invokeError) { setError(invokeError.message); return; }
    done();
  };
  return <><label className="tag">EQUIPE COMERCIAL</label><h2>Cadastrar executivo</h2><p>Crie um acesso individual para rastrear cada lead trabalhado.</p><label>Nome completo<input value={fullName} onChange={(event) => setFullName(event.target.value)} required/></label><label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required/></label><label>Senha temporária<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 8 caracteres" required/></label>{error && <div className="auth-error">{error}</div>}<button className="primary full" onClick={submit} disabled={busy || !fullName || !email || password.length < 8}>{busy ? "Criando..." : "Criar acesso seguro"}</button></>;
}
