-- WhatsApp multiattendance foundation for the existing I5Media CRM.
-- Credentials are stored in Supabase Vault by backend Edge Functions only.

alter table public.profiles
  drop constraint if exists profiles_menu_permissions_check;

alter table public.profiles
  add constraint profiles_menu_permissions_check
  check (
    menu_permissions <@ array[
      'Visão geral',
      'Leads',
      'Pipeline',
      'Follow-ups',
      'Reuniões',
      'Propostas',
      'Clientes',
      'Chamados',
      'WhatsApp',
      'Chat interno'
    ]::text[]
  );

create table public.whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'drope'
    check (provider in ('drope', 'meta_cloud', 'other')),
  status text not null default 'not_configured'
    check (status in ('not_configured', 'configured', 'connected', 'disconnected', 'error')),
  device_name text,
  api_key_secret_id uuid,
  device_token_secret_id uuid,
  masked_identifier text,
  webhook_secret_hash text,
  last_tested_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider)
);

create table public.whatsapp_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.whatsapp_queues (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.whatsapp_departments(id) on delete restrict,
  name text not null,
  slug text not null unique,
  distribution_type text not null default 'manual'
    check (distribution_type in ('manual', 'round_robin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name)
);

create table public.whatsapp_agent_queues (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  queue_id uuid not null references public.whatsapp_queues(id) on delete cascade,
  receives_new_conversations boolean not null default true,
  max_simultaneous_conversations integer not null default 10
    check (max_simultaneous_conversations between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (profile_id, queue_id)
);

create table public.whatsapp_agent_states (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'offline'
    check (status in ('online', 'busy', 'away', 'offline')),
  auto_distribution boolean not null default true,
  max_simultaneous_conversations integer not null default 10
    check (max_simultaneous_conversations between 1 and 100),
  sound_enabled boolean not null default true,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.whatsapp_settings (
  id smallint primary key default 1 check (id = 1),
  triage_timeout_minutes integer not null default 10
    check (triage_timeout_minutes in (5, 10, 15, 30)),
  reopen_last_assignee boolean not null default true,
  initial_message text not null default E'Olá! Seja bem-vindo(a). Para direcionarmos seu atendimento, escolha uma opção:\n\n1 - Quero solicitar um orçamento\n2 - Preciso de suporte\n3 - Quero falar com o financeiro\n\nSe preferir, pode escrever o que precisa.',
  general_fallback_message text not null default 'Vou encaminhar você para nosso Atendimento Geral. Um atendente continuará por aqui.',
  ai_enabled boolean not null default false,
  ai_name text not null default 'Assistente I5Media',
  ai_instructions text,
  ai_max_questions integer not null default 5 check (ai_max_questions between 1 and 20),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.whatsapp_connections(id) on delete restrict,
  remote_jid text not null,
  normalized_phone text,
  company_id uuid references public.companies(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  department_id uuid references public.whatsapp_departments(id) on delete set null,
  queue_id uuid references public.whatsapp_queues(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  last_assigned_to uuid references public.profiles(id) on delete set null,
  status text not null default 'triage'
    check (status in ('triage', 'queued', 'open', 'waiting_customer', 'closed')),
  ai_active boolean not null default false,
  last_message text,
  last_message_at timestamptz,
  unread_count integer not null default 0 check (unread_count >= 0),
  triage_deadline_at timestamptz,
  waiting_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (connection_id, remote_jid)
);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  external_message_id text,
  direction text not null check (direction in ('incoming', 'outgoing')),
  sender_type text not null check (sender_type in ('customer', 'agent', 'ai', 'system')),
  sender_profile_id uuid references public.profiles(id) on delete set null,
  message_type text not null default 'text'
    check (message_type in ('text', 'image', 'audio', 'video', 'document', 'internal_note', 'other')),
  text text,
  media_url text,
  media_mime_type text,
  file_name text,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'delivered', 'read', 'failed', 'received')),
  is_internal boolean not null default false,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (not is_internal or message_type = 'internal_note')
);

create unique index whatsapp_messages_external_id_uidx
  on public.whatsapp_messages (conversation_id, external_message_id)
  where external_message_id is not null;

create table public.whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.whatsapp_connections(id) on delete set null,
  provider text not null,
  event_type text not null default 'unknown',
  external_id text,
  event_fingerprint text not null unique,
  payload jsonb not null,
  processed boolean not null default false,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index whatsapp_webhook_events_external_uidx
  on public.whatsapp_webhook_events (provider, external_id)
  where external_id is not null;

create table public.whatsapp_conversation_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.whatsapp_queue_state (
  queue_id uuid primary key references public.whatsapp_queues(id) on delete cascade,
  last_assigned_profile_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index whatsapp_connections_created_by_idx on public.whatsapp_connections (created_by);
create index whatsapp_connections_updated_by_idx on public.whatsapp_connections (updated_by);
create index whatsapp_queues_department_id_idx on public.whatsapp_queues (department_id);
create index whatsapp_agent_queues_profile_id_idx on public.whatsapp_agent_queues (profile_id);
create index whatsapp_agent_queues_queue_active_idx on public.whatsapp_agent_queues (queue_id, active, receives_new_conversations);
create index whatsapp_conversations_company_id_idx on public.whatsapp_conversations (company_id);
create index whatsapp_conversations_contact_id_idx on public.whatsapp_conversations (contact_id);
create index whatsapp_conversations_department_id_idx on public.whatsapp_conversations (department_id);
create index whatsapp_conversations_assigned_status_idx on public.whatsapp_conversations (assigned_to, status, last_message_at desc);
create index whatsapp_conversations_queue_status_idx on public.whatsapp_conversations (queue_id, status, last_message_at desc);
create index whatsapp_conversations_unassigned_idx on public.whatsapp_conversations (queue_id, last_message_at desc)
  where assigned_to is null and status in ('triage', 'queued');
create index whatsapp_conversations_triage_deadline_idx on public.whatsapp_conversations (triage_deadline_at)
  where status = 'triage';
create index whatsapp_messages_conversation_created_idx on public.whatsapp_messages (conversation_id, created_at desc, id);
create index whatsapp_messages_pending_idx on public.whatsapp_messages (created_at)
  where direction = 'outgoing' and status = 'pending';
create index whatsapp_webhook_events_pending_idx on public.whatsapp_webhook_events (received_at)
  where not processed;
create index whatsapp_conversation_events_conversation_created_idx on public.whatsapp_conversation_events (conversation_id, created_at desc);

create trigger whatsapp_connections_set_updated_at
  before update on public.whatsapp_connections
  for each row execute procedure private.set_updated_at();
create trigger whatsapp_departments_set_updated_at
  before update on public.whatsapp_departments
  for each row execute procedure private.set_updated_at();
create trigger whatsapp_queues_set_updated_at
  before update on public.whatsapp_queues
  for each row execute procedure private.set_updated_at();
create trigger whatsapp_agent_states_set_updated_at
  before update on public.whatsapp_agent_states
  for each row execute procedure private.set_updated_at();
create trigger whatsapp_settings_set_updated_at
  before update on public.whatsapp_settings
  for each row execute procedure private.set_updated_at();
create trigger whatsapp_conversations_set_updated_at
  before update on public.whatsapp_conversations
  for each row execute procedure private.set_updated_at();
create trigger whatsapp_queue_state_set_updated_at
  before update on public.whatsapp_queue_state
  for each row execute procedure private.set_updated_at();

create or replace function private.can_access_whatsapp_queue(target_queue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      (select private.is_super_admin())
      or exists (
        select 1
        from public.whatsapp_agent_queues aq
        join public.profiles p on p.id = aq.profile_id
        where aq.queue_id = target_queue_id
          and aq.profile_id = (select auth.uid())
          and aq.active
          and p.active
          and p.role = 'executive'
      )
    );
$$;

create or replace function private.can_access_whatsapp_conversation(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      (select private.is_super_admin())
      or exists (
        select 1
        from public.whatsapp_conversations c
        join public.profiles p on p.id = (select auth.uid())
        where c.id = target_conversation_id
          and p.active
          and p.role = 'executive'
          and (
            c.assigned_to = (select auth.uid())
            or (
              c.queue_id is not null
              and exists (
                select 1
                from public.whatsapp_agent_queues aq
                where aq.queue_id = c.queue_id
                  and aq.profile_id = (select auth.uid())
                  and aq.active
              )
            )
          )
      )
    );
$$;

revoke all on function private.can_access_whatsapp_queue(uuid) from public, anon;
revoke all on function private.can_access_whatsapp_conversation(uuid) from public, anon;
grant execute on function private.can_access_whatsapp_queue(uuid) to authenticated;
grant execute on function private.can_access_whatsapp_conversation(uuid) to authenticated;

alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_departments enable row level security;
alter table public.whatsapp_queues enable row level security;
alter table public.whatsapp_agent_queues enable row level security;
alter table public.whatsapp_agent_states enable row level security;
alter table public.whatsapp_settings enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_webhook_events enable row level security;
alter table public.whatsapp_conversation_events enable row level security;
alter table public.whatsapp_queue_state enable row level security;

revoke all on public.whatsapp_connections from anon;
revoke all on public.whatsapp_departments from anon;
revoke all on public.whatsapp_queues from anon;
revoke all on public.whatsapp_agent_queues from anon;
revoke all on public.whatsapp_agent_states from anon;
revoke all on public.whatsapp_settings from anon;
revoke all on public.whatsapp_conversations from anon;
revoke all on public.whatsapp_messages from anon;
revoke all on public.whatsapp_webhook_events from anon;
revoke all on public.whatsapp_conversation_events from anon;
revoke all on public.whatsapp_queue_state from anon;

grant select, insert, update, delete on public.whatsapp_connections to authenticated;
grant select, insert, update, delete on public.whatsapp_departments to authenticated;
grant select, insert, update, delete on public.whatsapp_queues to authenticated;
grant select, insert, update, delete on public.whatsapp_agent_queues to authenticated;
grant select, insert, update, delete on public.whatsapp_agent_states to authenticated;
grant select, update on public.whatsapp_settings to authenticated;
grant select, insert, update on public.whatsapp_conversations to authenticated;
grant select, insert on public.whatsapp_messages to authenticated;
grant select on public.whatsapp_webhook_events to authenticated;
grant select, insert on public.whatsapp_conversation_events to authenticated;
grant select on public.whatsapp_queue_state to authenticated;

create policy whatsapp_connections_admin_select on public.whatsapp_connections
  for select to authenticated using ((select private.is_super_admin()));
create policy whatsapp_connections_admin_insert on public.whatsapp_connections
  for insert to authenticated with check ((select private.is_super_admin()));
create policy whatsapp_connections_admin_update on public.whatsapp_connections
  for update to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));
create policy whatsapp_connections_admin_delete on public.whatsapp_connections
  for delete to authenticated using ((select private.is_super_admin()));

create policy whatsapp_departments_staff_select on public.whatsapp_departments
  for select to authenticated using ((select private.is_staff()));
create policy whatsapp_departments_admin_insert on public.whatsapp_departments
  for insert to authenticated with check ((select private.is_super_admin()));
create policy whatsapp_departments_admin_update on public.whatsapp_departments
  for update to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));
create policy whatsapp_departments_admin_delete on public.whatsapp_departments
  for delete to authenticated using ((select private.is_super_admin()));

create policy whatsapp_queues_staff_select on public.whatsapp_queues
  for select to authenticated using ((select private.is_staff()));
create policy whatsapp_queues_admin_insert on public.whatsapp_queues
  for insert to authenticated with check ((select private.is_super_admin()));
create policy whatsapp_queues_admin_update on public.whatsapp_queues
  for update to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));
create policy whatsapp_queues_admin_delete on public.whatsapp_queues
  for delete to authenticated using ((select private.is_super_admin()));

create policy whatsapp_agent_queues_select on public.whatsapp_agent_queues
  for select to authenticated
  using ((select private.is_super_admin()) or profile_id = (select auth.uid()));
create policy whatsapp_agent_queues_admin_insert on public.whatsapp_agent_queues
  for insert to authenticated with check ((select private.is_super_admin()));
create policy whatsapp_agent_queues_admin_update on public.whatsapp_agent_queues
  for update to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));
create policy whatsapp_agent_queues_admin_delete on public.whatsapp_agent_queues
  for delete to authenticated using ((select private.is_super_admin()));

create policy whatsapp_agent_states_staff_select on public.whatsapp_agent_states
  for select to authenticated using ((select private.is_staff()));
create policy whatsapp_agent_states_insert on public.whatsapp_agent_states
  for insert to authenticated
  with check ((select private.is_super_admin()) or profile_id = (select auth.uid()));
create policy whatsapp_agent_states_update on public.whatsapp_agent_states
  for update to authenticated
  using ((select private.is_super_admin()) or profile_id = (select auth.uid()))
  with check ((select private.is_super_admin()) or profile_id = (select auth.uid()));
create policy whatsapp_agent_states_admin_delete on public.whatsapp_agent_states
  for delete to authenticated using ((select private.is_super_admin()));

create policy whatsapp_settings_staff_select on public.whatsapp_settings
  for select to authenticated using ((select private.is_staff()));
create policy whatsapp_settings_admin_update on public.whatsapp_settings
  for update to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

create policy whatsapp_conversations_select on public.whatsapp_conversations
  for select to authenticated
  using ((select private.can_access_whatsapp_conversation(id)));
create policy whatsapp_conversations_admin_insert on public.whatsapp_conversations
  for insert to authenticated with check ((select private.is_super_admin()));
create policy whatsapp_conversations_update on public.whatsapp_conversations
  for update to authenticated
  using ((select private.can_access_whatsapp_conversation(id)))
  with check (
    (select private.is_super_admin())
    or assigned_to = (select auth.uid())
    or (assigned_to is null and queue_id is not null and (select private.can_access_whatsapp_queue(queue_id)))
  );

create policy whatsapp_messages_select on public.whatsapp_messages
  for select to authenticated
  using ((select private.can_access_whatsapp_conversation(conversation_id)));
create policy whatsapp_messages_agent_insert on public.whatsapp_messages
  for insert to authenticated
  with check (
    (select private.is_staff())
    and sender_profile_id = (select auth.uid())
    and sender_type = 'agent'
    and direction = 'outgoing'
    and (select private.can_access_whatsapp_conversation(conversation_id))
  );

create policy whatsapp_webhook_events_admin_select on public.whatsapp_webhook_events
  for select to authenticated using ((select private.is_super_admin()));

create policy whatsapp_conversation_events_select on public.whatsapp_conversation_events
  for select to authenticated
  using ((select private.can_access_whatsapp_conversation(conversation_id)));
create policy whatsapp_conversation_events_agent_insert on public.whatsapp_conversation_events
  for insert to authenticated
  with check (
    (select private.is_staff())
    and profile_id = (select auth.uid())
    and (select private.can_access_whatsapp_conversation(conversation_id))
  );

create policy whatsapp_queue_state_admin_select on public.whatsapp_queue_state
  for select to authenticated using ((select private.is_super_admin()));

insert into public.whatsapp_departments (name, slug, description) values
  ('Comercial', 'comercial', 'Orçamentos, novos projetos e oportunidades comerciais.'),
  ('Suporte', 'suporte', 'Dúvidas técnicas e problemas em serviços ativos.'),
  ('Financeiro', 'financeiro', 'Pagamentos, cobranças e assuntos financeiros.'),
  ('Atendimento Geral', 'atendimento-geral', 'Fallback obrigatório para atendimentos sem classificação.')
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    active = true;

insert into public.whatsapp_queues (department_id, name, slug, distribution_type)
select id, name, slug, 'manual'
from public.whatsapp_departments
where slug in ('comercial', 'suporte', 'financeiro', 'atendimento-geral')
on conflict (slug) do update
set department_id = excluded.department_id,
    name = excluded.name,
    active = true;

insert into public.whatsapp_settings (id)
values (1)
on conflict (id) do nothing;

comment on table public.whatsapp_connections is 'Provider metadata only. API keys and device tokens live in Supabase Vault.';
comment on column public.whatsapp_connections.api_key_secret_id is 'Reference to a Supabase Vault secret. Never expose or return the decrypted value.';
comment on table public.whatsapp_webhook_events is 'Raw idempotent webhook inbox. Payload access is restricted to Super Admin.';
