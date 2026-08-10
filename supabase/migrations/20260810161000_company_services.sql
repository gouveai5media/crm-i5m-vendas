alter table public.companies
  add column service_id uuid references public.services(id) on delete set null;

create index companies_service_id_idx on public.companies (service_id);

update public.companies c
set service_id = s.id
from public.services s
where s.name = case c.name
  when 'Forro Novo' then 'Tráfego pago'
  when 'IntegraCare MV' then 'Sites e lojas virtuais'
  when 'IMUNA Blindagens' then 'Sistemas e aplicativos'
  when 'FM Personalizados' then 'Identidade visual e conteúdo'
  when 'Deubom Sports' then 'Sistemas e aplicativos'
  when 'Thiago Consultoria' then 'Sites e lojas virtuais'
end;
