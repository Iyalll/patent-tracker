// 演示后端：所有数据存在当前浏览器 localStorage，用于本地预览界面与权限逻辑
// config.js 里填好 SUPABASE_URL / SUPABASE_KEY 后会自动切换到真实后端

const DB_KEY = 'pt_demo_db_v2';
const SES_KEY = 'pt_demo_session_v2';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
const now = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const dateAgo = (n) => daysAgo(n).slice(0, 10);
const norm = (s) => String(s ?? '').trim().toLowerCase();
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;

const DEFAULT_ROLES = [
  { key: 'student', label: '学生', description: '撰写自己的条目、上报进度；可查看所有人的进度（只读）',
    can_own: true, can_comment: false, can_edit_all: false, can_manage: false, on_board: true, sort_order: 1 },
  { key: 'teacher', label: '老师 / 专利中心', description: '对所有条目提出意见和批注；不能修改或删除别人的条目',
    can_own: false, can_comment: true, can_edit_all: false, can_manage: false, on_board: false, sort_order: 2 },
  { key: 'admin', label: '管理员', description: '管理账号、名单、角色；可修改所有条目',
    can_own: true, can_comment: true, can_edit_all: true, can_manage: true, on_board: true, sort_order: 3 },
];

function seed() {
  const u1 = uid(), u2 = uid(), u3 = uid(), u4 = uid();
  const P = (id, name, username, role, sort, board = true) =>
    ({ id, name, username, role, show_on_board: board, sort_order: sort, created_at: daysAgo(40) });
  const profiles = [
    P(u1, '张三', 'zhangsan', 'admin', 1), P(u2, '李四', 'lisi', 'student', 2),
    P(u3, '王五', 'wangwu', 'student', 3), P(u4, '陈老师', 'chen', 'teacher', 9, false),
  ];
  const accounts = [
    { username: 'zhangsan', password: '123456', userId: u1 }, { username: 'lisi', password: '123456', userId: u2 },
    { username: 'wangwu', password: '123456', userId: u3 }, { username: 'chen', password: '123456', userId: u4 },
  ];
  const R = (name, aliases, role, user_id = null) => ({ id: uid(), name, aliases, role, user_id, note: '', created_at: daysAgo(40) });
  const roster = [
    R('张三', ['三哥'], 'admin', u1), R('李四', ['小李'], 'student', u2), R('王五', [], 'student', u3),
    R('陈老师', ['陈明', '专利中心'], 'teacher', u4), R('赵六', ['小赵', 'zhaoliu'], 'student'),
  ];
  const T = (owner, title, progress, stage, kind = '发明专利', age = 20) => ({
    id: uid(), title, kind, owner_id: owner, progress, stage, due_date: null, description: '',
    created_by: owner, created_at: daysAgo(age), updated_at: daysAgo(Math.max(1, age - 12)),
  });
  const patents = [
    T(u1, '一种基于维修事件时间不确定性的装备退化训练样本构建方法', 100, '交专利中心审核', '发明专利', 30),
    T(u1, '一种基于故障语义锚点的跨型号装备故障理解与检索方法', 45, '撰写中'),
    T(u1, '一种根因不确定条件下的装备检查与维修联合决策方法', 20, '撰写中'),
    T(u1, '一种面向部件流转的装备健康状态迁移与一致性校验方法', 0, '撰写中'),
    T(u2, '一种非运行事件后装备健康预测模型的适用性判定方法', 60, '导师审核'),
    T(u2, '一种基于检查反馈的装备告警事件级阈值自适应方法', 10, '撰写中'),
    T(u2, '设备维护跨文档条件检索系统', 100, '已提交受理', '软件著作权', 28),
    T(u3, '一种面向航空发动机维修事件的异步多模态证据对齐与检索方法', 100, '返回修改', '发明专利', 32),
    T(u3, '一种基于发动机构型与维修文档适用性约束的多模态检索方法', 35, '撰写中'),
    T(u3, '一种基于诊断不确定性与检查信息增益的航空发动机故障追溯方法', 15, '撰写中'),
    T(u3, '一种考虑故障不确定性与维修恢复效果的航空发动机维修动作联合优化方法', 0, '撰写中'),
    T(u3, '一种基于部件谱系与构型变更的航空发动机健康状态继承方法', 0, '暂停'),
  ];
  const E = (p, kind, content, d, author) => ({
    id: uid(), patent_id: p.id, kind, content, happened_on: dateAgo(d), author_id: author, created_at: daysAgo(d),
  });
  const events = [
    E(patents[0], 'submit', '交底书 v3 + 说明书初稿提交专利中心', 13, u1),
    E(patents[0], 'feedback', '技术交底检索：与现有退化建模方法的区别需进一步说明，建议在权利要求 1 中突出时间不确定性的处理步骤。', 5, u4),
    E(patents[4], 'advisor', '实施例部分再补一组对比实验，第 3 节公式符号与正文统一。', 2, u4),
    E(patents[6], 'submit', '软著申请材料（源代码 + 说明书）提交', 12, u2),
    E(patents[6], 'feedback', '形式审查通过，已提交受理。', 6, u4),
    E(patents[7], 'submit', '说明书 + 权利要求书提交', 14, u3),
    E(patents[7], 'feedback', '技术交底检索：权利要求 2–4 与对比文件 D1 重合度较高，需要修改后重新提交。', 0, u4),
  ];
  return { roles: DEFAULT_ROLES, profiles, accounts, roster, settings: [{ key: 'register_code', value: '' }], patents, events, files: [] };
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(DB_KEY));
    if (d && d.profiles && d.roles) return d;
  } catch { /* ignore */ }
  const d = seed();
  localStorage.setItem(DB_KEY, JSON.stringify(d));
  return d;
}

const delay = (v) => new Promise((r) => setTimeout(() => r(v), 50));
const clone = (v) => JSON.parse(JSON.stringify(v));

export function createDemoBackend() {
  let db = load();
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SES_KEY)); } catch { session = null; }
  const persist = () => {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
    catch { throw new Error('浏览器本地存储已满（演示模式下文件内容存在浏览器里）'); }
  };
  const me = () => db.profiles.find((p) => p.id === session?.userId);
  const roleOf = (p) => db.roles.find((r) => r.key === p?.role) || {};
  const perm = (flag) => !!roleOf(me())['can_' + flag];
  const deny = () => { throw new Error('没有权限执行该操作'); };
  const canWrite = (pid) => perm('edit_all') || (perm('own') && db.patents.find((p) => p.id === pid)?.owner_id === session.userId);
  const managerLeft = () => db.profiles.some((p) => roleOf(p).can_manage);
  const findRoster = (name) => db.roster.filter((r) => norm(r.name) === norm(name) || r.aliases.some((a) => norm(a) === norm(name)));

  function createAccount(entry, username, password) {
    username = norm(username);
    if (!USERNAME_RE.test(username)) throw new Error('用户名只能用小写字母、数字和 . _ -，2～32 位，且以字母或数字开头');
    if (!password || password.length < 6) throw new Error('密码至少 6 位');
    if (db.accounts.some((a) => a.username === username)) throw new Error('该用户名已被占用，请换一个');
    const id = uid();
    const role = db.roles.find((r) => r.key === entry.role) || db.roles[0];
    db.profiles.push({ id, name: entry.name, username, role: role.key, show_on_board: role.on_board,
      sort_order: db.profiles.length + 1, created_at: now() });
    db.accounts.push({ username, password, userId: id });
    entry.user_id = id;
    persist();
    return username;
  }

  return {
    mode: 'demo',

    getSession() { return session; },

    async signIn(login, password) {
      let name = login.trim().split('@')[0];
      if (!USERNAME_RE.test(name)) {
        const hit = findRoster(name);
        const prof = hit.length === 1 && db.profiles.find((p) => p.id === hit[0].user_id);
        if (!prof) throw new Error('找不到该姓名对应的账号，请改用用户名登录');
        name = prof.username;
      }
      const a = db.accounts.find((x) => x.username === norm(name));
      if (!a || a.password !== password) throw new Error('用户名或密码错误');
      session = { userId: a.userId, email: `${a.username}@demo` };
      localStorage.setItem(SES_KEY, JSON.stringify(session));
      return delay();
    },

    async signOut() { session = null; localStorage.removeItem(SES_KEY); },

    async changePassword(pw) {
      db.accounts.find((x) => x.userId === session.userId).password = pw;
      persist(); return delay();
    },

    async registrationInfo() { return delay({ code_required: !!db.settings.find((s) => s.key === 'register_code')?.value }); },

    async checkName(name) {
      const hits = findRoster(name);
      if (!hits.length) return { status: 'not_found' };
      if (hits.length > 1) return { status: 'ambiguous' };
      return { status: hits[0].user_id ? 'taken' : 'ok', name: hits[0].name };
    },

    async register({ name, username, password, code }) {
      const need = db.settings.find((s) => s.key === 'register_code')?.value;
      if (need && String(code || '').trim() !== need) throw new Error('注册码不正确');
      const hits = findRoster(name);
      if (!hits.length) throw new Error('名单中没有这个姓名，请联系管理员添加');
      if (hits.length > 1) throw new Error('这个姓名匹配到多条名单记录，请联系管理员');
      if (hits[0].user_id) throw new Error('这个姓名已经注册过账号；忘记密码请联系管理员重置');
      const u = createAccount(hits[0], username, password);
      await this.signIn(u, password);
    },

    async adminCreateAccount({ name, aliases = [], role, username, password }) {
      if (!perm('manage')) deny();
      const hits = findRoster(name);
      if (hits.length > 1) throw new Error('这个姓名匹配到多条名单记录，请先在名单里处理');
      let entry = hits[0];
      if (entry?.user_id) throw new Error('这个姓名已经有账号了');
      if (!entry) {
        entry = { id: uid(), name: name.trim(), aliases, role, user_id: null, note: '', created_at: now() };
        db.roster.push(entry);
      } else entry.role = role;
      try { createAccount(entry, username, password); } catch (e) { persist(); throw e; }
      return delay({ ok: true });
    },

    async adminResetPassword(userId, password) {
      if (!perm('manage')) deny();
      if (!password || password.length < 6) throw new Error('密码至少 6 位');
      db.accounts.find((a) => a.userId === userId).password = password;
      persist(); return delay({ ok: true });
    },

    async loadAll() {
      db = load();
      const mgr = perm('manage');
      return delay(clone({
        roles: [...db.roles].sort((a, b) => a.sort_order - b.sort_order),
        profiles: [...db.profiles].sort((a, b) => a.sort_order - b.sort_order),
        patents: db.patents,
        events: [...db.events].sort((a, b) => (b.happened_on + b.created_at).localeCompare(a.happened_on + a.created_at)),
        files: db.files.map(({ data, ...f }) => ({ ...f, _hasData: !!data })),
        roster: mgr ? db.roster : [],
        settings: mgr ? db.settings : [],
      }));
    },

    async updateProfile(id, patch) {
      if (id !== session.userId && !perm('manage')) deny();
      if (!perm('manage') && ['role', 'show_on_board', 'sort_order'].some((k) => k in patch)) deny();
      const p = db.profiles.find((x) => x.id === id);
      const old = { ...p };
      Object.assign(p, patch);
      if (!managerLeft()) { Object.assign(p, old); throw new Error('至少需要保留一位拥有「管理」权限的成员'); }
      persist(); return delay();
    },

    async deleteMember(id, transferTo = null) {
      if (id !== session.userId && !perm('manage')) deny();
      const target = db.profiles.find((p) => p.id === id);
      if (roleOf(target).can_manage && !db.profiles.some((p) => p.id !== id && roleOf(p).can_manage)) {
        throw new Error('这是最后一位管理员，请先指定其他管理员');
      }
      if (transferTo) db.patents.forEach((p) => { if (p.owner_id === id) p.owner_id = transferTo; });
      else {
        const gone = new Set(db.patents.filter((p) => p.owner_id === id).map((p) => p.id));
        db.patents = db.patents.filter((p) => !gone.has(p.id));
        db.events = db.events.filter((e) => !gone.has(e.patent_id));
        db.files = db.files.filter((f) => !gone.has(f.patent_id));
      }
      db.events.forEach((e) => { if (e.author_id === id) e.author_id = null; });
      db.files.forEach((f) => { if (f.uploaded_by === id) f.uploaded_by = null; });
      db.roster.forEach((r) => { if (r.user_id === id) r.user_id = null; });
      db.profiles = db.profiles.filter((p) => p.id !== id);
      db.accounts = db.accounts.filter((a) => a.userId !== id);
      persist(); return delay();
    },

    // ---- 名单 / 角色 / 设置 ----
    async addRoster(row) {
      if (!perm('manage')) deny();
      if (db.roster.some((r) => norm(r.name) === norm(row.name))) throw new Error('名单里已有同名记录');
      const r = { id: uid(), aliases: [], role: 'student', user_id: null, note: '', created_at: now(), ...row };
      db.roster.push(r); persist(); return delay(clone(r));
    },
    async updateRoster(id, patch) {
      if (!perm('manage')) deny();
      if (patch.name && db.roster.some((r) => r.id !== id && norm(r.name) === norm(patch.name))) throw new Error('名单里已有同名记录');
      Object.assign(db.roster.find((r) => r.id === id), patch); persist(); return delay();
    },
    async deleteRoster(id) {
      if (!perm('manage')) deny();
      db.roster = db.roster.filter((r) => r.id !== id); persist(); return delay();
    },
    async addRole(row) {
      if (!perm('manage')) deny();
      const r = { description: '', can_own: false, can_comment: false, can_edit_all: false, can_manage: false,
        on_board: false, sort_order: db.roles.length + 1, ...row };
      db.roles.push(r); persist(); return delay(clone(r));
    },
    async updateRole(key, patch) {
      if (!perm('manage')) deny();
      const r = db.roles.find((x) => x.key === key);
      const old = { ...r };
      Object.assign(r, patch);
      if (!managerLeft()) { Object.assign(r, old); throw new Error('至少需要保留一位拥有「管理」权限的成员'); }
      persist(); return delay();
    },
    async deleteRole(key) {
      if (!perm('manage')) deny();
      if (db.profiles.some((p) => p.role === key) || db.roster.some((r) => r.role === key)) throw new Error('还有成员或名单在使用这个角色，不能删除');
      db.roles = db.roles.filter((r) => r.key !== key); persist(); return delay();
    },
    async setSetting(key, value) {
      if (!perm('manage')) deny();
      db.settings.find((s) => s.key === key).value = value; persist(); return delay();
    },

    // ---- 条目 / 记录 / 文件 ----
    async createPatent(data) {
      if (!(perm('edit_all') || (perm('own') && data.owner_id === session.userId))) deny();
      const p = { id: uid(), description: '', due_date: null, progress: 0, stage: '撰写中', kind: '发明专利',
        ...data, created_by: session.userId, created_at: now(), updated_at: now() };
      db.patents.push(p); persist(); return delay(clone(p));
    },

    async updatePatent(id, patch) {
      if (!canWrite(id)) deny();
      if (patch.owner_id && patch.owner_id !== session.userId && !perm('edit_all')) deny();
      Object.assign(db.patents.find((x) => x.id === id), patch, { updated_at: now() });
      persist(); return delay();
    },

    async deletePatent(id) {
      if (!canWrite(id)) deny();
      db.patents = db.patents.filter((x) => x.id !== id);
      db.events = db.events.filter((x) => x.patent_id !== id);
      db.files = db.files.filter((x) => x.patent_id !== id);
      persist(); return delay();
    },

    async addEvent(data) {
      const ok = canWrite(data.patent_id) || (perm('comment') && ['feedback', 'advisor', 'note'].includes(data.kind));
      if (!ok) deny();
      const e = { id: uid(), ...data, author_id: session.userId, created_at: now() };
      db.events.push(e); persist(); return delay(clone(e));
    },

    async deleteEvent(id) {
      const e = db.events.find((x) => x.id === id);
      if (!(perm('edit_all') || (e.author_id === session.userId && (canWrite(e.patent_id) || perm('comment'))))) deny();
      db.events = db.events.filter((x) => x.id !== id); persist(); return delay();
    },

    async uploadFile(patentId, file, note = '') {
      if (!(canWrite(patentId) || perm('comment'))) deny();
      let data = null;
      if (file.size <= 1.5 * 1024 * 1024) {
        data = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file);
        });
      }
      const f = { id: uid(), patent_id: patentId, name: file.name, storage_path: uid(), size: file.size,
        mime: file.type || '', note, uploaded_by: session.userId, created_at: now(), data };
      db.files.push(f);
      try { persist(); } catch (e) { db.files.pop(); throw e; }
      return delay();
    },

    async fileUrl(f) {
      const full = db.files.find((x) => x.id === f.id);
      if (!full?.data) throw new Error('演示模式下仅保存 1.5 MB 以内文件的内容，此文件只有记录');
      return full.data;
    },

    async fileBlob(f) {
      const url = await this.fileUrl(f);
      return (await fetch(url)).blob();
    },

    async deleteFile(f) {
      const x = db.files.find((y) => y.id === f.id);
      if (!(perm('edit_all') || (x.uploaded_by === session.userId && (canWrite(x.patent_id) || perm('comment'))))) deny();
      db.files = db.files.filter((y) => y.id !== f.id); persist(); return delay();
    },

    resetDemo() { localStorage.removeItem(DB_KEY); localStorage.removeItem(SES_KEY); },
  };
}
