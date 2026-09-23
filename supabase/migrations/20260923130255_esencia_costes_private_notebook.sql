-- Additive schema: does not modify TPV objects or global auth settings.
create table public.esencia_costes_documents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  document jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint esencia_costes_document_shape check (
    coalesce(jsonb_typeof(document) = 'object'
    and document->>'version' = '2'
    and jsonb_typeof(document->'ingredients') = 'array'
    and jsonb_typeof(document->'recipes') = 'array'
    and jsonb_typeof(document->'products') = 'array'
    and octet_length(document::text) <= 4000000, false)
  )
);

alter table public.esencia_costes_documents enable row level security;
revoke all on public.esencia_costes_documents from anon, authenticated;
grant select, update on public.esencia_costes_documents to authenticated;

-- A notebook is provisioned by an administrator. Other existing TPV users
-- cannot create a notebook or access someone else's notebook.
create policy esencia_costes_select_own on public.esencia_costes_documents
  for select to authenticated using ((select auth.uid()) = user_id);
create policy esencia_costes_update_own on public.esencia_costes_documents
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create function public.esencia_costes_save(p_document jsonb, p_expected_revision bigint)
returns setof public.esencia_costes_documents
language plpgsql security invoker set search_path = ''
as $$
declare saved public.esencia_costes_documents;
begin
  if auth.uid() is null then
    raise exception 'ESENCIA_ACCESS' using errcode = '42501';
  end if;
  if not exists (select 1 from public.esencia_costes_documents d where d.user_id = auth.uid()) then
    raise exception 'ESENCIA_ACCESS' using errcode = '42501';
  end if;
  -- UPDATE takes the row lock and rechecks the revision after competing writes.
  update public.esencia_costes_documents d
  set document = p_document, revision = d.revision + 1, updated_at = clock_timestamp()
  where d.user_id = auth.uid() and d.revision = p_expected_revision
  returning d.* into saved;
  if not found then
    raise exception 'ESENCIA_CONFLICT' using errcode = '40001';
  end if;
  return next saved;
end;
$$;
revoke all on function public.esencia_costes_save(jsonb, bigint) from public, anon;
grant execute on function public.esencia_costes_save(jsonb, bigint) to authenticated;
comment on table public.esencia_costes_documents is 'Private kitchen notebook. Independent of TPV tables. Owner-only RLS and optimistic revision checks.';
