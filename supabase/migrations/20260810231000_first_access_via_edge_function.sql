revoke all on function public.complete_first_access() from public;
revoke all on function public.complete_first_access() from anon;
revoke all on function public.complete_first_access() from authenticated;
drop function if exists public.complete_first_access();
