// Supabase 后端：直接调用 REST 接口（不依赖任何 CDN / npm 包）
//   Auth     /auth/v1
//   数据库   /rest/v1      (PostgREST，权限由 RLS 控制)
//   文件     /storage/v1

export class AuthError extends Error {
  constructor(msg) { super(msg); this.code = 'AUTH'; }
}

const AUTH_MSG = {
  'Invalid login credentials': '用户名或密码错误',
  'Email not confirmed': '账号尚未确认，请联系管理员在 Supabase 中确认该用户',
  'User not found': '用户不存在',
  'New password should be different from the old password.': '新密码不能与旧密码相同',
};

function pickMsg(d, status) {
  if (!d) return `请求失败（${status}）`;
  if (typeof d === 'string') return d.slice(0, 200) || `请求失败（${status}）`;
  const m = d.error_description || d.msg || d.message || d.error || d.hint || '';
  if (AUTH_MSG[m]) return AUTH_MSG[m];
  if (/row-level security|permission denied/i.test(m)) return '没有权限执行该操作';
  if (/Password should be at least/i.test(m)) return '密码太短（至少 6 位）';
  if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return '文件超过大小限制';
  return m || `请求失败（${status}）`;
}

async function parse(r) {
  const t = await r.text();
  if (!t) return null;
  try { return JSON.parse(t); } catch { return t; }
}

export function createSupabaseBackend(cfg) {
  const base = cfg.SUPABASE_URL.replace(/\/+$/, '');
  const KEY = cfg.SUPABASE_KEY;
  const BUCKET = cfg.STORAGE_BUCKET || 'patent-files';
  const LS = 'pt_session_v1';

  let session = null;
  try { session = JSON.parse(localStorage.getItem(LS)); } catch { session = null; }

  function save(s) {
    session = s;
    if (s) localStorage.setItem(LS, JSON.stringify(s));
    else localStorage.removeItem(LS);
  }
  function toSession(d) {
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
      user: { id: d.user.id, email: d.user.email },
    };
  }

  async function auth(path, { method = 'POST', body, token } = {}) {
    const headers = { apikey: KEY, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    let r;
    try {
      r = await fetch(base + '/auth/v1' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error('无法连接到服务器，请检查网络');
    }
    const d = await parse(r);
    if (!r.ok) throw new Error(pickMsg(d, r.status));
    return d;
  }

  let refreshing = null;
  function refresh() {
    if (!session) return Promise.reject(new AuthError('未登录'));
    if (!refreshing) {
      refreshing = auth('/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } })
        .then((d) => save(toSession(d)))
        .catch(() => { save(null); throw new AuthError('登录已过期，请重新登录'); })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function token() {
    if (!session) throw new AuthError('未登录');
    if (session.expires_at - 60 < Date.now() / 1000) await refresh();
    return session.access_token;
  }

  async function req(url, opts = {}, retry = true) {
    const t = await token();
    const headers = { apikey: KEY, Authorization: 'Bearer ' + t, ...(opts.headers || {}) };
    let r;
    try {
      r = await fetch(url, { ...opts, headers });
    } catch {
      throw new Error('无法连接到服务器，请检查网络');
    }
    if (r.status === 401 && retry) {
      await refresh();
      return req(url, opts, false);
    }
    const d = await parse(r);
    if (!r.ok) throw new Error(pickMsg(d, r.status));
    return d;
  }

  const rest = (path, opts = {}) =>
    req(base + '/rest/v1/' + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) },
    });

  function one(rows, what = '操作') {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`没有权限执行${what}`);
    return rows[0];
  }

  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

  async function removeObjects(paths) {
    if (!paths.length) return;
    await req(`${base}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: paths }),
    });
  }

  return {
    mode: 'cloud',

    getSession() {
      return session ? { userId: session.user.id, email: session.user.email } : null;
    },

    async signIn(login, password) {
      const email = login.includes('@') ? login.trim() : `${login.trim()}@${cfg.EMAIL_DOMAIN}`;
      const d = await auth('/token?grant_type=password', { body: { email, password } });
      save(toSession(d));
    },

    // scope: 'local' 只退出当前浏览器；'global' 退出该账号在所有设备上的登录
    async signOut(scope = 'local') {
      try { if (session) await auth(`/logout?scope=${scope}`, { token: session.access_token }); } catch { /* ignore */ }
      save(null);
    },

    async changePassword(password) {
      await auth('/user', { method: 'PUT', token: await token(), body: { password } });
    },

    async loadAll() {
      const [profiles, patents, events, files] = await Promise.all([
        rest('profiles?select=*&order=sort_order.asc,created_at.asc'),
        rest('patents?select=*&order=created_at.asc'),
        rest('events?select=*&order=happened_on.desc,created_at.desc'),
        rest('files?select=*&order=created_at.desc'),
      ]);
      return { profiles, patents, events, files };
    },

    async updateProfile(id, patch) {
      return one(await rest(`profiles?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) }), '修改成员');
    },

    async deleteMember(id, transferTo = null) {
      await rest('rpc/delete_member', { method: 'POST', body: JSON.stringify({ target: id, transfer_to: transferTo }) });
    },

    async createPatent(data) {
      return one(await rest('patents', { method: 'POST', body: JSON.stringify(data) }), '新建');
    },

    async updatePatent(id, patch) {
      return one(await rest(`patents?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) }), '修改');
    },

    async deletePatent(id, files = []) {
      await removeObjects(files.map((f) => f.storage_path));
      one(await rest(`patents?id=eq.${id}`, { method: 'DELETE' }), '删除');
    },

    async addEvent(data) {
      return one(await rest('events', { method: 'POST', body: JSON.stringify(data) }), '添加记录');
    },

    async deleteEvent(id) {
      one(await rest(`events?id=eq.${id}`, { method: 'DELETE' }), '删除记录');
    },

    async uploadFile(patentId, file, note = '') {
      const m = /\.([A-Za-z0-9]{1,10})$/.exec(file.name);
      const ext = m ? '.' + m[1].toLowerCase() : '';
      const path = `${patentId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      await req(`${base}/storage/v1/object/${BUCKET}/${encPath(path)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false', 'cache-control': '3600' },
        body: file,
      });
      try {
        return one(
          await rest('files', {
            method: 'POST',
            body: JSON.stringify({
              patent_id: patentId, name: file.name, storage_path: path,
              size: file.size, mime: file.type || '', note,
            }),
          }),
          '上传',
        );
      } catch (e) {
        try { await removeObjects([path]); } catch { /* ignore */ }
        throw e;
      }
    },

    async fileUrl(f, download = true) {
      const d = await req(`${base}/storage/v1/object/sign/${BUCKET}/${encPath(f.storage_path)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 600 }),
      });
      const signed = d.signedURL || d.signedUrl;
      let url = signed.startsWith('http') ? signed : `${base}/storage/v1${signed}`;
      if (download) url += (url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(f.name);
      return url;
    },

    async deleteFile(f) {
      one(await rest(`files?id=eq.${f.id}`, { method: 'DELETE' }), '删除文件');
      try { await removeObjects([f.storage_path]); } catch { /* 记录已删，忽略存储清理失败 */ }
    },
  };
}
