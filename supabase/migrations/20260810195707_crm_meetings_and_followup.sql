alter table public.companies
  drop constraint if exists companies_stage_check;

alter table public.companies
  add constraint companies_stage_check
  check (stage in (
    'Novo lead',
    'Primeiro contato',
    'Follow-up',
    'Reunião marcada',
    'Proposta enviada',
    'Negociação',
    'Ganho',
    'Perdido'
  ));

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  executive_id uuid not null references public.profiles(id) on delete restrict,
  scheduled_at timestamptz not null,
  status text not null default 'Agendada'
    check (status in ('Agendada', 'Concluída', 'Não compareceu', 'Reagendada', 'Cancelada')),
  connected boolean,
  notes text,
  rescheduled_from uuid references public.meetings(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'Concluída' and connected is not null)
    or (status <> 'Concluída')
  )
);

create index meetings_company_id_idx on public.meetings (company_id);
create index meetings_executive_scheduled_idx on public.meetings (executive_id, scheduled_at);
create index meetings_status_scheduled_idx on public.meetings (status, scheduled_at);
create index meetings_created_by_idx on public.meetings (created_by);
create index meetings_rescheduled_from_idx on public.meetings (rescheduled_from);

create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute procedure private.set_updated_at();

alter table public.meetings enable row level security;

revoke all on public.meetings from anon;
grant select, insert, update, delete on public.meetings to authenticated;

create policy meetings_select on public.meetings
  for select to authenticated
  using (
    (select private.is_super_admin())
    or executive_id = (select auth.uid())
    or exists (
      select 1
      from public.companies c
      where c.id = company_id
        and c.owner_id = (select auth.uid())
    )
  );

create policy meetings_insert on public.meetings
  for insert to authenticated
  with check (
    (select private.is_staff())
    and (
      (select private.is_super_admin())
      or executive_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.companies c
      where c.id = company_id
        and (
          (select private.is_super_admin())
          or c.owner_id = (select auth.uid())
        )
    )
  );

create policy meetings_update on public.meetings
  for update to authenticated
  using (
    (select private.is_super_admin())
    or executive_id = (select auth.uid())
  )
  with check (
    (select private.is_super_admin())
    or executive_id = (select auth.uid())
  );

create policy meetings_delete on public.meetings
  for delete to authenticated
  using ((select private.is_super_admin()));

create index followups_due_at_idx on public.followups (due_at);
create index followups_completed_due_idx on public.followups (completed_at, due_at);
