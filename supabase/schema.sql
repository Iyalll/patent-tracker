-- =====================================================================
--  专利进度看板 · Supabase 数据库初始化 / 升级脚本
--  用法：Supabase 控制台 → SQL Editor → New query → 粘贴全部 → Run
--  可重复执行：新项目直接建表；旧版本会自动迁移，不会清空数据
-- =====================================================================

-- ---------- 0. 角色（权限模板，管理员可在网页「管理 → 角色」里修改） ----------
create table if not exists public.roles (
  key          text primary key,                 -- 内部标识，建好后不再修改
  label        text not null,                    -- 显示名称
  description  text not null default '',
  can_own      boolean not null default false,   -- 可撰写条目：新建 / 修改 / 删除自己名下的条目，上报进度
  can_comment  boolean not null default false,   -- 可审核：对所有条目提出意见、批注、备注，上传批注文件
  can_edit_all boolean not null default false,   -- 可修改所有人的条目（含删除别人的记录和文件）
  can_manage   boolean not null default false,   -- 可管理账号、名单、角色和设置
  on_board     boolean not null default false,   -- 新账号默认在首页显示成员卡片
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

insert into public.roles (key, label, description, can_own, can_comment, can_edit_all, can_manage, on_board, sort_order) values
  ('student', '学生',            '撰写自己的条目、上报进度；可查看所有人的进度（只读）', true,  false, false, false, true,  1),
  ('teacher', '老师 / 专利中心', '对所有条目提出意见和批注；不能修改或删除别人的条目',   false, true,  false, false, false, 2),
  ('admin',   '管理员',          '管理账号、名单、角色；可修改所有条目',                 true,  true,  true,  true,  true,  3)
on conflict (key) do nothing;

-- ---------- 1. 成员（与登录账号一一对应） ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  name          text not null,
  username      text,
  role          text not null default 'student' references public.roles(key) on update cascade,
  show_on_board boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

-- 当前用户是否拥有某项权限：own / comment / edit_all / manage
create or replace function public.perm(flag text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case flag
      when 'own'      then r.can_own
      when 'comment'  then r.can_comment
      when 'edit_all' then r.can_edit_all
      when 'manage'   then r.can_manage
      else false end
    from public.profiles p join public.roles r on r.key = p.role
    where p.id = auth.uid()), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.perm('manage'); $$;

-- 普通成员只能改自己的显示名；角色、首页显示、排序只有管理者能改
create or replace function public.guard_profile_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- auth.uid() 为空 = 在 SQL Editor / 服务端直接执行，放行
  if auth.uid() is not null and not public.perm('manage') and (
       new.role is distinct from old.role
    or new.show_on_board is distinct from old.show_on_board
    or new.sort_order is distinct from old.sort_order
    or new.username is distinct from old.username) then
    raise exception '只有管理员可以修改角色、显示与排序';
  end if;
  return new;
end;
$$;

-- 旧版本迁移：角色由固定的 admin/member 改为引用 roles 表
alter table public.profiles add column if not exists username text;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles alter column role set default 'student';
update public.profiles set role = 'student' where role = 'member' or role not in (select key from public.roles);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_fkey') then
    alter table public.profiles
      add constraint profiles_role_fkey foreign key (role) references public.roles(key) on update cascade;
  end if;
end $$;
update public.profiles p set username = split_part(u.email, '@', 1)
from auth.users u where u.id = p.id and p.username is null;

-- 至少保留一位可管理的成员
create or replace function public.ensure_manager_exists()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from public.profiles) and not exists (
    select 1 from public.profiles p join public.roles r on r.key = p.role where r.can_manage
  ) then
    raise exception '至少需要保留一位拥有「管理」权限的成员';
  end if;
  return null;
end;
$$;

-- ---------- 2. 人员名单（只有名单里的人可以自助注册；一个人可有多个别名） ----------
create table if not exists public.roster (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  aliases    text[] not null default '{}',
  role       text not null default 'student' references public.roles(key) on update cascade,  -- 注册后的初始角色
  user_id    uuid unique references public.profiles(id) on delete set null,                  -- 已注册的账号
  note       text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists roster_name_uniq on public.roster (lower(name));

-- 已有账号自动补进名单
insert into public.roster (name, role, user_id)
select p.name, p.role, p.id from public.profiles p
where not exists (select 1 from public.roster r where r.user_id = p.id)
  and not exists (select 1 from public.roster r where lower(r.name) = lower(p.name))
on conflict do nothing;

-- ---------- 3. 站点设置（注册码等） ----------
create table if not exists public.app_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values ('register_code', '') on conflict (key) do nothing;

-- ---------- 4. 新账号 → 自动建成员记录，并与名单关联 ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_rid  uuid;
  r      public.roster%rowtype;
  v_name text;
  v_role text;
begin
  begin
    v_rid := nullif(new.raw_user_meta_data->>'roster_id', '')::uuid;
  exception when others then
    v_rid := null;
  end;
  if v_rid is not null then
    select * into r from public.roster where id = v_rid and user_id is null;
  end if;
  if r.id is null then
    v_name := coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1));
    select * into r from public.roster
    where user_id is null
      and (lower(name) = lower(v_name) or lower(v_name) = any (select lower(a) from unnest(aliases) a))
    limit 1;
  end if;

  v_name := coalesce(r.name, nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1));
  v_role := coalesce(r.role, 'student');

  insert into public.profiles (id, name, username, role, show_on_board)
  values (new.id, v_name, split_part(new.email, '@', 1), v_role,
          coalesce((select on_board from public.roles where key = v_role), true))
  on conflict (id) do nothing;

  if r.id is not null then
    update public.roster set user_id = new.id where id = r.id and user_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 先建账号、后跑脚本的情况：补建成员记录
insert into public.profiles (id, name, username)
select u.id, coalesce(nullif(u.raw_user_meta_data->>'name', ''), split_part(u.email, '@', 1)), split_part(u.email, '@', 1)
from auth.users u
on conflict (id) do nothing;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

drop trigger if exists profiles_keep_manager on public.profiles;
create trigger profiles_keep_manager
  after update of role on public.profiles
  for each row execute function public.ensure_manager_exists();

drop trigger if exists roles_keep_manager on public.roles;
create trigger roles_keep_manager
  after update or delete on public.roles
  for each row execute function public.ensure_manager_exists();

-- ---------- 5. 条目（专利 / 软著 等） ----------
create table if not exists public.patents (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  kind        text not null default '发明专利',
  owner_id    uuid not null references public.profiles(id) on delete restrict,
  progress    int  not null default 0 check (progress between 0 and 100),
  stage       text not null default '撰写中',
  due_date    date,
  description text not null default '',
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists patents_owner_idx on public.patents(owner_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists patents_touch on public.patents;
create trigger patents_touch before update on public.patents
  for each row execute function public.touch_updated_at();

-- ---------- 6. 进展记录（提交 / 专利中心意见 / 老师批注 / 新版本 / 备注） ----------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  patent_id   uuid not null references public.patents(id) on delete cascade,
  kind        text not null check (kind in ('submit', 'feedback', 'advisor', 'revise', 'note')),
  content     text not null default '',
  happened_on date not null default current_date,
  author_id   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists events_patent_idx on public.events(patent_id);

-- ---------- 7. 文件（实体在 Storage 的 patent-files 桶） ----------
create table if not exists public.files (
  id           uuid primary key default gen_random_uuid(),
  patent_id    uuid not null references public.patents(id) on delete cascade,
  name         text not null,
  storage_path text not null unique,
  size         bigint not null default 0,
  mime         text not null default '',
  note         text not null default '',
  uploaded_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists files_patent_idx on public.files(patent_id);

-- ---------- 8. 权限（RLS） ----------
-- 能否修改某个条目：有「修改所有条目」权限，或「可撰写」且是撰写人本人
create or replace function public.can_write_patent(pid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.perm('edit_all')
      or (public.perm('own') and exists (select 1 from public.patents where id = pid and owner_id = auth.uid()));
$$;

-- 存储路径形如 <条目id>/<文件名>
create or replace function public.can_write_patent_path(objname text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when split_part(objname, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
      then public.can_write_patent(split_part(objname, '/', 1)::uuid)
    else public.perm('edit_all')
  end;
$$;

revoke all on public.roles, public.profiles, public.roster, public.app_settings,
              public.patents, public.events, public.files from anon;
grant select, insert, update, delete on public.roles, public.profiles, public.roster, public.app_settings,
              public.patents, public.events, public.files to authenticated;

alter table public.roles        enable row level security;
alter table public.profiles     enable row level security;
alter table public.roster       enable row level security;
alter table public.app_settings enable row level security;
alter table public.patents      enable row level security;
alter table public.events       enable row level security;
alter table public.files        enable row level security;

-- roles：所有人可读（界面需要），管理者可改
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles for select to authenticated using (true);
drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles for all to authenticated
  using (public.perm('manage')) with check (public.perm('manage'));

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.perm('manage'))
  with check (id = auth.uid() or public.perm('manage'));

-- roster / app_settings：仅管理者
drop policy if exists roster_manage on public.roster;
create policy roster_manage on public.roster for all to authenticated
  using (public.perm('manage')) with check (public.perm('manage'));
drop policy if exists settings_manage on public.app_settings;
create policy settings_manage on public.app_settings for all to authenticated
  using (public.perm('manage')) with check (public.perm('manage'));

-- patents：所有人可看；撰写人本人（需「可撰写」）或「修改所有」可写
drop policy if exists patents_select on public.patents;
create policy patents_select on public.patents for select to authenticated using (true);
drop policy if exists patents_insert on public.patents;
create policy patents_insert on public.patents for insert to authenticated
  with check (public.perm('edit_all') or (public.perm('own') and owner_id = auth.uid()));
drop policy if exists patents_update on public.patents;
create policy patents_update on public.patents for update to authenticated
  using (public.can_write_patent(id))
  with check (public.perm('edit_all') or (public.perm('own') and owner_id = auth.uid()));
drop policy if exists patents_delete on public.patents;
create policy patents_delete on public.patents for delete to authenticated
  using (public.can_write_patent(id));

-- events：能写该条目的人可加任意记录；「可审核」的人可给任何条目加 意见 / 批注 / 备注
--         删除：自己加的（且仍有相应权限），或「修改所有」
drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated using (true);
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated
  with check (author_id = auth.uid() and (
    public.can_write_patent(patent_id)
    or (public.perm('comment') and kind in ('feedback', 'advisor', 'note'))));
drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (public.perm('edit_all') or author_id = auth.uid())
  with check (public.perm('edit_all') or author_id = auth.uid());
drop policy if exists events_delete on public.events;
create policy events_delete on public.events for delete to authenticated
  using (public.perm('edit_all') or (author_id = auth.uid()
    and (public.can_write_patent(patent_id) or public.perm('comment'))));

-- files：同上（「可审核」的人可上传批注文件）
drop policy if exists files_select on public.files;
create policy files_select on public.files for select to authenticated using (true);
drop policy if exists files_insert on public.files;
create policy files_insert on public.files for insert to authenticated
  with check (uploaded_by = auth.uid() and (public.can_write_patent(patent_id) or public.perm('comment')));
drop policy if exists files_delete on public.files;
create policy files_delete on public.files for delete to authenticated
  using (public.perm('edit_all') or (uploaded_by = auth.uid()
    and (public.can_write_patent(patent_id) or public.perm('comment'))));

-- ---------- 9. 文件存储桶（私有，登录后生成 10 分钟临时链接下载 / 预览） ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('patent-files', 'patent-files', false, 52428800)   -- 单文件 50 MB（免费版上限）
on conflict (id) do nothing;

drop policy if exists "team read patent files" on storage.objects;
create policy "team read patent files" on storage.objects for select to authenticated
  using (bucket_id = 'patent-files');
drop policy if exists "team upload patent files" on storage.objects;
drop policy if exists "writer upload patent files" on storage.objects;
create policy "writer upload patent files" on storage.objects for insert to authenticated
  with check (bucket_id = 'patent-files' and (public.can_write_patent_path(name) or public.perm('comment')));
drop policy if exists "owner delete patent files" on storage.objects;
drop policy if exists "writer delete patent files" on storage.objects;
create policy "writer delete patent files" on storage.objects for delete to authenticated
  using (bucket_id = 'patent-files' and (public.can_write_patent_path(name) or owner_id = auth.uid()::text));

-- ---------- 10. 删除成员（本人或管理者；名下条目可转交他人或一并删除） ----------
create or replace function public.delete_member(target uuid, transfer_to uuid default null)
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception '未登录';
  end if;
  if target <> auth.uid() and not public.perm('manage') then
    raise exception '只能删除自己，或由管理员删除他人';
  end if;
  if not exists (select 1 from public.profiles where id = target) then
    raise exception '成员不存在';
  end if;
  if exists (select 1 from public.profiles p join public.roles r on r.key = p.role where p.id = target and r.can_manage)
     and not exists (select 1 from public.profiles p join public.roles r on r.key = p.role
                     where p.id <> target and r.can_manage) then
    raise exception '这是最后一位管理员，请先指定其他管理员';
  end if;

  if transfer_to is not null then
    if transfer_to = target or not exists (select 1 from public.profiles where id = transfer_to) then
      raise exception '转交对象无效';
    end if;
    update public.patents set owner_id = transfer_to where owner_id = target;
  else
    delete from public.patents where owner_id = target;   -- 进展记录、文件记录随之级联删除
  end if;

  delete from auth.users where id = target;                -- profiles 随之级联删除，名单记录变回「未注册」
end;
$$;

revoke execute on function public.delete_member(uuid, uuid) from public, anon;
grant execute on function public.delete_member(uuid, uuid) to authenticated;

-- =====================================================================
--  常用管理语句（按需单独执行）
-- =====================================================================
-- 把某人设为管理员：
--   update public.profiles set role = 'admin' where username = 'zhangsan';
