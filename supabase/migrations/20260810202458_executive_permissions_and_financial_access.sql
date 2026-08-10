alter table public.profiles
  add column menu_permissions text[] not null default '{}'::text[],
  add column can_view_revenue boolean not null default false;

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
      'Chat interno'
    ]::text[]
  );

comment on column public.profiles.menu_permissions is
  'Menus do CRM visíveis para o usuário. Super administradores ignoram esta restrição.';

comment on column public.profiles.can_view_revenue is
  'Autoriza a leitura de valores do pipeline, faturamento e contratos.';
