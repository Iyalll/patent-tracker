// 演示后端：所有数据存在当前浏览器 localStorage，用于本地预览界面
// config.js 里填好 SUPABASE_URL / SUPABASE_KEY 后会自动切换到真实后端

const DB_KEY = 'pt_demo_db_v1';
const SES_KEY = 'pt_demo_session_v1';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
const now = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const dateAgo = (n) => daysAgo(n).slice(0, 10);

function seed() {
  const u1 = uid(), u2 = uid(), u3 = uid();
  const profiles = [
    { id: u1, name: '张三', role: 'admin', show_on_board: true, sort_order: 1, created_at: daysAgo(40) },
    { id: u2, name: '李四', role: 'member', show_on_board: true, sort_order: 2, created_at: daysAgo(40) },
    { id: u3, name: '王五', role: 'member', show_on_board: true, sort_order: 3, created_at: daysAgo(40) },
  ];
  const accounts = [
    { login: 'zhangsan', password: '123456', userId: u1 },
    { login: 'lisi', password: '123456', userId: u2 },
    { login: 'wangwu', password: '123456', userId: u3 },
  ];
  const P = (owner, title, progress, stage, kind = '发明专利', age = 20) => ({
    id: uid(), title, kind, owner_id: owner, progress, stage, due_date: null, description: '',
    created_by: owner, created_at: daysAgo(age), updated_at: daysAgo(Math.max(0, age - 10)),
  });
  const patents = [
    P(u1, '一种基于维修事件时间不确定性的装备退化训练样本构建方法', 100, '交专利中心审核', '发明专利', 30),
    P(u1, '一种基于故障语义锚点的跨型号装备故障理解与检索方法', 45, '撰写中'),
    P(u1, '一种根因不确定条件下的装备检查与维修联合决策方法', 20, '撰写中'),
    P(u1, '一种面向部件流转的装备健康状态迁移与一致性校验方法', 0, '撰写中'),
    P(u2, '一种非运行事件后装备健康预测模型的适用性判定方法', 60, '导师审核'),
    P(u2, '一种基于检查反馈的装备告警事件级阈值自适应方法', 10, '撰写中'),
    P(u2, '设备维护跨文档条件检索系统', 100, '交专利中心审核', '软件著作权', 28),
    P(u3, '一种面向航空发动机维修事件的异步多模态证据对齐与检索方法', 100, '返回修改', '发明专利', 32),
    P(u3, '一种基于发动机构型与维修文档适用性约束的多模态检索方法', 35, '撰写中'),
    P(u3, '一种基于诊断不确定性与检查信息增益的航空发动机故障追溯方法', 15, '撰写中'),
    P(u3, '一种考虑故障不确定性与维修恢复效果的航空发动机维修动作联合优化方法', 0, '撰写中'),
    P(u3, '一种基于部件谱系与构型变更的航空发动机健康状态继承方法', 0, '撰写中'),
  ];
  const E = (p, kind, content, d, author) => ({
    id: uid(), patent_id: p.id, kind, content, happened_on: dateAgo(d), author_id: author, created_at: daysAgo(d),
  });
  const events = [
    E(patents[0], 'submit', '交底书 v3 + 说明书初稿提交专利中心', 13, u1),
    E(patents[0], 'feedback', '技术交底检索：与现有退化建模方法的区别需进一步说明，建议在权利要求 1 中突出时间不确定性的处理步骤。', 5, u1),
    E(patents[4], 'advisor', '实施例部分再补一组对比实验，第 3 节公式符号与正文统一。', 2, u1),
    E(patents[6], 'submit', '软著申请材料（源代码 + 说明书）提交', 12, u2),
    E(patents[6], 'feedback', '技术交底检索通过，等待材料形式审查。', 5, u2),
    E(patents[7], 'submit', '说明书 + 权利要求书提交', 14, u3),
    E(patents[7], 'feedback', '技术交底检索：权利要求 2–4 与对比文件 D1 重合度较高，需要修改后重新提交。', 3, u3),
    E(patents[7], 'revise', '按反馈修改权利要求，说明书 v4 已上传', 1, u3),
  ];
  return { profiles, accounts, patents, events, files: [] };
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(DB_KEY));
    if (d && d.profiles) return d;
  } catch { /* ignore */ }
  const d = seed();
  localStorage.setItem(DB_KEY, JSON.stringify(d));
  return d;
}

const delay = (v) => new Promise((r) => setTimeout(() => r(v), 60));
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
  const isAdmin = () => me()?.role === 'admin';
  const deny = () => { throw new Error('没有权限执行该操作'); };

  return {
    mode: 'demo',
    demoAccounts: db.accounts.map((a) => a.login),

    getSession() { return session; },

    async signIn(login, password) {
      const a = db.accounts.find((x) => x.login === login.trim().split('@')[0]);
      if (!a || a.password !== password) throw new Error('用户名或密码错误');
      session = { userId: a.userId, email: `${a.login}@demo` };
      localStorage.setItem(SES_KEY, JSON.stringify(session));
      return delay();
    },

    async signOut() { session = null; localStorage.removeItem(SES_KEY); },

    async changePassword(pw) {
      const a = db.accounts.find((x) => x.userId === session.userId);
      a.password = pw; persist(); return delay();
    },

    async loadAll() {
      db = load();
      const { profiles, patents, events, files } = db;
      return delay(clone({
        profiles: [...profiles].sort((a, b) => a.sort_order - b.sort_order),
        patents, events: [...events].sort((a, b) => (b.happened_on + b.created_at).localeCompare(a.happened_on + a.created_at)),
        files: files.map(({ data, ...f }) => ({ ...f, _hasData: !!data })),
      }));
    },

    async updateProfile(id, patch) {
      if (id !== session.userId && !isAdmin()) deny();
      if (!isAdmin() && ('role' in patch || 'show_on_board' in patch || 'sort_order' in patch)) deny();
      Object.assign(db.profiles.find((p) => p.id === id), patch); persist(); return delay();
    },

    async deleteMember(id, transferTo = null) {
      if (id !== session.userId && !isAdmin()) deny();
      const target = db.profiles.find((p) => p.id === id);
      if (target.role === 'admin' && !db.profiles.some((p) => p.id !== id && p.role === 'admin')) {
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
      db.profiles = db.profiles.filter((p) => p.id !== id);
      db.accounts = db.accounts.filter((a) => a.userId !== id);
      persist(); return delay();
    },

    async createPatent(data) {
      if (data.owner_id !== session.userId && !isAdmin()) deny();
      const p = { id: uid(), description: '', due_date: null, progress: 0, stage: '撰写中', kind: '发明专利',
        ...data, created_by: session.userId, created_at: now(), updated_at: now() };
      db.patents.push(p); persist(); return delay(clone(p));
    },

    async updatePatent(id, patch) {
      const p = db.patents.find((x) => x.id === id);
      if (!p) throw new Error('条目不存在');
      if (p.owner_id !== session.userId && !isAdmin()) deny();
      if (patch.owner_id && patch.owner_id !== session.userId && !isAdmin()) deny();
      Object.assign(p, patch, { updated_at: now() }); persist(); return delay(clone(p));
    },

    async deletePatent(id) {
      const p = db.patents.find((x) => x.id === id);
      if (p.owner_id !== session.userId && !isAdmin()) deny();
      db.patents = db.patents.filter((x) => x.id !== id);
      db.events = db.events.filter((x) => x.patent_id !== id);
      db.files = db.files.filter((x) => x.patent_id !== id);
      persist(); return delay();
    },

    async addEvent(data) {
      const e = { id: uid(), ...data, author_id: session.userId, created_at: now() };
      db.events.push(e); persist(); return delay(clone(e));
    },

    async deleteEvent(id) {
      const e = db.events.find((x) => x.id === id);
      if (e.author_id !== session.userId && !isAdmin()) deny();
      db.events = db.events.filter((x) => x.id !== id); persist(); return delay();
    },

    async uploadFile(patentId, file, note = '') {
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

    async deleteFile(f) {
      const x = db.files.find((y) => y.id === f.id);
      if (x.uploaded_by !== session.userId && !isAdmin()) deny();
      db.files = db.files.filter((y) => y.id !== f.id); persist(); return delay();
    },

    resetDemo() { localStorage.removeItem(DB_KEY); localStorage.removeItem(SES_KEY); },
  };
}
