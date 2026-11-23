-- =====================================================================
--  专利进度看板 · Supabase 数据库初始化脚本
--  用法：Supabase 控制台 → SQL Editor → New query → 粘贴全部 → Run
--  可重复执行（已存在的对象会跳过或替换）
-- =====================================================================

-- ---------- 1. 成员表（与 Supabase 登录账号一一对应） ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  name          text not null,
  role          text not null default 'member' check (role in ('admin', 'member')),
  show_on_board boolean not null default true,   -- 是否出现在首页成员卡片中（导师等只看不写的人可关掉）
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

-- 是否管理员（security definer 避免 RLS 递归）
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- 新建登录账号时自动生成成员记录；name 取 user_metadata.name，没有则取邮箱 @ 前面的部分
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 给已经存在的账号补建成员记录（先建账号、后跑脚本的情况）
insert into public.profiles (id, name)
select u.id, coalesce(nullif(u.raw_user_meta_data->>'name', ''), split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

-- 普通成员只能改自己的名字，角色/显示/排序只有管理员能改
create or replace function public.guard_profile_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() and (
       new.role is distinct from old.role
    or new.show_on_board is distinct from old.show_on_board
    or new.sort_order is distinct from old.sort_order) then
    raise exception '只有管理员可以修改角色、显示与排序';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------- 2. 条目表（专利 / 软著 等） ----------
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

-- ---------- 3. 进展记录（提交 / 专利中心反馈 / 导师批注 / 新版本 / 备注） ----------
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

-- ---------- 4. 文件（实际文件在 Storage 的 patent-files 桶里） ----------
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

-- ---------- 5. 权限（RLS） ----------
-- 未登录（anon）什么都看不到；登录的团队成员可以看全部数据
revoke all on public.profiles, public.patents, public.events, public.files from anon;
grant select, insert, update, delete on public.profiles, public.patents, public.events, public.files to authenticated;

alter table public.profiles enable row level security;
alter table public.patents  enable row level security;
alter table public.events   enable row level security;
alter table public.files    enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- patents：所有人可看；只有撰写人本人或管理员可新建/修改/删除
drop policy if exists patents_select on public.patents;
create policy patents_select on public.patents for select to authenticated using (true);
drop policy if exists patents_insert on public.patents;
create policy patents_insert on public.patents for insert to authenticated
  with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists patents_update on public.patents;
create policy patents_update on public.patents for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists patents_delete on public.patents;
create policy patents_delete on public.patents for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- events：任何成员都能给任何条目添加记录（方便由组长/导师录入反馈）；只能删自己的，管理员都能删
drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated using (true);
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated
  with check (author_id = auth.uid());
drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (author_id = auth.uid() or public.is_admin());
drop policy if exists events_delete on public.events;
create policy events_delete on public.events for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

-- files：同上
drop policy if exists files_select on public.files;
create policy files_select on public.files for select to authenticated using (true);
drop policy if exists files_insert on public.files;
create policy files_insert on public.files for insert to authenticated
  with check (uploaded_by = auth.uid());
drop policy if exists files_delete on public.files;
create policy files_delete on public.files for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_admin());

-- ---------- 6. 文件存储桶（私有，只能通过登录后生成的临时链接下载） ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('patent-files', 'patent-files', false, 52428800)   -- 单文件 50 MB（免费版上限）
on conflict (id) do nothing;

drop policy if exists "team read patent files" on storage.objects;
create policy "team read patent files" on storage.objects for select to authenticated
  using (bucket_id = 'patent-files');
drop policy if exists "team upload patent files" on storage.objects;
create policy "team upload patent files" on storage.objects for insert to authenticated
  with check (bucket_id = 'patent-files');
drop policy if exists "owner delete patent files" on storage.objects;
create policy "owner delete patent files" on storage.objects for delete to authenticated
  using (bucket_id = 'patent-files' and (owner_id = auth.uid()::text or public.is_admin()));

-- =====================================================================
--  常用管理语句（按需单独执行）
-- =====================================================================
-- 设置管理员：
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'zhangsan@team.local');
-- 改显示名：
--   update public.profiles set name = '张三'
--   where id = (select id from auth.users where email = 'zhangsan@team.local');
