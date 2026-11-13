-- =====================================================================
-- NotXunta Client 0.5.6 · foto de perfil + sincronización de ajustes
-- Para una base de datos que YA tiene el schema anterior:
-- Supabase → SQL Editor → New query → pega todo esto → Run.
-- (Es seguro ejecutarlo más de una vez.)
-- =====================================================================

-- 1) Foto de perfil (imagen pequeña en data URL, la reduce la propia app a 128×128)
alter table public.profiles add column if not exists avatar text;
alter table public.profiles drop constraint if exists profiles_avatar_check;
alter table public.profiles add constraint profiles_avatar_check
  check (avatar is null or (char_length(avatar) <= 60000 and avatar ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$'));

-- 2) Ajustes sincronizados entre ordenadores (una fila por cuenta; solo la ve su dueño)
create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  look jsonb not null default '{}'::jsonb,        -- fondo, oscurecimiento, acento, sonido…
  look_at bigint not null default 0,              -- marca de tiempo (ms) de la última modificación
  prefs jsonb not null default '{}'::jsonb,       -- ajustes de la app (IA, avisos, segundo plano…)
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

-- 3) Las funciones de amigos devuelven ahora también la foto (hay que recrearlas porque cambia lo que devuelven)
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

do $$
declare f text;
begin
  foreach f in array array['find_user(text)', 'list_friends()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
