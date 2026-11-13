-- =====================================================================
-- NotXunta Client · cuentas propias y amigos (Supabase / PostgreSQL)
-- Pégalo entero en: Supabase → SQL Editor → New query → Run
-- =====================================================================

-- Perfil público de cada cuenta NotXunta (la contraseña/Google los gestiona Supabase Auth)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null default '' check (char_length(display_name) <= 40),
  discoverable boolean not null default true,      -- ¿pueden encontrarme mis compañeros de aula?
  avatar text check (avatar is null or (char_length(avatar) <= 60000 and avatar ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$')),  -- foto de perfil (128×128)
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists avatar text;
alter table public.profiles enable row level security;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Vínculo "esta cuenta NotXunta es el usuario X de tal aula" (solo si la persona lo permite).
-- OJO: es declarativo, no se verifica contra el aula. Quien se vincula primero se queda con ese usuario.
create table if not exists public.moodle_links (
  site_key text not null,
  moodle_user_id bigint not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  fullname text not null default '',
  primary key (site_key, moodle_user_id)
);
create index if not exists moodle_links_user on public.moodle_links (user_id);
alter table public.moodle_links enable row level security;
drop policy if exists links_own_select on public.moodle_links;
drop policy if exists links_own_insert on public.moodle_links;
drop policy if exists links_own_update on public.moodle_links;
drop policy if exists links_own_delete on public.moodle_links;
create policy links_own_select on public.moodle_links for select to authenticated using (user_id = auth.uid());
create policy links_own_insert on public.moodle_links for insert to authenticated with check (user_id = auth.uid());
create policy links_own_update on public.moodle_links for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy links_own_delete on public.moodle_links for delete to authenticated using (user_id = auth.uid());

-- Amistades (solo se crean/aceptan mediante las funciones de abajo)
create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  requester uuid not null references public.profiles(id) on delete cascade,
  addressee uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index if not exists friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));
alter table public.friendships enable row level security;
drop policy if exists friendships_select on public.friendships;
drop policy if exists friendships_delete on public.friendships;
create policy friendships_select on public.friendships for select to authenticated using (auth.uid() in (requester, addressee));
create policy friendships_delete on public.friendships for delete to authenticated using (auth.uid() in (requester, addressee));

-- Ajustes sincronizados entre ordenadores (una fila por cuenta; solo la ve su dueño)
create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  look jsonb not null default '{}'::jsonb,
  look_at bigint not null default 0,
  prefs jsonb not null default '{}'::jsonb,
  prefs_at bigint not null default 0,
  accounts jsonb not null default '[]'::jsonb,    -- aulas (nombre, enlace, usuario, icono). NUNCA contraseñas
  accounts_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  check (octet_length(look::text) <= 1500000),
  check (octet_length(prefs::text) <= 4000),
  check (octet_length(accounts::text) <= 400000)
);
alter table public.user_settings enable row level security;
drop policy if exists settings_select on public.user_settings;
drop policy if exists settings_insert on public.user_settings;
drop policy if exists settings_update on public.user_settings;
drop policy if exists settings_delete on public.user_settings;
create policy settings_select on public.user_settings for select to authenticated using (user_id = auth.uid());
create policy settings_insert on public.user_settings for insert to authenticated with check (user_id = auth.uid());
create policy settings_update on public.user_settings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy settings_delete on public.user_settings for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Funciones (security definer: exponen solo lo imprescindible)
-- ---------------------------------------------------------------------

-- ¿Quién de estos usuarios de un aula usa NotXunta Client? (solo perfiles "discoverable")
create or replace function public.find_moodle_users(p_site text, p_ids bigint[])
returns table (moodle_user_id bigint, user_id uuid, username text, display_name text)
language sql stable security definer set search_path = public as $$
  select l.moodle_user_id, p.id, p.username, p.display_name
  from public.moodle_links l join public.profiles p on p.id = l.user_id
  where auth.uid() is not null and l.site_key = p_site
    and l.moodle_user_id = any (p_ids[1:500]) and p.discoverable;
$$;

-- Buscar a alguien por nombre de usuario exacto
drop function if exists public.find_user(text);
create function public.find_user(p_username text)
returns table (id uuid, username text, display_name text, avatar text)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.avatar from public.profiles p
  where auth.uid() is not null and p.username = lower(p_username) and p.discoverable and p.id <> auth.uid();
$$;

drop function if exists public.list_friends();
create function public.list_friends()
returns table (friendship_id bigint, other_id uuid, username text, display_name text, status text, i_requested boolean, avatar text)
language sql stable security definer set search_path = public as $$
  select f.id, p.id, p.username, p.display_name, f.status, (f.requester = auth.uid()), p.avatar
  from public.friendships f
  join public.profiles p on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
  where auth.uid() in (f.requester, f.addressee)
  order by f.created_at desc;
$$;

create or replace function public.send_friend_request(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); ex public.friendships%rowtype;
begin
  if me is null then raise exception 'Inicia sesión primero.'; end if;
  if p_user = me then raise exception 'No puedes añadirte a ti mismo.'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'Crea tu perfil primero.'; end if;
  select * into ex from public.friendships
   where (requester = me and addressee = p_user) or (requester = p_user and addressee = me);
  if found then
    if ex.status = 'pending' and ex.addressee = me then
      update public.friendships set status = 'accepted' where id = ex.id;   -- ya te había enviado él una solicitud
      return 'accepted';
    end if;
    return ex.status;
  end if;
  if (select count(*) from public.friendships where requester = me and status = 'pending') >= 50 then
    raise exception 'Tienes demasiadas solicitudes pendientes.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and discoverable) then
    raise exception 'Ese usuario no existe o no acepta solicitudes.';
  end if;
  insert into public.friendships (requester, addressee) values (me, p_user);
  return 'pending';
end; $$;

create or replace function public.respond_friend_request(p_id bigint, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_accept then
    update public.friendships set status = 'accepted' where id = p_id and addressee = auth.uid() and status = 'pending';
  else
    delete from public.friendships where id = p_id and addressee = auth.uid() and status = 'pending';
  end if;
end; $$;

-- Borrar mi cuenta y todos mis datos
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero.'; end if;
  delete from auth.users where id = auth.uid();   -- borra en cascada perfil, vínculos y amistades
end; $$;

-- Solo usuarios con sesión pueden llamar a las funciones
do $$
declare f text;
begin
  foreach f in array array[
    'find_moodle_users(text,bigint[])', 'find_user(text)', 'list_friends()',
    'send_friend_request(uuid)', 'respond_friend_request(bigint,boolean)', 'delete_my_account()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
