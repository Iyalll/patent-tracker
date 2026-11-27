// =====================================================================
//  Supabase Edge Function: account
//  负责所有「需要管理员密钥」的账号操作（密钥只存在 Supabase 服务器上，不会出现在网页里）：
//    info       （公开）是否需要注册码
//    check      （公开）姓名 / 别名是否在名单中、是否已注册
//    register   （公开）名单内的人自助注册：姓名 + 用户名 + 密码（+ 注册码）
//    resolve    （公开）登录时输入中文姓名 / 别名 → 换成用户名
//    create     （管理员）直接创建账号，姓名不在名单中会自动加入名单
//    reset      （管理员）重置某个成员的密码
//
//  部署：Supabase 控制台 → Edge Functions → Deploy a new function → Via Editor
//        函数名填 account，粘贴本文件全部内容 → Deploy
//        然后在该函数的 Details/Settings 里关闭「Verify JWT / Enforce JWT verification」
//        （函数内部会自行校验管理员身份）
//  如果 config.js 里的 EMAIL_DOMAIN 不是 team.local，需要在 Edge Functions → Secrets
//  里添加同名密钥 EMAIL_DOMAIN。
// =====================================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
const EMAIL_DOMAIN = Deno.env.get('EMAIL_DOMAIN') ?? 'team.local';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class Fail extends Error {
  status: number;
  constructor(msg: string, status = 400) {
    super(msg);
    this.status = status;
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function adminHeaders(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { apikey: SERVICE_KEY, 'Content-Type': 'application/json', ...extra };
  if (SERVICE_KEY.startsWith('eyJ')) h.Authorization = `Bearer ${SERVICE_KEY}`;
  return h;
}

async function call(path: string, init: RequestInit = {}) {
  const r = await fetch(SUPABASE_URL + path, {
    ...init,
    headers: adminHeaders((init.headers as Record<string, string>) ?? {}),
  });
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const msg = (data && (data.msg || data.message || data.error_description || data.error)) || `HTTP ${r.status}`;
    throw new Fail(String(msg), r.status);
  }
  return data;
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;

type Roster = { id: string; name: string; aliases: string[]; role: string; user_id: string | null };

async function findRoster(name: string): Promise<Roster[]> {
  const all: Roster[] = await call('/rest/v1/roster?select=id,name,aliases,role,user_id');
  const n = norm(name);
  return all.filter((r) => norm(r.name) === n || (r.aliases ?? []).some((a) => norm(a) === n));
}

async function registerCode(): Promise<string> {
  const rows = await call('/rest/v1/app_settings?select=value&key=eq.register_code');
  return rows?.[0]?.value ?? '';
}

async function callerIsManager(req: Request): Promise<boolean> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || token.startsWith('sb_')) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return false;
  const user = await r.json();
  const rows = await call(`/rest/v1/profiles?select=role,roles(can_manage)&id=eq.${user.id}`);
  return !!rows?.[0]?.roles?.can_manage;
}

function checkUsername(username: string) {
  if (!USERNAME_RE.test(username)) throw new Fail('用户名只能用小写字母、数字和 . _ -，2～32 位，且以字母或数字开头');
}
function checkPassword(pw: unknown) {
  if (typeof pw !== 'string' || pw.length < 6) throw new Fail('密码至少 6 位');
}

async function createUser(username: string, password: string, name: string, rosterId: string) {
  try {
    return await call('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: `${username}@${EMAIL_DOMAIN}`,
        password,
        email_confirm: true,
        user_metadata: { name, roster_id: rosterId },
      }),
    });
  } catch (e) {
    if (/already|exists|registered/i.test((e as Error).message)) throw new Fail('该用户名已被占用，请换一个');
    throw e;
  }
}

async function handle(req: Request, body: any) {
  const action = body?.action;

  if (action === 'info') {
    return { code_required: (await registerCode()) !== '' };
  }

  if (action === 'check') {
    const hits = await findRoster(body.name);
    if (!hits.length) return { status: 'not_found' };
    if (hits.length > 1) return { status: 'ambiguous' };
    return { status: hits[0].user_id ? 'taken' : 'ok', name: hits[0].name };
  }

  if (action === 'resolve') {
    const login = String(body.login ?? '').trim();
    const hits = await findRoster(login);
    if (hits.length === 1 && hits[0].user_id) {
      const rows = await call(`/rest/v1/profiles?select=username&id=eq.${hits[0].user_id}`);
      if (rows?.[0]?.username) return { username: rows[0].username };
    }
    throw new Fail('找不到该姓名对应的账号，请改用用户名登录', 404);
  }

  if (action === 'register') {
    const username = norm(body.username);
    checkUsername(username);
    checkPassword(body.password);
    const code = await registerCode();
    if (code && String(body.code ?? '').trim() !== code) throw new Fail('注册码不正确');
    const hits = await findRoster(body.name);
    if (!hits.length) throw new Fail('名单中没有这个姓名，请联系管理员添加');
    if (hits.length > 1) throw new Fail('这个姓名匹配到多条名单记录，请联系管理员');
    if (hits[0].user_id) throw new Fail('这个姓名已经注册过账号；忘记密码请联系管理员重置');
    await createUser(username, body.password, hits[0].name, hits[0].id);
    return { ok: true, username };
  }

  if (action === 'create' || action === 'reset') {
    if (!(await callerIsManager(req))) throw new Fail('只有管理员可以执行此操作', 403);

    if (action === 'reset') {
      checkPassword(body.password);
      if (!body.user_id) throw new Fail('缺少 user_id');
      await call(`/auth/v1/admin/users/${body.user_id}`, {
        method: 'PUT',
        body: JSON.stringify({ password: body.password }),
      });
      return { ok: true };
    }

    const name = String(body.name ?? '').trim();
    if (!name) throw new Fail('请填写姓名');
    const username = norm(body.username);
    checkUsername(username);
    checkPassword(body.password);
    const role = String(body.role ?? 'student');
    const aliases: string[] = Array.isArray(body.aliases) ? body.aliases.map((a: unknown) => String(a).trim()).filter(Boolean) : [];

    let hits = await findRoster(name);
    if (hits.length > 1) throw new Fail('这个姓名匹配到多条名单记录，请先在名单里处理');
    let entry = hits[0];
    if (entry?.user_id) throw new Fail('这个姓名已经有账号了');
    if (!entry) {
      const rows = await call('/rest/v1/roster', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ name, aliases, role }),
      });
      entry = rows[0];
    } else if (entry.role !== role) {
      await call(`/rest/v1/roster?id=eq.${entry.id}`, { method: 'PATCH', body: JSON.stringify({ role }) });
    }
    await createUser(username, body.password, entry.name, entry.id);
    return { ok: true, username };
  }

  throw new Fail('未知操作');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SERVICE_KEY) return json({ error: '函数缺少 SUPABASE_SERVICE_ROLE_KEY 环境变量' }, 500);
  try {
    const body = await req.json().catch(() => ({}));
    return json(await handle(req, body));
  } catch (e) {
    const status = e instanceof Fail ? e.status : 500;
    return json({ error: (e as Error).message || '服务器错误' }, status);
  }
});
