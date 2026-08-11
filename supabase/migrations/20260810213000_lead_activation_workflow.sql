alter table public.companies
  add column if not exists is_activated boolean not null default true,
  add column if not exists activated_at timestamptz,
  add column if not exists activated_by uuid references public.profiles(id) on delete set null;

update public.companies
set activated_at = coalesce(activated_at, created_at),
    activated_by = coalesce(activated_by, created_by)
where is_activated;

create index if not exists companies_owner_activation_stage_idx
  on public.companies (owner_id, is_activated, stage);

comment on column public.companies.is_activated is
  'False while an imported lead is waiting for the assigned executive to make the first contact and choose its Kanban stage.';

comment on column public.companies.activated_at is
  'Date and time when the lead entered the active commercial pipeline.';

comment on column public.companies.activated_by is
  'Staff member who activated the imported lead in the commercial pipeline.';
