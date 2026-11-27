import { api } from './api.js';
import {
  esc, fmtDate, fmtShort, today, relTime, fmtSize, avatar, avatarColor, icon,
  toast, openModal, confirmDialog, busy,
} from './ui.js';
import { buildPreview, previewKind } from './preview.js';

const cfg = window.APP_CONFIG;
const STAGES = cfg.STAGES;
const KINDS = cfg.KINDS;
const EVENT_KINDS = {
  submit:   { label: '提交专利中心',   verb: '提交了专利中心',     cls: 'ev-submit',   stage: '交专利中心审核' },
  feedback: { label: '专利中心意见',   verb: '提出了专利中心意见', cls: 'ev-feedback', stage: '返回修改' },
  advisor:  { label: '老师批注',       verb: '进行了批注',         cls: 'ev-advisor',  stage: '' },
  revise:   { label: '修改 / 新版本',  verb: '上传了新版本',       cls: 'ev-revise',   stage: '' },
  note:     { label: '备注',           verb: '添加了备注',         cls: 'ev-note',     stage: '' },
};
const COMMENT_KINDS = ['feedback', 'advisor', 'note'];
const PERMS = [
  ['can_own', '可撰写', '新建 / 修改 / 删除自己名下的条目，上报进度、上传文件'],
  ['can_comment', '可审核', '对所有人的条目提出意见、批注、备注，上传批注文件；不能改别人的条目'],
  ['can_edit_all', '可修改所有', '修改、删除所有人的条目，删除任何人的记录和文件'],
  ['can_manage', '可管理', '管理账号（直接建号、重置密码）、人员名单、角色和注册设置'],
];
const PREVIEW_AUTO_MB = 8;

const S = { me: null, roles: [], profiles: [], roster: [], settings: [], patents: [], events: [], files: [], marks: [], loaded: false };
const UI = { expanded: new Set(), moreComments: false, preview: {}, pvForce: new Set(), loginTab: 'login', regInfo: null, booted: false };
const root = document.getElementById('app');
document.title = cfg.APP_NAME;

// ======================= 数据与权限 =======================
const profile = (id) => S.profiles.find((p) => p.id === id);
const patent = (id) => S.patents.find((p) => p.id === id);
const eventsOf = (pid) => S.events.filter((e) => e.patent_id === pid);
const filesOf = (pid) => S.files.filter((f) => f.patent_id === pid);
const lastEvent = (pid, kind) => eventsOf(pid).find((e) => e.kind === kind);       // events 已按时间倒序
const firstEvent = (pid, kind) => { const l = eventsOf(pid).filter((e) => e.kind === kind); return l[l.length - 1]; };
const patentsOf = (uid) => S.patents.filter((p) => p.owner_id === uid);
const roleOf = (p) => S.roles.find((r) => r.key === p?.role) || { label: p?.role || '—' };
const can = (flag) => !!roleOf(S.me)['can_' + flag];
const canEdit = (p) => can('edit_all') || (can('own') && p.owner_id === S.me?.id);
const canAddEvent = (p) => canEdit(p) || can('comment');
const kindsFor = (p) => (canEdit(p) ? Object.keys(EVENT_KINDS) : COMMENT_KINDS);
const canDelEvent = (e, p) => can('edit_all') || (e.author_id === S.me?.id && canAddEvent(p));
const canUpload = (p) => canEdit(p) || can('comment');
const canDelFile = (f, p) => can('edit_all') || (f.uploaded_by === S.me?.id && canUpload(p));
const canCreate = () => can('own') || can('edit_all');
const canDelMember = (m) => can('manage') || m.id === S.me?.id;
const boardMembers = () => S.profiles.filter((p) => p.show_on_board);
const stageOf = (name) => STAGES.find((s) => s.name === name) || { name, color: '#868e96', bg: '#f1f3f5' };
const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
const setting = (key) => S.settings.find((s) => s.key === key)?.value ?? '';
const parseAliases = (s) => String(s || '').split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean);

const ts = (x) => (x ? Date.parse(x) || 0 : 0);
const maxTs = (...xs) => Math.max(0, ...xs.map(ts));
// 「学生型」账号：只撰写自己的条目，登录后直接进自己的页面
const isWriterOnly = () => can('own') && !can('comment') && !can('manage') && !can('edit_all');
// 彩色姓名标签
const who = (p, fallback = '已删除成员') =>
  `<span class="who" style="--c:${avatarColor(p?.id || '')}" title="${esc(roleOf(p).label || '')}">${esc(p?.name || fallback)}</span>`;

// 别人（老师 / 专利中心 / 管理员）对这篇条目的意见
const isReviewComment = (e, p = patent(e.patent_id)) => p && COMMENT_KINDS.includes(e.kind) && e.author_id && e.author_id !== p.owner_id;
// 撰写人还没处理的新意见：意见晚于条目最后一次修改
const newComments = (p) => eventsOf(p.id).filter((e) => isReviewComment(e, p) && ts(e.created_at) > ts(p.updated_at));

// ---- 审核人通知：撰写人在「我上次处理之后」新增的记录和文件 ----
// 处理 = 手动忽略，或我在这篇条目里留了意见 / 传了文件
function noticeBase(p) {
  const mark = S.marks.find((m) => m.patent_id === p.id)?.seen_at;
  const myEv = eventsOf(p.id).filter((e) => e.author_id === S.me.id).map((e) => e.created_at);
  const myFiles = filesOf(p.id).filter((f) => f.uploaded_by === S.me.id).map((f) => f.created_at);
  return maxTs(mark, S.me.created_at, ...myEv, ...myFiles);
}
function noticeItems(p) {
  if (!can('comment') || p.owner_id === S.me.id) return [];
  const base = noticeBase(p);
  const evs = eventsOf(p.id).filter((e) => e.author_id === p.owner_id && ts(e.created_at) > base)
    .map((e) => ({ type: 'event', kind: e.kind, at: e.created_at, id: e.id }));
  const fs = filesOf(p.id).filter((f) => f.uploaded_by === p.owner_id && ts(f.created_at) > base)
    .map((f) => ({ type: 'file', at: f.created_at, id: f.id }));
  return [...evs, ...fs].sort((a, b) => ts(b.at) - ts(a.at));
}
function myNotices() {
  if (!can('comment')) return [];
  return S.patents.map((p) => ({ p, items: noticeItems(p) })).filter((n) => n.items.length)
    .sort((a, b) => ts(b.items[0].at) - ts(a.items[0].at));
}
function noticeSummary(items) {
  const parts = {};
  for (const it of items) {
    const label = it.type === 'file' ? '上传文件' : (EVENT_KINDS[it.kind] || EVENT_KINDS.note).label;
    parts[label] = (parts[label] || 0) + 1;
  }
  return Object.entries(parts).map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join('、');
}
const noticeBadge = (p) => (noticeItems(p).length ? `<span class="badge-notice" title="撰写人有新的提交或文件">新动态</span>` : '');
function noticeList(list, compact = false) {
  if (!list.length) return `<div class="empty small">没有待查看的新动态</div>`;
  return list.map(({ p, items }) => `<div class="nt-item">
      <a class="nt-main" href="#/patent/${p.id}">
        <span class="nt-top">${who(profile(p.owner_id))}<span class="nt-title">《${esc(p.title)}》</span></span>
        <span class="nt-sum"><span class="badge-notice">${items.length} 条新动态</span>${esc(noticeSummary(items))} · ${relTime(items[0].at)}</span>
      </a>
      <button class="btn sm ghost" data-action="dismiss" data-id="${p.id}" title="标为已处理，不再提醒">忽略</button>
    </div>`).join('') + (compact ? '' : '');
}

const pill = (stage, cls = '') => {
  const s = stageOf(stage);
  return `<span class="pill ${cls}" style="--pc:${s.color};--pb:${s.bg}">${esc(s.name)}</span>`;
};
const bar = (v, cls = '') => `<span class="bar ${cls} ${v >= 100 ? 'done' : ''}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></span>`;
const newBadge = (n) => (n ? `<span class="badge-new" title="有 ${n} 条新意见待处理">新意见${n > 1 ? ' ' + n : ''}</span>` : '');

async function reload() {
  const d = await api.loadAll();
  Object.assign(S, d);
  S.me = S.profiles.find((p) => p.id === api.getSession()?.userId) || null;
  S.loaded = true;
}

async function run(fn, okMsg, refreshOnError = false) {
  try {
    await fn();
    await reload();
    render();
    if (okMsg) toast(okMsg, 'ok');
    return true;
  } catch (e) {
    handleErr(e);
    if (refreshOnError && e?.code !== 'AUTH') { try { await reload(); render(); } catch { /* ignore */ } }
    return false;
  }
}

function handleErr(e) {
  console.error(e);
  if (e?.code === 'AUTH') {
    S.loaded = false;
    toast(e.message || '请重新登录', 'error');
    renderLogin();
    return;
  }
  toast(e?.message || String(e), 'error');
}

// ======================= 路由 =======================
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, id] = h.split('/');
  return { name: name || 'home', id };
}

async function render() {
  if (!api.getSession()) return renderLogin();
  if (!S.loaded) {
    root.innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;
    try { await reload(); } catch (e) { return handleErr(e); }
  }
  if (!S.me) {
    root.innerHTML = `<div class="center-screen"><div class="card narrow">
      <h2>账号未加入成员表</h2>
      <p class="muted">登录成功，但数据库里没有你的成员记录。请管理员重新执行 supabase/schema.sql（会自动补建）。</p>
      <button class="btn" data-action="logout">退出登录</button></div></div>`;
    return;
  }
  // 只撰写自己条目的账号，打开网站直接进入自己的页面
  if (!UI.booted) {
    UI.booted = true;
    if ((!location.hash || location.hash === '#') && isWriterOnly()) {
      location.replace(`#/member/${S.me.id}`);
      return;
    }
  }
  const r = parseRoute();
  let view;
  if (r.name === 'member' && profile(r.id)) view = viewMember(profile(r.id));
  else if (r.name === 'patent' && patent(r.id)) view = viewPatent(patent(r.id));
  else if (r.name === 'all') view = viewAll();
  else if ((r.name === 'admin' || r.name === 'team') && can('manage')) view = viewAdmin(r.id);
  else view = viewHome();

  const mine = r.name === 'member' && r.id === S.me.id;
  const active = (name) => (name === 'mine' ? mine
    : r.name === name || (name === 'home' && !mine && ['member', 'patent'].includes(r.name)) || (name === 'admin' && r.name === 'team'));
  const notices = myNotices();
  const nav = (name, label, href) => `<a href="${href}" class="${active(name) ? 'active' : ''}">${label}</a>`;

  root.innerHTML = `
    <header class="topbar"><div class="wrap topbar-in">
      <a class="brand" href="#/"><span class="brand-mark"></span><span class="brand-text">${esc(cfg.APP_NAME)}</span></a>
      <nav class="nav">
        ${can('own') ? nav('mine', '我的条目', `#/member/${S.me.id}`) : ''}
        ${nav('home', '总览', '#/')}
        ${nav('all', '全部条目', '#/all')}
        ${can('manage') ? nav('admin', '管理', '#/admin') : ''}
      </nav>
      <div class="spacer"></div>
      ${api.mode === 'demo' ? '<span class="demo-badge" title="未配置 Supabase，数据只保存在当前浏览器">演示模式</span>' : ''}
      ${can('comment') ? `<div class="bell-wrap">
        <button class="bell ${notices.length ? 'has' : ''}" data-action="bell" title="待查看的新动态">${icon.bell}${notices.length ? `<span class="bell-n">${notices.length}</span>` : ''}</button>
        <div class="bell-menu" hidden>
          <div class="bell-head"><b>待查看的新动态</b>${notices.length ? '<button class="link-btn" data-action="dismiss-all">全部忽略</button>' : ''}</div>
          <div class="bell-list">${noticeList(notices.slice(0, 12))}</div>
        </div>
      </div>` : ''}
      <div class="user-menu">
        <button class="user-btn" data-action="menu">${avatar(S.me, 'sm')}<span>${esc(S.me.name)}</span>${icon.down}</button>
        <div class="menu" hidden>
          <div class="menu-who"><b>${esc(S.me.name)}</b><span class="muted small">${esc(roleOf(S.me).label)}${S.me.username ? ' · ' + esc(S.me.username) : ''}</span></div>
          <hr>
          <button data-action="rename-self">修改显示名</button>
          <button data-action="change-pw">修改密码</button>
          ${api.mode === 'demo' ? '<button data-action="reset-demo">重置演示数据</button>' : ''}
          <hr><button data-action="logout">退出登录</button>
        </div>
      </div>
    </div></header>
    <main class="wrap main">${view}</main>`;
  afterRender();
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

// ======================= 登录 / 注册 =======================
function renderLogin() {
  const demo = api.mode === 'demo';
  const reg = UI.loginTab === 'register';
  const info = UI.regInfo;
  root.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="brand lg"><span class="brand-mark"></span>${esc(cfg.APP_NAME)}</div>
        <p class="muted small">仅限团队成员使用</p>
        <div class="seg">
          <button class="${reg ? '' : 'on'}" data-action="login-tab" data-tab="login">登录</button>
          <button class="${reg ? 'on' : ''}" data-action="login-tab" data-tab="register">注册账号</button>
        </div>
        ${reg ? `
        <form class="form" data-form="register" autocomplete="off">
          ${info?.error ? `<div class="form-alert">注册服务暂不可用：${esc(info.error)}</div>` : ''}
          <label class="field"><span>姓名</span><input name="name" required placeholder="人员名单中的姓名或别名" data-check-name>
            <em class="hint" data-name-hint>只有名单里的人可以注册；不在名单请联系管理员</em></label>
          <label class="field"><span>用户名（用于登录）</span><input name="username" required placeholder="小写字母 / 数字 / 拼音，如 zhangsan" autocomplete="username"></label>
          <div class="form-row">
            <label class="field"><span>密码</span><input name="password" type="password" minlength="6" required autocomplete="new-password"></label>
            <label class="field"><span>确认密码</span><input name="password2" type="password" minlength="6" required autocomplete="new-password"></label>
          </div>
          ${info?.code_required ? `<label class="field"><span>注册码</span><input name="code" required placeholder="向管理员获取"></label>` : ''}
          <button class="btn primary block" type="submit">注册并登录</button>
        </form>` : `
        <form class="form" data-form="login" autocomplete="on">
          <label class="field"><span>用户名 / 姓名</span><input name="login" autocomplete="username" required placeholder="用户名，或名单中的姓名"></label>
          <label class="field"><span>密码</span><input name="password" type="password" autocomplete="current-password" required></label>
          <button class="btn primary block" type="submit">登录</button>
        </form>`}
        ${demo ? `<div class="demo-hint">演示模式 · 账号 <code>zhangsan</code>（管理员）/ <code>lisi</code>（学生）/ <code>chen</code>（老师），密码 <code>123456</code>；名单中「赵六」尚未注册，可用来试注册</div>` : ''}
      </div>
    </div>`;
}

async function loadRegInfo() {
  try { UI.regInfo = await api.registrationInfo(); } catch (e) { UI.regInfo = { error: e.message }; }
  if (UI.loginTab !== 'register' || api.getSession()) return;
  // 重新渲染但保留用户已经输入的内容
  const form = root.querySelector('[data-form=register]');
  const values = form ? Object.fromEntries(new FormData(form)) : {};
  const hint = root.querySelector('[data-name-hint]');
  const hintState = hint && [hint.textContent, hint.className];
  const focused = document.activeElement?.name;
  renderLogin();
  const nf = root.querySelector('[data-form=register]');
  for (const [k, v] of Object.entries(values)) if (nf.elements[k]) nf.elements[k].value = v;
  if (hintState) { const h = root.querySelector('[data-name-hint]'); [h.textContent, h.className] = hintState; }
  if (focused && nf.elements[focused]) nf.elements[focused].focus();
}

// ======================= 总览 =======================
function viewHome() {
  const ps = S.patents;
  const submitted = ps.filter((p) => lastEvent(p.id, 'submit')).length;
  const toFix = ps.filter((p) => p.stage === '返回修改').length;
  const pending = ps.filter((p) => newComments(p).length).length;

  const stats = [
    ['条目总数', ps.length, ''],
    ['已交专利中心', submitted, ''],
    ['返回修改', toFix, toFix ? 'warn' : ''],
    ['有新意见待处理', pending, pending ? 'warn' : ''],
  ].map(([k, v, c]) => `<div class="stat ${c}"><div class="stat-v">${v}</div><div class="stat-k">${k}</div></div>`).join('');

  // 专利中心 / 老师意见
  const comments = S.events.filter((e) => isReviewComment(e))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const shown = comments.slice(0, UI.moreComments ? 20 : 4);
  const commentBox = `<section class="card cm-box">
    <div class="cm-head"><h2 class="sec-title in-card">专利中心 / 老师意见 <span class="count">${comments.length}</span></h2></div>
    ${shown.map((e) => {
      const p = patent(e.patent_id);
      const k = EVENT_KINDS[e.kind];
      const isNew = ts(e.created_at) > ts(p.updated_at);
      return `<a class="cm-row" href="#/patent/${p.id}">
        <span class="cm-date">${fmtShort(e.happened_on)}</span>
        <span class="ev-dot ${k.cls}"></span>
        <span class="cm-text">${who(profile(e.author_id))} 对 ${who(profile(p.owner_id))}《${esc(p.title)}》${k.verb}${e.content ? '：' : ''}<span class="muted">${esc(e.content)}</span></span>
        ${isNew ? '<span class="badge-new">未处理</span>' : ''}
      </a>`;
    }).join('') || '<div class="empty small">暂无意见</div>'}
    ${comments.length > 4 ? `<button class="link-btn" data-action="more-comments">${UI.moreComments ? '收起' : `查看更多（共 ${comments.length} 条）`}</button>` : ''}
  </section>`;

  const recentEvents = S.events.filter((e) => patent(e.patent_id)).slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10);
  const feedLine = (e) => {
    const p = patent(e.patent_id);
    const k = EVENT_KINDS[e.kind] || EVENT_KINDS.note;
    return `<a class="feed-row" href="#/patent/${p.id}" title="${esc(e.content)}">
      <span class="ev-dot ${k.cls}"></span><span class="fr-kind">${esc(k.label)}</span>
      <span class="fr-who">${esc(profile(e.author_id)?.name || '')}</span>
      <span class="fr-title">${esc(p.title)}</span><span class="fr-content">${esc(e.content)}</span>
      <span class="fr-date">${fmtShort(e.happened_on)}</span></a>`;
  };
  const latest = recentEvents[0];
  const feedOpen = localStorage.getItem('pt_feed_open') === '1';
  const feed = `<details class="card feed-box" data-feed ${feedOpen ? 'open' : ''}>
    <summary><span class="fb-title">全部动态</span><span class="count">${recentEvents.length}</span>
      <span class="fb-latest">${latest ? `<span class="ev-dot ${(EVENT_KINDS[latest.kind] || EVENT_KINDS.note).cls}"></span>${esc(profile(latest.author_id)?.name || '')} · ${esc((EVENT_KINDS[latest.kind] || EVENT_KINDS.note).label)} · ${esc(patent(latest.patent_id).title)}` : '暂无动态'}</span>
      <span class="fb-toggle">${icon.down}</span></summary>
    <div class="feed-list">${recentEvents.map(feedLine).join('') || '<div class="empty small">暂无动态</div>'}</div>
  </details>`;

  const members = boardMembers().map(memberCard).join('') ||
    `<div class="empty">还没有在首页显示的成员。${can('manage') ? '可在「管理 → 账号」里勾选「首页显示」。' : ''}</div>`;

  return `
    <div class="page-head">
      <div><h1>团队进度</h1><p class="muted">${today()} · ${boardMembers().length} 位成员</p></div>
      ${canCreate() ? `<button class="btn primary" data-action="new-patent">${icon.plus}新建条目</button>` : ''}
    </div>
    <div class="stats">${stats}</div>
    ${can('comment') ? `<section class="card nt-box">
      <div class="cm-head"><h2 class="sec-title in-card">待查看的新动态 <span class="count ${myNotices().length ? 'hot' : ''}">${myNotices().length}</span></h2>
        ${myNotices().length ? '<button class="link-btn" data-action="dismiss-all">全部忽略</button>' : ''}</div>
      <p class="muted small nt-tip">撰写人在你上次处理之后新增的提交、修改和文件。你在该条目里留下意见或上传文件后自动消失，也可以点「忽略」。</p>
      ${noticeList(myNotices())}
    </section>` : ''}
    ${commentBox}
    ${feed}
    <h2 class="sec-title">成员</h2>
    <div class="member-grid">${members}</div>`;
}

function stageBar(list) {
  if (!list.length) return '<div class="stagebar empty-bar"></div>';
  const segs = STAGES.map((s) => [s, list.filter((p) => p.stage === s.name).length]).filter(([, n]) => n);
  const other = list.filter((p) => !STAGES.some((s) => s.name === p.stage)).length;
  if (other) segs.push([{ name: '其他', color: '#868e96' }, other]);
  return `<div class="stagebar">${segs.map(([s, n]) =>
    `<i style="flex:${n};background:${s.color}" title="${esc(s.name)} ${n}"></i>`).join('')}</div>
    <div class="stage-legend">${segs.map(([s, n]) => `<span><i style="background:${s.color}"></i>${esc(s.name)} <b>${n}</b></span>`).join('')}</div>`;
}

function memberCard(m) {
  const list = patentsOf(m.id).slice().sort((a, b) =>
    newComments(b).length - newComments(a).length || String(b.updated_at).localeCompare(String(a.updated_at)));
  const done = list.filter((p) => p.progress >= 100).length;
  const nNew = list.filter((p) => newComments(p).length).length;
  const open = UI.expanded.has(m.id);
  return `<div class="card member-card ${open ? 'expanded' : ''}" data-card="${m.id}">
    <div class="mc-head">
      <a class="mc-link" href="#/member/${m.id}">
        ${avatar(m, 'lg')}
        <div class="mc-who"><div class="mc-name">${esc(m.name)} <span class="role-tag">${esc(roleOf(m).label)}</span></div>
          <div class="muted small">${list.length} 篇 · 完成撰写 ${done}${nNew ? ` · <span class="warn-text">${nNew} 篇有新意见</span>` : ''}</div></div>
      </a>
      ${canDelMember(m) ? `<button class="icon-btn subtle mc-del" data-action="del-member" data-id="${m.id}" title="删除成员">${icon.trash}</button>` : ''}
    </div>
    ${stageBar(list)}
    <ul class="mc-list">
      ${list.map((p, i) => `<li class="${i >= 3 ? 'extra' : ''}"><a href="#/patent/${p.id}">
        <span class="mc-t">${esc(p.title)}</span><span class="mc-b">${newBadge(newComments(p).length)}${noticeBadge(p)}</span>
        ${bar(p.progress, 'thin')}<span class="mc-p">${p.progress}%</span>${pill(p.stage, 'sm')}</a></li>`).join('')}
      ${!list.length ? '<li class="more">暂无条目</li>' : ''}
    </ul>
    ${list.length > 3 ? `<button class="mc-more" data-action="toggle-card" data-id="${m.id}">
      <span class="when-closed">展开全部 ${list.length} 篇</span><span class="when-open">收起</span>${icon.down}</button>` : ''}
  </div>`;
}

// ======================= 个人页 =======================
function viewMember(m) {
  const list = patentsOf(m.id).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const canNew = can('edit_all') || (can('own') && m.id === S.me.id);
  const rows = list.map(itemRow).join('') || `<div class="empty">还没有条目${canNew ? '，点击右上角「新建条目」添加' : ''}</div>`;
  return `
    <div class="crumbs"><a href="#/">总览</a>${icon.chevron}<span>${esc(m.name)}</span></div>
    <div class="page-head">
      <div class="person-head">${avatar(m, 'xl')}<div>
        <h1>${esc(m.name)} <span class="role-tag lg">${esc(roleOf(m).label)}</span></h1>
        <p class="muted">${list.length} 篇 · 平均进度 ${avg(list.map((p) => p.progress))}% · 已交专利中心 ${list.filter((p) => lastEvent(p.id, 'submit')).length}</p>
      </div></div>
      <div class="head-actions">
        ${canDelMember(m) ? `<button class="btn ghost danger-text" data-action="del-member" data-id="${m.id}">${icon.trash}${m.id === S.me.id ? '注销我的账号' : '删除成员'}</button>` : ''}
        ${canNew ? `<button class="btn primary" data-action="new-patent" data-owner="${m.id}">${icon.plus}新建条目</button>` : ''}
      </div>
    </div>
    ${list.length ? `<div class="stage-wrap">${stageBar(list)}</div>` : ''}
    <div class="item-list">${rows}</div>`;
}

function itemRow(p) {
  const sub = firstEvent(p.id, 'submit');
  const fb = eventsOf(p.id).find((e) => isReviewComment(e, p));
  const nf = filesOf(p.id).length;
  return `<a class="card item-row" href="#/patent/${p.id}">
    <div class="ir-main">
      <div class="ir-title">${esc(p.title)} ${newBadge(newComments(p).length)}${noticeBadge(p)}</div>
      <div class="ir-meta"><span class="tag">${esc(p.kind)}</span><span class="muted">更新于 ${relTime(p.updated_at)}</span>
        ${p.due_date ? `<span class="muted">· 截止 ${fmtDate(p.due_date)}</span>` : ''}</div>
      ${fb ? `<div class="ir-fb"><span class="ev-dot ${EVENT_KINDS[fb.kind].cls}"></span><b>${fmtShort(fb.happened_on)} ${esc(profile(fb.author_id)?.name || '')}：</b>${esc(fb.content)}</div>` : ''}
    </div>
    <div class="ir-prog">${bar(p.progress)}<span>${p.progress}%</span></div>
    <div class="ir-stage">${pill(p.stage)}</div>
    <div class="ir-dates">
      <div><span class="muted">提交</span> ${sub ? fmtDate(sub.happened_on) : '—'}</div>
      <div><span class="muted">意见</span> ${fb ? fmtDate(fb.happened_on) : '—'}</div>
    </div>
    <div class="ir-files" title="文件数">${icon.clip}${nf}</div>
  </a>`;
}

// ======================= 条目详情 =======================
function viewPatent(p) {
  const owner = profile(p.owner_id);
  const editable = canEdit(p);
  const evs = eventsOf(p.id);
  const fs = filesOf(p.id);
  const sub = firstEvent(p.id, 'submit');
  const fb = evs.find((e) => isReviewComment(e, p));
  const nNew = newComments(p).length;
  const nItems = noticeItems(p);
  const nIds = new Set(nItems.map((x) => x.id));

  const timeline = evs.map((e) => {
    const k = EVENT_KINDS[e.kind] || EVENT_KINDS.note;
    const fromOther = isReviewComment(e, p);
    const isNew = fromOther && ts(e.created_at) > ts(p.updated_at);
    return `<li class="tl-item ${fromOther ? 'from-other' : ''} ${nIds.has(e.id) ? 'is-notice' : ''}">
      <span class="ev-dot ${k.cls}"></span>
      <div class="tl-body">
        <div class="tl-top"><b>${k.label}</b>${who(profile(e.author_id))}<span class="muted">${fmtDate(e.happened_on)}</span>
          ${isNew ? '<span class="badge-new">新</span>' : ''}${nIds.has(e.id) ? '<span class="badge-notice">新动态</span>' : ''}
          ${canDelEvent(e, p) ? `<button class="icon-btn subtle" data-action="del-event" data-id="${e.id}" title="删除">${icon.trash}</button>` : ''}</div>
        ${e.content ? `<div class="tl-content">${esc(e.content)}</div>` : ''}
      </div></li>`;
  }).join('');

  // 预览：默认第一个可预览的文件
  let pvId = UI.preview[p.id];
  if (!fs.some((f) => f.id === pvId)) pvId = (fs.find((f) => previewKind(f.name)) || fs[0])?.id;
  const pvFile = fs.find((f) => f.id === pvId);

  const files = fs.map((f) => `<li class="file-item ${f.id === pvId ? 'on' : ''}">
      <button class="file-pick" data-action="pv-file" data-id="${f.id}" title="预览">
        <span class="file-ic">${icon.file}</span>
        <span class="file-main"><span class="file-name">${esc(f.name)}</span>
          <span class="muted small">${nIds.has(f.id) ? '<span class="badge-notice">新</span> ' : ''}${fmtSize(f.size)} · ${esc(profile(f.uploaded_by)?.name || '')} · ${relTime(f.created_at)}${f.note ? ` · ${esc(f.note)}` : ''}</span></span>
      </button>
      <button class="icon-btn" data-action="dl-file" data-id="${f.id}" title="下载">${icon.download}</button>
      ${canDelFile(f, p) ? `<button class="icon-btn subtle" data-action="del-file" data-id="${f.id}" title="删除">${icon.trash}</button>` : ''}
    </li>`).join('');

  const kinds = kindsFor(p);
  const defKind = editable ? 'submit' : 'feedback';
  const kindOpts = kinds.map((k) => `<option value="${k}" ${k === defKind ? 'selected' : ''}>${EVENT_KINDS[k].label}</option>`).join('');
  const stageOpts = (sel) => STAGES.map((s) => `<option ${s.name === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

  let note = '';
  if (!editable && can('comment')) note = `<div class="readonly-note review">审核模式 · 你可以对 ${esc(owner?.name || '')} 的这篇条目提出意见、批注，或上传批注文件；不能修改条目本身</div>`;
  else if (!editable) note = `<div class="readonly-note">只读 · 这是 ${esc(owner?.name || '')} 的条目，你可以查看和下载文件</div>`;

  return `
    <div class="crumbs"><a href="#/">总览</a>${icon.chevron}<a href="#/member/${owner?.id}">${esc(owner?.name || '')}</a>${icon.chevron}<span class="clip">${esc(p.title)}</span></div>
    <div class="page-head detail-head">
      <div>
        <div class="tags"><span class="tag">${esc(p.kind)}</span>${pill(p.stage)}${newBadge(nNew)}</div>
        <h1 class="detail-title">${esc(p.title)}</h1>
        <p class="muted">撰写人 ${esc(owner?.name || '')} · 创建于 ${fmtDate(p.created_at)} · 更新于 ${relTime(p.updated_at)}</p>
      </div>
      ${editable ? `<div class="head-actions">
        <button class="btn" data-action="edit-patent" data-id="${p.id}">${icon.edit}编辑</button>
        <button class="btn ghost danger-text" data-action="del-patent" data-id="${p.id}">${icon.trash}删除</button></div>` : ''}
    </div>

    <div class="card overview">
      <div class="ov-cell ov-prog">
        <div class="ov-k">撰写进度</div>
        <div class="ov-prog-row">
          ${editable
            ? `<input type="range" min="0" max="100" step="5" value="${p.progress}" data-change="progress" data-id="${p.id}" style="--v:${p.progress}%">`
            : bar(p.progress)}
          <span class="ov-big" data-progress-label>${p.progress}%</span>
        </div>
      </div>
      <div class="ov-cell"><div class="ov-k">当前阶段</div>
        ${editable ? `<select class="stage-select" data-change="stage" data-id="${p.id}">${stageOpts(p.stage)}</select>` : pill(p.stage)}</div>
      <div class="ov-cell"><div class="ov-k">首次提交</div><div class="ov-v">${sub ? fmtDate(sub.happened_on) : '—'}</div></div>
      <div class="ov-cell"><div class="ov-k">最近意见</div><div class="ov-v">${fb ? fmtDate(fb.happened_on) : '—'}</div></div>
      <div class="ov-cell"><div class="ov-k">截止日期</div><div class="ov-v">${p.due_date ? fmtDate(p.due_date) : '—'}</div></div>
    </div>
    ${nItems.length ? `<div class="notice-bar">${icon.bell}<span>${who(owner)} 在你上次处理之后有 <b>${nItems.length}</b> 条新动态：${esc(noticeSummary(nItems))}。留下意见后会自动标为已处理。</span>
      <button class="btn sm" data-action="dismiss" data-id="${p.id}">标为已处理</button></div>` : ''}
    ${note}
    ${p.description ? `<div class="card desc"><div class="ov-k">说明</div><div class="desc-text">${esc(p.description)}</div></div>` : ''}

    <div class="detail-grid">
      <section class="card">
        <h2 class="sec-title in-card">进展记录 <span class="count">${evs.length}</span></h2>
        ${canAddEvent(p) ? `<form class="event-form" data-form="add-event" data-id="${p.id}">
          <div class="ef-row">
            <select name="kind" data-change="event-kind">${kindOpts}</select>
            <input type="date" name="happened_on" value="${today()}" required>
          </div>
          <textarea name="content" rows="2" placeholder="${editable ? '内容：提交了哪些材料 / 收到的意见 / 修改说明…' : '意见 / 批注内容，会同步显示在撰写人的进展记录和首页'}"></textarea>
          <div class="ef-row">
            ${editable ? `<label class="inline muted small">同时把阶段改为
              <select name="stage_sync"><option value="">不变</option>${STAGES.map((s) => `<option ${s.name === EVENT_KINDS[defKind].stage ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : '<span></span>'}
            <button class="btn primary sm" type="submit">${icon.send}${editable ? '添加记录' : '提交意见'}</button>
          </div>
        </form>` : ''}
        <ul class="timeline">${timeline || '<li class="empty small">还没有记录</li>'}</ul>
      </section>

      <section class="card files-card">
        <h2 class="sec-title in-card">文件 <span class="count">${fs.length}</span></h2>
        ${pvFile ? `<div class="pv-box" data-pv="${pvFile.id}">
          <div class="pv-head"><span class="pv-name" title="${esc(pvFile.name)}">${esc(pvFile.name)}</span>
            <button class="icon-btn" data-action="pv-full" data-id="${pvFile.id}" title="全屏预览">${icon.expand}</button>
            <button class="icon-btn" data-action="dl-file" data-id="${pvFile.id}" title="下载">${icon.download}</button></div>
          <div class="pv-body"><div class="pv-msg">加载预览…</div></div>
        </div>` : ''}
        ${canUpload(p) ? `<label class="dropzone" data-drop="${p.id}">
          <input type="file" multiple data-change="upload" data-id="${p.id}" hidden>
          ${icon.upload}<span>点击或拖拽文件上传${editable ? '' : '（批注文件）'}</span><span class="muted small">单个文件 ≤ ${cfg.MAX_FILE_MB} MB</span>
        </label>
        <input class="file-note" placeholder="文件备注（可选，例如：说明书 v3 / 批注版）" data-file-note>` : ''}
        <ul class="file-list">${files || '<li class="empty small">还没有文件</li>'}</ul>
      </section>
    </div>`;
}

// ---------- 文件预览 ----------
async function fillPreview(box, file, force = false) {
  const body = box.querySelector('.pv-body');
  const kind = previewKind(file.name);
  if (!kind) {
    body.innerHTML = `<div class="pv-msg">该格式暂不支持在线预览<br><span class="small">支持 PDF、Word(.docx)、图片、文本</span></div>`;
    return;
  }
  if (!force && !UI.pvForce.has(file.id) && file.size > PREVIEW_AUTO_MB * 1024 * 1024) {
    body.innerHTML = `<div class="pv-msg">文件较大（${fmtSize(file.size)}）<br><button class="btn sm" data-action="pv-load" data-id="${file.id}">加载预览</button></div>`;
    return;
  }
  body.innerHTML = `<div class="pv-msg"><div class="spinner sm"></div>加载预览…</div>`;
  try {
    const node = await buildPreview(file, () => api.fileBlob(file));
    if (!box.isConnected || box.dataset.pv !== file.id) return;
    body.replaceChildren(node);
  } catch (e) {
    if (box.isConnected) body.innerHTML = `<div class="pv-msg">无法预览：${esc(e.message || e)}</div>`;
  }
}

function afterRender() {
  const box = root.querySelector('[data-pv]');
  if (box) {
    const f = S.files.find((x) => x.id === box.dataset.pv);
    if (f) fillPreview(box, f);
  }
}

// ======================= 全部条目 =======================
const F = { q: '', owner: '', stage: '', kind: '' };

function viewAll() {
  const sel = (key, opts, label) =>
    `<select data-filter="${key}"><option value="">${label}</option>${opts.map(([v, t]) => `<option value="${esc(v)}" ${F[key] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const owners = S.profiles.filter((p) => patentsOf(p.id).length || p.show_on_board);
  return `
    <div class="page-head"><div><h1>全部条目</h1><p class="muted">共 ${S.patents.length} 条</p></div>
      ${canCreate() ? `<button class="btn primary" data-action="new-patent">${icon.plus}新建条目</button>` : ''}</div>
    <div class="filters">
      <label class="search">${icon.search}<input data-filter="q" placeholder="搜索名称" value="${esc(F.q)}"></label>
      ${sel('owner', owners.map((p) => [p.id, p.name]), '全部撰写人')}
      ${sel('stage', STAGES.map((s) => [s.name, s.name]), '全部阶段')}
      ${sel('kind', KINDS.map((k) => [k, k]), '全部类型')}
    </div>
    <div class="card table-card"><table class="table">
      <thead><tr><th class="num">#</th><th>名称</th><th>撰写人</th><th>进度</th><th>阶段</th><th>提交时间</th><th>最近意见</th><th class="num">文件</th></tr></thead>
      <tbody data-table>${tableRows()}</tbody></table></div>`;
}

function tableRows() {
  const order = new Map(S.profiles.map((p, i) => [p.id, i]));
  const list = S.patents
    .filter((p) => (!F.q || p.title.toLowerCase().includes(F.q.toLowerCase()))
      && (!F.owner || p.owner_id === F.owner) && (!F.stage || p.stage === F.stage) && (!F.kind || p.kind === F.kind))
    .sort((a, b) => (order.get(a.owner_id) ?? 0) - (order.get(b.owner_id) ?? 0) || String(a.created_at).localeCompare(String(b.created_at)));
  if (!list.length) return '<tr><td colspan="8" class="empty">没有匹配的条目</td></tr>';
  return list.map((p, i) => {
    const sub = firstEvent(p.id, 'submit');
    const fb = eventsOf(p.id).find((e) => isReviewComment(e, p));
    return `<tr data-href="#/patent/${p.id}">
      <td class="num muted">${i + 1}</td>
      <td class="t-title"><span class="tag sm">${esc(p.kind)}</span>${esc(p.title)} ${newBadge(newComments(p).length)}${noticeBadge(p)}</td>
      <td class="nowrap">${esc(profile(p.owner_id)?.name || '')}</td>
      <td class="t-prog">${bar(p.progress, 'thin')}<span>${p.progress}%</span></td>
      <td>${pill(p.stage)}</td>
      <td class="nowrap">${sub ? fmtDate(sub.happened_on) : '<span class="muted">—</span>'}</td>
      <td class="t-fb">${fb ? `<span class="nowrap">${fmtDate(fb.happened_on)} · ${esc(profile(fb.author_id)?.name || '')}</span><span class="muted fb-txt">${esc(fb.content)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="num">${filesOf(p.id).length || '<span class="muted">0</span>'}</td>
    </tr>`;
  }).join('');
}

// ======================= 管理 =======================
function viewAdmin(tab) {
  tab = ['accounts', 'roster', 'roles', 'settings'].includes(tab) ? tab : 'accounts';
  const tabs = [['accounts', '账号'], ['roster', '人员名单'], ['roles', '角色与权限'], ['settings', '注册设置']]
    .map(([k, l]) => `<a href="#/admin/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('');
  const body = { accounts: adminAccounts, roster: adminRoster, roles: adminRoles, settings: adminSettings }[tab]();
  return `<div class="page-head"><div><h1>管理</h1><p class="muted">修改后自动保存</p></div></div>
    <div class="tabs">${tabs}</div>${body}`;
}

const roleSelect = (name, value, attrs = '') =>
  `<select name="${name}" ${attrs}>${S.roles.map((r) => `<option value="${esc(r.key)}" ${r.key === value ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>`;

function adminAccounts() {
  return `
    <div class="toolbar"><p class="muted small">已有账号的成员。取消「首页显示」只是不在总览里显示成员卡片，TA 的条目仍在「全部条目」里。</p>
      <button class="btn primary" data-action="create-account">${icon.plus}新建账号</button></div>
    <div class="card table-card"><table class="table admin-table">
      <thead><tr><th></th><th>显示名</th><th>用户名</th><th>角色</th><th>首页显示</th><th>排序</th><th class="num">条目</th><th></th></tr></thead>
      <tbody>${S.profiles.map((p) => `<tr data-profile="${p.id}">
        <td>${avatar(p, 'sm')}</td>
        <td><input name="name" value="${esc(p.name)}"></td>
        <td class="muted nowrap">${esc(p.username || '—')}</td>
        <td>${roleSelect('role', p.role)}</td>
        <td><input type="checkbox" name="show_on_board" ${p.show_on_board ? 'checked' : ''}></td>
        <td><input type="number" name="sort_order" value="${p.sort_order}" class="w-num"></td>
        <td class="num">${patentsOf(p.id).length}</td>
        <td class="nowrap">
          <button class="btn sm ghost" data-action="reset-pw" data-id="${p.id}">重置密码</button>
          <button class="icon-btn subtle" data-action="del-member" data-id="${p.id}" title="删除成员">${icon.trash}</button></td>
      </tr>`).join('')}</tbody></table></div>`;
}

function adminRoster() {
  const list = S.roster.slice().sort((a, b) => (a.user_id ? 1 : 0) - (b.user_id ? 1 : 0) || String(a.created_at).localeCompare(String(b.created_at)));
  return `
    <div class="card roster-add">
      <form class="roster-form" data-form="roster-add">
        <input name="name" placeholder="姓名" required>
        <input name="aliases" placeholder="别名（可选，多个用逗号或空格分隔）">
        ${roleSelect('role', 'student')}
        <button class="btn primary" type="submit">${icon.plus}加入名单</button>
        <button class="btn" type="button" data-action="roster-import">批量导入</button>
      </form>
      <p class="muted small">名单里的人可以在登录页自己「注册账号」（输入姓名或任一别名即可匹配）；也可以点「开通账号」由你直接设置用户名和密码。「初始角色」是注册时获得的角色，注册后在「账号」里调整。</p>
    </div>
    <div class="card table-card"><table class="table admin-table">
      <thead><tr><th>姓名</th><th>别名</th><th>初始角色</th><th>状态</th><th></th></tr></thead>
      <tbody>${list.map((r) => {
        const acc = profile(r.user_id);
        return `<tr data-roster="${r.id}">
          <td><input name="name" value="${esc(r.name)}"></td>
          <td><input name="aliases" value="${esc(r.aliases.join('，'))}" placeholder="无"></td>
          <td>${roleSelect('role', r.role)}</td>
          <td class="nowrap">${acc ? `<span class="status ok">已注册</span> <a href="#/member/${acc.id}" class="muted small">${esc(acc.username || acc.name)}</a>` : '<span class="status">未注册</span>'}</td>
          <td class="nowrap">${acc ? '' : `<button class="btn sm" data-action="create-account" data-roster="${r.id}">开通账号</button>
            <button class="icon-btn subtle" data-action="del-roster" data-id="${r.id}" title="移出名单">${icon.trash}</button>`}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="5" class="empty">名单为空</td></tr>'}</tbody></table></div>`;
}

function adminRoles() {
  return `
    <div class="card perm-help">
      <b>权限说明</b>（角色 = 若干权限的组合，可以自由新建，例如「老师（管理员）」= 可审核 + 可管理）
      <ul>${PERMS.map(([, l, d]) => `<li><b>${l}</b>：${d}</li>`).join('')}
        <li><b>所有登录的人</b>都能查看全部条目、记录，下载文件</li></ul>
    </div>
    <div class="toolbar"><span></span><button class="btn primary" data-action="add-role">${icon.plus}新建角色</button></div>
    <div class="card table-card"><table class="table admin-table roles-table">
      <thead><tr><th>角色名称</th><th>说明</th>${PERMS.map(([, l]) => `<th class="c">${l}</th>`).join('')}<th class="c" title="新注册的账号默认在首页显示">默认上首页</th><th class="num">人数</th><th></th></tr></thead>
      <tbody>${S.roles.map((r) => {
        const n = S.profiles.filter((p) => p.role === r.key).length;
        return `<tr data-role="${esc(r.key)}">
          <td><input name="label" value="${esc(r.label)}"></td>
          <td><input name="description" value="${esc(r.description || '')}" placeholder="职责说明"></td>
          ${PERMS.map(([k]) => `<td class="c"><input type="checkbox" name="${k}" ${r[k] ? 'checked' : ''}></td>`).join('')}
          <td class="c"><input type="checkbox" name="on_board" ${r.on_board ? 'checked' : ''}></td>
          <td class="num">${n}</td>
          <td>${n || S.roster.some((x) => x.role === r.key) ? '' : `<button class="icon-btn subtle" data-action="del-role" data-id="${esc(r.key)}" title="删除角色">${icon.trash}</button>`}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
}

function adminSettings() {
  return `<div class="card settings-card">
    <form class="form" data-form="settings">
      <label class="field"><span>注册码</span>
        <input name="register_code" value="${esc(setting('register_code'))}" placeholder="留空 = 不需要注册码" autocomplete="off">
        <em class="hint">网站是公开的，设置注册码后，名单内的人注册时还需输入这个码，防止外人冒名注册。管理员直接开通账号不受影响。</em></label>
      <div><button class="btn primary" type="submit">保存</button></div>
    </form>
    <hr>
    <div class="svc-row"><div><b>账号服务</b><p class="muted small">注册、管理员建号、重置密码依赖 Supabase Edge Function「account」，部署方法见 README。</p></div>
      <button class="btn" data-action="check-service">检测</button></div>
  </div>`;
}

// ======================= 弹窗表单 =======================
function patentForm(p = null, ownerId = null) {
  const owner = p?.owner_id || ownerId || S.me.id;
  const owners = S.profiles.filter((m) => roleOf(m).can_own || m.id === owner);
  const ownerSel = can('edit_all')
    ? `<select name="owner_id">${owners.map((m) => `<option value="${m.id}" ${m.id === owner ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`
    : `<select name="owner_id" disabled><option value="${S.me.id}">${esc(S.me.name)}</option></select>`;
  openModal({
    title: p ? '编辑条目' : '新建条目',
    wide: true,
    body: `<form class="form">
      <label class="field"><span>名称</span><textarea name="title" rows="2" required>${esc(p?.title || '')}</textarea></label>
      <div class="form-row">
        <label class="field"><span>类型</span><select name="kind">${KINDS.map((k) => `<option ${k === (p?.kind || KINDS[0]) ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
        <label class="field"><span>撰写人</span>${ownerSel}</label>
      </div>
      <div class="form-row">
        <label class="field"><span>撰写进度（%）</span><input type="number" name="progress" min="0" max="100" step="5" value="${p?.progress ?? 0}"></label>
        <label class="field"><span>当前阶段</span><select name="stage">${STAGES.map((s) => `<option ${s.name === (p?.stage || STAGES[0].name) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label class="field"><span>截止日期</span><input type="date" name="due_date" value="${p?.due_date || ''}"></label>
      </div>
      <label class="field"><span>说明（可选）</span><textarea name="description" rows="3" placeholder="例如：对应课题、合作单位、注意事项">${esc(p?.description || '')}</textarea></label>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>取消</button><button class="btn primary" type="submit">${p ? '保存' : '创建'}</button></div>
    </form>`,
    onMount(m, close) {
      m.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = {
          title: fd.get('title').trim(),
          kind: fd.get('kind'),
          owner_id: can('edit_all') ? fd.get('owner_id') : (p?.owner_id || S.me.id),
          progress: Math.max(0, Math.min(100, parseInt(fd.get('progress'), 10) || 0)),
          stage: fd.get('stage'),
          due_date: fd.get('due_date') || null,
          description: fd.get('description').trim(),
        };
        if (!data.title) return toast('请填写名称', 'error');
        const btn = e.target.querySelector('[type=submit]');
        busy(btn, true, '保存中…');
        let created;
        const ok = await run(async () => {
          if (p) await api.updatePatent(p.id, data);
          else created = await api.createPatent(data);
        }, p ? '已保存' : '已创建');
        busy(btn, false);
        if (ok) { close(); if (created) location.hash = `#/patent/${created.id}`; }
      });
    },
  });
}

function changePwForm() {
  openModal({
    title: '修改密码',
    body: `<form class="form">
      <p class="muted small" style="margin:0">修改后会退出所有设备上的登录，需要用新密码重新登录。</p>
      <label class="field"><span>新密码</span><input type="password" name="pw" minlength="6" required autocomplete="new-password"></label>
      <label class="field"><span>再输一次</span><input type="password" name="pw2" minlength="6" required autocomplete="new-password"></label>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>取消</button><button class="btn primary" type="submit">确定</button></div></form>`,
    onMount(m, close) {
      m.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        if (fd.get('pw') !== fd.get('pw2')) return toast('两次输入不一致', 'error');
        const btn = e.target.querySelector('[type=submit]');
        busy(btn, true, '修改中…');
        try {
          await api.changePassword(fd.get('pw'));
          close();
          await api.signOut('global');
          S.loaded = false; S.me = null;
          if (location.hash && location.hash !== '#/') location.hash = '#/';
          UI.loginTab = 'login';
          renderLogin();
          toast('密码已修改，请用新密码重新登录', 'ok');
        } catch (err) { busy(btn, false); handleErr(err); }
      });
    },
  });
}

function renameSelfForm() {
  openModal({
    title: '修改显示名',
    body: `<form class="form"><label class="field"><span>显示名</span><input name="name" value="${esc(S.me.name)}" required maxlength="20"></label>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>取消</button><button class="btn primary" type="submit">保存</button></div></form>`,
    onMount(m, close) {
      m.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = new FormData(e.target).get('name').trim();
        if (name && await run(() => api.updateProfile(S.me.id, { name }), '已保存')) close();
      });
    },
  });
}

function createAccountForm(rosterId) {
  const r = S.roster.find((x) => x.id === rosterId);
  openModal({
    title: r ? `开通账号：${r.name}` : '新建账号',
    body: `<form class="form" autocomplete="off">
      <div class="form-row">
        <label class="field"><span>姓名</span><input name="name" value="${esc(r?.name || '')}" required ${r ? 'readonly' : ''}></label>
        <label class="field"><span>角色</span>${roleSelect('role', r?.role || 'student')}</label>
      </div>
      ${r ? '' : `<label class="field"><span>别名（可选）</span><input name="aliases" placeholder="多个用逗号或空格分隔"></label>`}
      <div class="form-row">
        <label class="field"><span>用户名</span><input name="username" required placeholder="如 zhangsan" autocomplete="off"></label>
        <label class="field"><span>初始密码</span><input name="password" required minlength="6" autocomplete="new-password"></label>
      </div>
      <p class="muted small" style="margin:0">${r ? '' : '姓名不在名单中会自动加入名单。'}把用户名和初始密码告诉对方，登录后可自行修改密码。</p>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>取消</button><button class="btn primary" type="submit">创建</button></div>
    </form>`,
    onMount(m, close) {
      m.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const btn = e.target.querySelector('[type=submit]');
        busy(btn, true, '创建中…');
        const ok = await run(() => api.adminCreateAccount({
          name: fd.get('name').trim(), aliases: parseAliases(fd.get('aliases')), role: fd.get('role'),
          username: fd.get('username').trim().toLowerCase(), password: fd.get('password'),
        }), `已创建账号 ${fd.get('username').trim().toLowerCase()}`);
        busy(btn, false);
        if (ok) close();
      });
    },
  });
}

function resetPwForm(p) {
  openModal({
    title: `重置密码：${p.name}`,
    body: `<form class="form" autocomplete="off">
      <label class="field"><span>新密码</span><input name="password" required minlength="6" autocomplete="new-password"></label>
      <p class="muted small" style="margin:0">用户名 <b>${esc(p.username || '')}</b>。把新密码告诉对方，登录后可自行修改。</p>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>取消</button><button class="btn primary" type="submit">重置</button></div></form>`,
    onMount(m, close) {
      m.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('[type=submit]');
        busy(btn, true, '提交中…');
        try {
          await api.adminResetPassword(p.id, new FormData(e.target).get('password'));
          toast('密码已重置', 'ok'); close();
        } catch (err) { busy(btn, false); handleErr(err); }
      });
    },
  });
}

function rosterImportForm() {
  openModal({
    title: '批量导入名单',
    wide: true,
    body: `<form class="form">
      <label class="field"><span>每行一个人：姓名，别名1，别名2 …（别名可省略）</span>
        <textarea name="lines" rows="8" placeholder="张三，三哥，zhangsan&#10;李四&#10;陈老师，陈明"></textarea></label>
      <label class="field"><span>初始角色</span>${roleSelect('role', 'student')}</label>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>取消</button><button class="btn primary" type="submit">导入</button></div></form>`,
    onMount(m, close) {
      m.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const rows = String(fd.get('lines')).split('\n').map(parseAliases).filter((x) => x.length);
        const existing = new Set(S.roster.map((r) => r.name.toLowerCase()));
        let added = 0, skipped = 0;
        const ok = await run(async () => {
          for (const [name, ...aliases] of rows) {
            if (existing.has(name.toLowerCase())) { skipped++; continue; }
            await api.addRoster({ name, aliases, role: fd.get('role') });
            existing.add(name.toLowerCase()); added++;
          }
        });
        if (ok) { toast(`已导入 ${added} 人${skipped ? `，跳过重名 ${skipped} 人` : ''}`, 'ok'); close(); }
      });
    },
  });
}

function addRoleForm() {
  openModal({
    title: '新建角色',
    body: `<form class="form">
      <label class="field"><span>角色名称</span><input name="label" required placeholder="例如：老师（管理员）"></label>
      <label class="field"><span>说明</span><input name="description" placeholder="职责说明（可选）"></label>
      <div class="perm-checks">${PERMS.map(([k, l, d]) => `<label class="check"><input type="checkbox" name="${k}"><span><b>${l}</b><em>${d}</em></span></label>`).join('')}
        <label class="check"><input type="checkbox" name="on_board"><span><b>默认上首页</b><em>新账号默认在总览显示成员卡片</em></span></label></div>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>取消</button><button class="btn primary" type="submit">创建</button></div></form>`,
    onMount(m, close) {
      m.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const row = { key: 'r_' + Date.now().toString(36), label: f.label.value.trim(), description: f.description.value.trim(),
          on_board: f.on_board.checked, sort_order: S.roles.length + 1 };
        PERMS.forEach(([k]) => { row[k] = f[k].checked; });
        if (!row.label) return;
        if (await run(() => api.addRole(row), '已创建角色')) close();
      });
    },
  });
}

function deleteMemberForm(m) {
  const self = m.id === S.me.id;
  const list = patentsOf(m.id);
  const nFiles = list.reduce((n, p) => n + filesOf(p.id).length, 0);
  const others = S.profiles.filter((x) => x.id !== m.id && (roleOf(x).can_own || roleOf(x).can_edit_all));
  if (roleOf(m).can_manage && !S.profiles.some((x) => x.id !== m.id && roleOf(x).can_manage)) {
    toast('这是唯一的管理员，请先把其他人设为管理员', 'error');
    return;
  }
  const patentPart = list.length ? `
      <p class="muted">${esc(m.name)} 名下有 <b>${list.length}</b> 篇条目（${nFiles} 个文件），请选择如何处理：</p>
      <label class="radio"><input type="radio" name="mode" value="transfer" ${others.length ? 'checked' : 'disabled'}>
        转交给 <select name="to" ${others.length ? '' : 'disabled'}>${others.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
      <label class="radio"><input type="radio" name="mode" value="delete" ${others.length ? '' : 'checked'}>
        <span>连同条目、进展记录和文件一起删除（无法恢复）</span></label>` : '';
  openModal({
    title: self ? '注销我的账号' : `删除成员：${m.name}`,
    body: `<form class="form">
      <p class="confirm-text">${self ? '注销后你的登录账号会被删除，无法再登录本站。' : `将删除 ${esc(m.name)} 的登录账号，TA 将无法再登录。`}
        TA 在别人条目里留下的记录和文件会保留；名单中的记录会恢复为「未注册」。</p>
      ${patentPart}
      <label class="field"><span>请输入「${esc(m.name)}」确认</span><input name="confirm" autocomplete="off"></label>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>取消</button>
        <button class="btn danger" type="submit">${self ? '注销' : '删除'}</button></div></form>`,
    onMount(md, close) {
      md.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        if (fd.get('confirm').trim() !== m.name) return toast('输入的名字不一致', 'error');
        const mode = list.length ? fd.get('mode') : 'none';
        const to = mode === 'transfer' ? fd.get('to') : null;
        const btn = e.target.querySelector('[type=submit]');
        busy(btn, true, '处理中…');
        try {
          if (mode === 'delete') for (const p of list) await api.deletePatent(p.id, filesOf(p.id));
          await api.deleteMember(m.id, to);
          close();
          if (self) {
            await api.signOut();
            S.loaded = false; S.me = null; location.hash = '#/';
            renderLogin(); toast('账号已注销', 'ok');
            return;
          }
          if (location.hash.includes(m.id)) location.hash = '#/';
          await reload(); render();
          toast(`已删除成员 ${m.name}`, 'ok');
        } catch (err) {
          busy(btn, false); handleErr(err);
          try { await reload(); render(); } catch { /* ignore */ }
        }
      });
    },
  });
}

// ======================= 文件上传 =======================
async function uploadFiles(pid, fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const max = cfg.MAX_FILE_MB * 1024 * 1024;
  const big = files.filter((f) => f.size > max);
  if (big.length) toast(`${big.map((f) => f.name).join('、')} 超过 ${cfg.MAX_FILE_MB} MB，已跳过`, 'error');
  const ok = files.filter((f) => f.size <= max);
  if (!ok.length) return;
  const note = root.querySelector('[data-file-note]')?.value.trim() || '';
  const zone = root.querySelector('.dropzone');
  zone?.classList.add('uploading');
  const label = zone?.querySelector('span');
  let n = 0;
  const before = new Set(filesOf(pid).map((f) => f.id));
  await run(async () => {
    for (const f of ok) {
      if (label) label.textContent = `上传中 ${++n}/${ok.length}：${f.name}`;
      await api.uploadFile(pid, f, note);
    }
    const d = await api.loadAll();
    const fresh = d.files.find((f) => f.patent_id === pid && !before.has(f.id) && previewKind(f.name));
    if (fresh) UI.preview[pid] = fresh.id;
  }, `已上传 ${ok.length} 个文件`);
}

// ======================= 管理页自动保存 =======================
async function saveProfileField(t) {
  const id = t.closest('tr[data-profile]').dataset.profile;
  const old = profile(id);
  let patch;
  if (t.name === 'name') {
    const name = t.value.trim();
    if (!name) { t.value = old.name; return toast('显示名不能为空', 'error'); }
    if (name === old.name) return;
    patch = { name };
  } else if (t.name === 'role') {
    const next = S.roles.find((r) => r.key === t.value);
    if (roleOf(old).can_manage && !next?.can_manage && !S.profiles.some((x) => x.id !== id && roleOf(x).can_manage)) {
      t.value = old.role; return toast('这是最后一位管理员，不能取消管理权限', 'error');
    }
    if (id === S.me.id && roleOf(old).can_manage && !next?.can_manage
      && !await confirmDialog('确定取消自己的管理权限？取消后将无法再进入管理页面。', '确定')) {
      t.value = old.role; return;
    }
    patch = { role: t.value };
  } else if (t.name === 'show_on_board') patch = { show_on_board: t.checked };
  else if (t.name === 'sort_order') patch = { sort_order: parseInt(t.value, 10) || 0 };
  else return;
  await run(() => api.updateProfile(id, patch), `已保存：${patch.name || old.name}`, true);
}

async function saveRosterField(t) {
  const id = t.closest('tr[data-roster]').dataset.roster;
  const old = S.roster.find((r) => r.id === id);
  let patch;
  if (t.name === 'name') {
    const name = t.value.trim();
    if (!name) { t.value = old.name; return toast('姓名不能为空', 'error'); }
    if (name === old.name) return;
    patch = { name };
  } else if (t.name === 'aliases') patch = { aliases: parseAliases(t.value) };
  else if (t.name === 'role') patch = { role: t.value };
  else return;
  await run(() => api.updateRoster(id, patch), `名单已保存：${patch.name || old.name}`, true);
}

async function saveRoleField(t) {
  const key = t.closest('tr[data-role]').dataset.role;
  const old = S.roles.find((r) => r.key === key);
  let patch;
  if (t.name === 'label') {
    const label = t.value.trim();
    if (!label) { t.value = old.label; return toast('名称不能为空', 'error'); }
    patch = { label };
  } else if (t.name === 'description') patch = { description: t.value.trim() };
  else if (t.type === 'checkbox') {
    if (t.name === 'can_manage' && !t.checked
      && !S.profiles.some((p) => p.role !== key && roleOf(p).can_manage)) {
      t.checked = true; return toast('至少需要保留一位拥有「管理」权限的成员', 'error');
    }
    patch = { [t.name]: t.checked };
  } else return;
  await run(() => api.updateRole(key, patch), `角色已保存：${patch.label || old.label}`, true);
}

// ======================= 事件绑定 =======================
const actions = {
  menu(el) { const m = el.nextElementSibling; m.hidden = !m.hidden; },
  bell(el) { const m = el.nextElementSibling; m.hidden = !m.hidden; },
  async dismiss(el) { await run(() => api.markSeen([el.dataset.id]), '已忽略'); },
  async 'dismiss-all'() {
    const ids = myNotices().map((n) => n.p.id);
    if (ids.length) await run(() => api.markSeen(ids), `已忽略 ${ids.length} 篇的新动态`);
  },
  async logout() { await api.signOut(); S.loaded = false; S.me = null; UI.booted = false; location.hash = '#/'; renderLogin(); },
  'login-tab'(el) {
    UI.loginTab = el.dataset.tab;
    renderLogin();
    if (UI.loginTab === 'register') loadRegInfo();
  },
  'change-pw': changePwForm,
  'rename-self': renameSelfForm,
  async 'reset-demo'() {
    if (await confirmDialog('将清空本浏览器中的演示数据并恢复示例数据，确定？', '重置')) { api.resetDemo(); location.hash = '#/'; location.reload(); }
  },
  'toggle-card'(el) {
    const id = el.dataset.id;
    if (UI.expanded.has(id)) UI.expanded.delete(id); else UI.expanded.add(id);
    el.closest('.member-card').classList.toggle('expanded', UI.expanded.has(id));
  },
  'more-comments'() { UI.moreComments = !UI.moreComments; render(); },
  'new-patent'(el) { patentForm(null, el.dataset.owner); },
  'edit-patent'(el) { patentForm(patent(el.dataset.id)); },
  async 'del-patent'(el) {
    const p = patent(el.dataset.id);
    if (!await confirmDialog(`删除「${p.title}」？其进展记录和 ${filesOf(p.id).length} 个文件也会一并删除，无法恢复。`)) return;
    location.hash = `#/member/${p.owner_id}`;
    await run(() => api.deletePatent(p.id, filesOf(p.id)), '已删除');
  },
  async 'del-event'(el) {
    if (await confirmDialog('删除这条记录？')) await run(() => api.deleteEvent(el.dataset.id), '已删除');
  },
  async 'del-file'(el) {
    const f = S.files.find((x) => x.id === el.dataset.id);
    if (await confirmDialog(`删除文件「${f.name}」？`)) await run(() => api.deleteFile(f), '已删除');
  },
  async 'dl-file'(el) {
    const f = S.files.find((x) => x.id === el.dataset.id);
    try {
      const url = await api.fileUrl(f);
      const a = document.createElement('a');
      a.href = url; a.download = f.name; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { handleErr(e); }
  },
  'pv-file'(el) {
    const f = S.files.find((x) => x.id === el.dataset.id);
    UI.preview[f.patent_id] = f.id;
    render();
  },
  'pv-load'(el) {
    UI.pvForce.add(el.dataset.id);
    const box = el.closest('[data-pv]');
    fillPreview(box, S.files.find((x) => x.id === el.dataset.id), true);
  },
  'pv-full'(el) {
    const f = S.files.find((x) => x.id === el.dataset.id);
    openModal({
      title: f.name, wide: true, cls: 'xl',
      body: `<div class="pv-box full" data-pv="${f.id}"><div class="pv-body"></div></div>`,
      onMount(m) { fillPreview(m.querySelector('[data-pv]'), f, true); },
    });
  },
  'del-member'(el) { deleteMemberForm(profile(el.dataset.id)); },
  'create-account'(el) { createAccountForm(el.dataset.roster); },
  'reset-pw'(el) { resetPwForm(profile(el.dataset.id)); },
  'roster-import': rosterImportForm,
  async 'del-roster'(el) {
    const r = S.roster.find((x) => x.id === el.dataset.id);
    if (await confirmDialog(`把「${r.name}」移出名单？TA 将不能再自助注册。`, '移出')) await run(() => api.deleteRoster(r.id), '已移出名单');
  },
  'add-role': addRoleForm,
  async 'del-role'(el) {
    const r = S.roles.find((x) => x.key === el.dataset.id);
    if (await confirmDialog(`删除角色「${r.label}」？`)) await run(() => api.deleteRole(r.key), '已删除角色');
  },
  async 'check-service'(el) {
    busy(el, true, '检测中…');
    try {
      const d = await api.registrationInfo();
      toast(`账号服务正常${d.code_required ? '（已启用注册码）' : ''}`, 'ok');
    } catch (e) { handleErr(e); }
    busy(el, false);
  },
};

root.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (a) { e.preventDefault(); actions[a.dataset.action]?.(a, e); return; }
  const tr = e.target.closest('tr[data-href]');
  if (tr) location.hash = tr.dataset.href;
});
document.addEventListener('click', (e) => {
  // 弹窗里的按钮（全屏预览中的「加载预览」等）
  const a = e.target.closest('.overlay [data-action]');
  if (a) { e.preventDefault(); actions[a.dataset.action]?.(a, e); }
  if (!e.target.closest('.user-menu')) root.querySelectorAll('.user-menu .menu').forEach((m) => { m.hidden = true; });
  if (!e.target.closest('.bell-wrap') || e.target.closest('.nt-main')) root.querySelectorAll('.bell-menu').forEach((m) => { m.hidden = true; });
});

root.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.change === 'progress') {
    t.style.setProperty('--v', t.value + '%');
    root.querySelector('[data-progress-label]').textContent = t.value + '%';
  }
  if (t.dataset.filter) {
    F[t.dataset.filter] = t.value;
    root.querySelector('[data-table]').innerHTML = tableRows();
  }
});

root.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.closest('tr[data-profile]')) return saveProfileField(t);
  if (t.closest('tr[data-roster]')) return saveRosterField(t);
  if (t.closest('tr[data-role]')) return saveRoleField(t);
  const c = t.dataset.change;
  if (c === 'progress') await run(() => api.updatePatent(t.dataset.id, { progress: +t.value }), '进度已更新', true);
  else if (c === 'stage') await run(() => api.updatePatent(t.dataset.id, { stage: t.value }), '阶段已更新', true);
  else if (c === 'upload') { await uploadFiles(t.dataset.id, t.files); t.value = ''; }
  else if (c === 'event-kind') {
    const s = t.form.querySelector('[name=stage_sync]');
    if (s) s.value = EVENT_KINDS[t.value]?.stage || '';
  }
});

// 注册时实时校验姓名
root.addEventListener('focusout', async (e) => {
  const t = e.target;
  if (!t.matches('[data-check-name]') || !t.value.trim()) return;
  const hint = root.querySelector('[data-name-hint]');
  try {
    const d = await api.checkName(t.value.trim());
    const text = { ok: `✓ 名单匹配：${d.name}`, taken: `「${d.name}」已经注册过账号，忘记密码请联系管理员`,
      not_found: '名单中没有这个姓名，请联系管理员添加', ambiguous: '匹配到多条名单记录，请联系管理员' }[d.status];
    hint.textContent = text;
    hint.className = 'hint ' + (d.status === 'ok' ? 'good' : 'bad');
  } catch (err) {
    hint.textContent = err.message; hint.className = 'hint bad';
  }
});

root.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('tr[data-profile] input, tr[data-roster] input, tr[data-role] input')) e.target.blur();
});

root.addEventListener('submit', async (e) => {
  const f = e.target;
  const kind = f.dataset.form;
  if (!kind) return;
  e.preventDefault();
  const fd = new FormData(f);
  const btn = f.querySelector('[type=submit]');

  if (kind === 'login') {
    busy(btn, true, '登录中…');
    try {
      await api.signIn(fd.get('login'), fd.get('password'));
      S.loaded = false;
      await reload();
      location.hash = isWriterOnly() ? `#/member/${S.me.id}` : '#/';
      UI.booted = true;
      await render();
    } catch (err) { handleErr(err); busy(btn, false); }
  }

  if (kind === 'register') {
    if (fd.get('password') !== fd.get('password2')) return toast('两次输入的密码不一致', 'error');
    busy(btn, true, '注册中…');
    try {
      await api.register({ name: fd.get('name').trim(), username: fd.get('username').trim().toLowerCase(),
        password: fd.get('password'), code: fd.get('code') || '' });
      UI.loginTab = 'login';
      S.loaded = false;
      await reload();
      location.hash = isWriterOnly() ? `#/member/${S.me.id}` : '#/';
      UI.booted = true;
      await render();
      toast('注册成功，欢迎！', 'ok');
    } catch (err) { handleErr(err); busy(btn, false); }
  }

  if (kind === 'add-event') {
    const pid = f.dataset.id;
    const content = fd.get('content').trim();
    const ek = fd.get('kind');
    if (!content && ek !== 'submit') return toast('请填写内容', 'error');
    const stage = fd.get('stage_sync');
    busy(btn, true, '提交中…');
    await run(async () => {
      await api.addEvent({ patent_id: pid, kind: ek, content, happened_on: fd.get('happened_on') || today() });
      if (stage && patent(pid).stage !== stage) await api.updatePatent(pid, { stage });
    }, canEdit(patent(pid)) ? '已添加记录' : '意见已提交，已同步到撰写人的进展记录');
  }

  if (kind === 'roster-add') {
    const name = fd.get('name').trim();
    if (!name) return;
    if (S.roster.some((r) => r.name.toLowerCase() === name.toLowerCase())) return toast('名单里已有同名记录', 'error');
    await run(() => api.addRoster({ name, aliases: parseAliases(fd.get('aliases')), role: fd.get('role') }), `已把 ${name} 加入名单`);
  }

  if (kind === 'settings') {
    await run(() => api.setSetting('register_code', fd.get('register_code').trim()), '设置已保存');
  }
});

// 记住「全部动态」展开状态（toggle 事件不冒泡，用捕获）
root.addEventListener('toggle', (e) => {
  if (e.target.matches?.('[data-feed]')) localStorage.setItem('pt_feed_open', e.target.open ? '1' : '0');
}, true);

// 拖拽上传
root.addEventListener('dragover', (e) => {
  const z = e.target.closest('[data-drop]');
  if (z) { e.preventDefault(); z.classList.add('over'); }
});
root.addEventListener('dragleave', (e) => { e.target.closest('[data-drop]')?.classList.remove('over'); });
root.addEventListener('drop', (e) => {
  const z = e.target.closest('[data-drop]');
  if (!z) return;
  e.preventDefault();
  z.classList.remove('over');
  uploadFiles(z.dataset.drop, e.dataTransfer.files);
});

render();
