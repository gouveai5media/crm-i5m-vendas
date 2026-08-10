revoke all on function public.rls_auto_enable() from public;
revoke all on function public.rls_auto_enable() from anon;
revoke all on function public.rls_auto_enable() from authenticated;

create index companies_created_by_idx on public.companies (created_by);
create index company_stage_history_changed_by_idx on public.company_stage_history (changed_by);
create index documents_uploaded_by_idx on public.documents (uploaded_by);
create index followups_created_by_idx on public.followups (created_by);
create index import_batches_created_by_idx on public.import_batches (created_by);
create index proposal_items_service_id_idx on public.proposal_items (service_id);
create index proposals_created_by_idx on public.proposals (created_by);
create index team_messages_company_id_idx on public.team_messages (company_id);
create index team_messages_sender_id_idx on public.team_messages (sender_id);
create index ticket_messages_sender_id_idx on public.ticket_messages (sender_id);
create index tickets_opened_by_idx on public.tickets (opened_by);

alter policy tickets_insert on public.tickets
  with check (
    exists (select 1 from public.companies c where c.id = company_id)
    and ((select private.is_staff()) or opened_by = (select auth.uid()))
  );
