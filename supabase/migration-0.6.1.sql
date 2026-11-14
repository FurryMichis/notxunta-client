-- =====================================================================
-- NotXunta Client 0.6.1 · estado «en línea» entre amigos + Archivos NotXunta
-- Pégalo entero en: Supabase → SQL Editor → New query → Run
-- Se puede ejecutar varias veces sin problema. Requiere haber ejecutado antes schema.sql (y migration-0.5.6.sql).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Estado «en línea»
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists show_online boolean not null default true;   -- ¿dejo que mis amigos vean cuándo estoy conectado?
alter table public.profiles add column if not exists last_seen timestamptz;

-- La app llama a esto cada ~45 s mientras está abierta (solo si el usuario permite mostrar su estado).
create or replace function public.heartbeat()
returns void language sql security definer set search_path = public as $$
  update public.profiles set last_seen = now() where id = auth.uid() and show_online;
$$;

-- Al cerrar sesión o desactivar el estado: desaparece al instante.
create or replace function public.go_offline()
returns void language sql security definer set search_path = public as $$
  update public.profiles set last_seen = null where id = auth.uid();
$$;

-- list_friends ahora también devuelve si el amigo está en línea y cuándo se le vio por última vez.
-- Solo lo ve quien ya es su amigo (status = 'accepted') y solo si él lo permite.
drop function if exists public.list_friends();
create function public.list_friends()
returns table (friendship_id bigint, other_id uuid, username text, display_name text, status text, i_requested boolean, avatar text,
               online boolean, last_seen timestamptz)
language sql stable security definer set search_path = public as $$
  select f.id, p.id, p.username, p.display_name, f.status, (f.requester = auth.uid()), p.avatar,
         coalesce(f.status = 'accepted' and p.show_online and p.last_seen > now() - interval '2 minutes', false),
         case when f.status = 'accepted' and p.show_online then p.last_seen else null end
  from public.friendships f
  join public.profiles p on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
  where auth.uid() in (f.requester, f.addressee)
  order by f.created_at desc;
$$;

-- ---------------------------------------------------------------------
-- 2) Archivos NotXunta (almacenados en tu cuenta, visibles desde cualquier ordenador)
--    Límites: cámbialos aquí si quieres (en bytes). La app los lee del servidor, no hace falta recompilar.
-- ---------------------------------------------------------------------
create or replace function public.nx_quota()    returns bigint language sql immutable as $$ select 104857600::bigint $$;  -- 100 MB por cuenta
create or replace function public.nx_max_file() returns bigint language sql immutable as $$ select 26214400::bigint $$;   -- 25 MB por archivo

-- Nombres de los archivos (el contenido va al Storage, en el bucket privado «nx-files»)
create table if not exists public.nx_files (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 180),
  mime text not null default '' check (char_length(mime) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists nx_files_user on public.nx_files (user_id, created_at desc);
alter table public.nx_files enable row level security;

-- Espacio usado por quien llama (suma del tamaño REAL de sus objetos en el Storage)
create or replace function public.nx_used_me()
returns bigint language sql stable security definer set search_path = public, storage as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from storage.objects o
  where o.bucket_id = 'nx-files' and (storage.foldername(o.name))[1] = auth.uid()::text;
$$;

drop policy if exists nx_files_select on public.nx_files;
drop policy if exists nx_files_insert on public.nx_files;
drop policy if exists nx_files_delete on public.nx_files;
create policy nx_files_select on public.nx_files for select to authenticated using (user_id = auth.uid());
create policy nx_files_insert on public.nx_files for insert to authenticated
  with check (user_id = auth.uid() and public.nx_used_me() < public.nx_quota());
create policy nx_files_delete on public.nx_files for delete to authenticated using (user_id = auth.uid());

-- Bucket privado (nadie puede leerlo sin sesión) con límite por archivo
insert into storage.buckets (id, name, public, file_size_limit)
values ('nx-files', 'nx-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Cada cuenta solo toca su propia carpeta: nx-files/<su id>/…
drop policy if exists nx_files_obj_select on storage.objects;
drop policy if exists nx_files_obj_insert on storage.objects;
drop policy if exists nx_files_obj_delete on storage.objects;
create policy nx_files_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'nx-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy nx_files_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'nx-files' and (storage.foldername(name))[1] = auth.uid()::text and public.nx_used_me() < public.nx_quota());
create policy nx_files_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'nx-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- Lista de mis archivos (solo los que tienen contenido subido de verdad)
drop function if exists public.nx_files_list();
create function public.nx_files_list()
returns table (id uuid, name text, mime text, size bigint, created_at timestamptz)
language sql stable security definer set search_path = public, storage as $$
  select f.id, f.name, f.mime, coalesce((o.metadata->>'size')::bigint, 0), f.created_at
  from public.nx_files f
  join storage.objects o on o.bucket_id = 'nx-files' and o.name = f.user_id::text || '/' || f.id::text
  where f.user_id = auth.uid()
  order by f.created_at desc;
$$;

drop function if exists public.nx_files_usage();
create function public.nx_files_usage()
returns table (used bigint, quota bigint, max_file bigint, files integer)
language sql stable security definer set search_path = public, storage as $$
  select public.nx_used_me(), public.nx_quota(), public.nx_max_file(),
         (select count(*)::int from public.nx_files where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- 3) Permisos: solo usuarios con sesión
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'heartbeat()', 'go_offline()', 'list_friends()',
    'nx_quota()', 'nx_max_file()', 'nx_used_me()', 'nx_files_list()', 'nx_files_usage()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
