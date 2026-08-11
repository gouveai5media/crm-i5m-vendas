alter table public.profiles
  add column if not exists must_change_password boolean not null default false,
  add column if not exists invited_at timestamptz,
  add column if not exists invited_by uuid references public.profiles(id) on delete set null;

alter table public.companies
  add column if not exists client_invited_at timestamptz,
  add column if not exists client_invited_by uuid references public.profiles(id) on delete set null;

create index if not exists profiles_invited_by_idx on public.profiles (invited_by);
create index if not exists companies_client_invited_by_idx on public.companies (client_invited_by);

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

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_super_admin())
    or (select private.is_staff())
    or exists (
      select 1
      from public.companies c
      where c.client_user_id = (select auth.uid())
        and c.owner_id = profiles.id
    )
  );

create or replace function public.complete_first_access()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida';
  end if;

  update public.profiles
  set must_change_password = false,
      updated_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.complete_first_access() from public;
revoke all on function public.complete_first_access() from anon;
grant execute on function public.complete_first_access() to authenticated;

drop policy if exists team_messages_insert on public.team_messages;
create policy team_messages_insert on public.team_messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (
      (select private.is_staff())
      or exists (
        select 1
        from public.companies c
        where c.id = company_id
          and c.client_user_id = (select auth.uid())
          and is_private
          and recipient_id is not null
          and (
            recipient_id = c.owner_id
            or exists (
              select 1
              from public.profiles recipient
              where recipient.id = recipient_id
                and recipient.role = 'super_admin'
                and recipient.active
            )
          )
      )
    )
  );

update storage.buckets
set public = false,
    file_size_limit = 20971520,
    allowed_mime_types = array[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
where id = 'contracts';

comment on column public.profiles.must_change_password is
  'True for invited users until they create and confirm their personal password.';

comment on column public.companies.client_invited_at is
  'Date and time when the most recent client portal invitation was sent.';
