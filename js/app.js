import { api } from './api.js';
import {
  esc, fmtDate, fmtShort, today, relTime, fmtSize, avatar, icon,
  toast, openModal, confirmDialog, busy,
} from './ui.js';

const cfg = window.APP_CONFIG;
const STAGES = cfg.STAGES;
const KINDS = cfg.KINDS;
const EVENT_KINDS = {
  submit:   { label: '提交专利中心', cls: 'ev-submit',   stage: '交专利中心审核' },
  feedback: { label: '专利中心反馈', cls: 'ev-feedback', stage: '返回修改' },
  advisor:  { label: '导师批注',     cls: 'ev-advisor',  stage: '' },
  revise:   { label: '修改 / 新版本', cls: 'ev-revise',  stage: '' },
  note:     { label: '备注',         cls: 'ev-note',     stage: '' },
};

const S = { me: null, profiles: [], patents: [], events: [], files: [], loaded: false };
const root = document.getElementById('app');
document.title = cfg.APP_NAME;

// ======================= 数据辅助 =======================
const profile = (id) => S.profiles.find((p) => p.id === id);
const patent = (id) => S.patents.find((p) => p.id === id);
const eventsOf = (pid) => S.events.filter((e) => e.patent_id === pid);
const filesOf = (pid) => S.files.filter((f) => f.patent_id === pid);
const lastEvent = (pid, kind) => eventsOf(pid).find((e) => e.kind === kind); // events 已按时间倒序
const firstEvent = (pid, kind) => { const l = eventsOf(pid).filter((e) => e.kind === kind); return l[l.length - 1]; };
const patentsOf = (uid) => S.patents.filter((p) => p.owner_id === uid);
const isAdmin = () => S.me?.role === 'admin';
const canEdit = (p) => isAdmin() || p.owner_id === S.me?.id;
const canDel = (authorId) => isAdmin() || authorId === S.me?.id;
const canDelMember = (m) => isAdmin() || m.id === S.me?.id;
const boardMembers = () => S.profiles.filter((p) => p.show_on_board);
const stageOf = (name) => STAGES.find((s) => s.name === name) || { name, color: '#5f6670', bg: '#eff0f2' };
const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

const pill = (stage) => {
  const s = stageOf(stage);
  return `<span class="pill" style="--pc:${s.color};--pb:${s.bg}">${esc(s.name)}</span>`;
};
const bar = (v, cls = '') => `<span class="bar ${cls} ${v >= 100 ? 'done' : ''}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></span>`;

async function reload() {
  const d = await api.loadAll();
  Object.assign(S, d);
  S.me = S.profiles.find((p) => p.id === api.getSession()?.userId) || null;
  S.loaded = true;
}

async function run(fn, okMsg) {
  try {
    await fn();
    await reload();
    render();
    if (okMsg) toast(okMsg, 'ok');
    return true;
  } catch (e) {
    handleErr(e);
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
      <p class="muted">登录成功，但数据库 profiles 表里没有你的记录。请管理员重新执行 supabase/schema.sql（会自动补建）。</p>
      <button class="btn" data-action="logout">退出登录</button></div></div>`;
    return;
  }
  const r = parseRoute();
  let view;
  if (r.name === 'member' && profile(r.id)) view = viewMember(profile(r.id));
  else if (r.name === 'patent' && patent(r.id)) view = viewPatent(patent(r.id));
  else if (r.name === 'all') view = viewAll();
  else if (r.name === 'team' && isAdmin()) view = viewTeam();
  else view = viewHome();

  const nav = (name, label, href) =>
    `<a href="${href}" class="${r.name === name || (name === 'home' && ['member', 'patent'].includes(r.name)) ? 'active' : ''}">${label}</a>`;

  root.innerHTML = `
    <header class="topbar"><div class="wrap topbar-in">
      <a class="brand" href="#/"><span class="brand-mark"></span><span class="brand-text">${esc(cfg.APP_NAME)}</span></a>
      <nav class="nav">
        ${nav('home', '总览', '#/')}
        ${nav('all', '全部条目', '#/all')}
        ${isAdmin() ? nav('team', '成员', '#/team') : ''}
      </nav>
      <div class="spacer"></div>
      ${api.mode === 'demo' ? '<span class="demo-badge" title="未配置 Supabase，数据只保存在当前浏览器">演示模式</span>' : ''}
      <div class="user-menu">
        <button class="user-btn" data-action="menu">${avatar(S.me, 'sm')}<span>${esc(S.me.name)}</span>${icon.down}</button>
        <div class="menu" hidden>
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

// ======================= 登录 =======================
function renderLogin() {
  const demo = api.mode === 'demo';
  root.innerHTML = `
    <div class="login-screen">
      <form class="login-card" data-form="login" autocomplete="on">
        <div class="brand lg"><span class="brand-mark"></span>${esc(cfg.APP_NAME)}</div>
        <p class="muted small">仅限团队成员使用</p>
        <label class="field"><span>用户名</span><input name="login" autocomplete="username" required placeholder="例如 zhangsan"></label>
        <label class="field"><span>密码</span><input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn primary block" type="submit">登录</button>
        ${demo ? `<div class="demo-hint">演示模式 · 账号 <code>zhangsan</code>（管理员）/ <code>lisi</code> / <code>wangwu</code>，密码 <code>123456</code></div>` : ''}
      </form>
    </div>`;
}

// ======================= 总览 =======================
function viewHome() {
  const ps = S.patents;
  const submitted = ps.filter((p) => lastEvent(p.id, 'submit')).length;
  const writing = ps.filter((p) => p.progress < 100).length;
  const toFix = ps.filter((p) => p.stage === '返回修改').length;

  const stats = [
    ['条目总数', ps.length, ''],
    ['平均撰写进度', avg(ps.map((p) => p.progress)) + '<small>%</small>', ''],
    ['撰写中', writing, ''],
    ['已交专利中心', submitted, ''],
    ['待修改', toFix, toFix ? 'warn' : ''],
  ].map(([k, v, c]) => `<div class="stat ${c}"><div class="stat-v">${v}</div><div class="stat-k">${k}</div></div>`).join('');

  const members = boardMembers().map(memberCard).join('') ||
    `<div class="empty">还没有成员。${isAdmin() ? '在 Supabase 中添加账号后会自动出现在这里。' : ''}</div>`;

  const recentEvents = S.events.filter((e) => patent(e.patent_id)).slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 8);
  const feedLine = (e) => {
    const p = patent(e.patent_id);
    const k = EVENT_KINDS[e.kind] || EVENT_KINDS.note;
    return `<a class="feed-row" href="#/patent/${p.id}" title="${esc(e.content)}">
      <span class="ev-dot ${k.cls}"></span>
      <span class="fr-kind">${esc(k.label)}</span>
      <span class="fr-who">${esc(profile(p.owner_id)?.name || '')}</span>
      <span class="fr-title">${esc(p.title)}</span>
      <span class="fr-content">${esc(e.content)}</span>
      <span class="fr-date">${fmtShort(e.happened_on)}</span></a>`;
  };
  const latest = recentEvents[0];
  const feedOpen = localStorage.getItem('pt_feed_open') === '1';
  const feed = `<details class="card feed-box" data-feed ${feedOpen ? 'open' : ''}>
    <summary>
      <span class="fb-title">最近动态</span>
      <span class="count">${recentEvents.length}</span>
      <span class="fb-latest">${latest ? `<span class="ev-dot ${(EVENT_KINDS[latest.kind] || EVENT_KINDS.note).cls}"></span>${esc(profile(patent(latest.patent_id).owner_id)?.name || '')} · ${esc((EVENT_KINDS[latest.kind] || EVENT_KINDS.note).label)} · ${esc(patent(latest.patent_id).title)}` : '暂无动态'}</span>
      <span class="fb-toggle">${icon.down}</span>
    </summary>
    <div class="feed-list">${recentEvents.map(feedLine).join('') || '<div class="empty small">暂无动态</div>'}</div>
  </details>`;

  return `
    <div class="page-head">
      <div><h1>团队进度</h1><p class="muted">${today()} · ${boardMembers().length} 位成员</p></div>
      <button class="btn primary" data-action="new-patent">${icon.plus}新建条目</button>
    </div>
    <div class="stats">${stats}</div>
    ${feed}
    <h2 class="sec-title">成员</h2>
    <div class="member-grid">${members}</div>`;
}

function stageBar(list) {
  if (!list.length) return '<div class="stagebar empty-bar"></div>';
  const segs = STAGES.map((s) => [s, list.filter((p) => p.stage === s.name).length]).filter(([, n]) => n);
  const other = list.filter((p) => !STAGES.some((s) => s.name === p.stage)).length;
  if (other) segs.push([{ name: '其他', color: '#9aa0a6' }, other]);
  return `<div class="stagebar">${segs.map(([s, n]) =>
    `<i style="flex:${n};background:${s.color}" title="${esc(s.name)} ${n}"></i>`).join('')}</div>
    <div class="stage-legend">${segs.map(([s, n]) => `<span><i style="background:${s.color}"></i>${esc(s.name)} ${n}</span>`).join('')}</div>`;
}

function memberCard(m) {
  const list = patentsOf(m.id);
  const done = list.filter((p) => p.progress >= 100).length;
  const top = list.slice().sort((a, b) => b.progress - a.progress || String(b.updated_at).localeCompare(String(a.updated_at)));
  return `<a class="card member-card" href="#/member/${m.id}">
    <div class="mc-head">
      ${avatar(m, 'lg')}
      <div class="mc-who"><div class="mc-name">${esc(m.name)}</div><div class="muted small">${list.length} 篇 · 完成撰写 ${done}</div></div>
      <div class="mc-pct">${avg(list.map((p) => p.progress))}<small>%</small></div>
      ${canDelMember(m) ? `<button class="icon-btn subtle mc-del" data-action="del-member" data-id="${m.id}" title="删除成员">${icon.trash}</button>` : ''}
    </div>
    ${stageBar(list)}
    <ul class="mc-list">
      ${top.slice(0, 4).map((p) => `<li><span class="mc-t">${esc(p.title)}</span>${bar(p.progress, 'thin')}<span class="mc-p">${p.progress}%</span></li>`).join('')}
      ${list.length > 4 ? `<li class="more">还有 ${list.length - 4} 篇…</li>` : ''}
      ${!list.length ? '<li class="more">暂无条目</li>' : ''}
    </ul>
  </a>`;
}

// ======================= 个人页 =======================
function viewMember(m) {
  const list = patentsOf(m.id).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const canNew = isAdmin() || m.id === S.me.id;
  const rows = list.map(itemRow).join('') ||
    `<div class="empty">还没有条目${canNew ? '，点击右上角「新建条目」添加' : ''}</div>`;
  return `
    <div class="crumbs"><a href="#/">总览</a>${icon.chevron}<span>${esc(m.name)}</span></div>
    <div class="page-head">
      <div class="person-head">${avatar(m, 'xl')}<div>
        <h1>${esc(m.name)}</h1>
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
  const fb = lastEvent(p.id, 'feedback');
  const nf = filesOf(p.id).length;
  return `<a class="card item-row" href="#/patent/${p.id}">
    <div class="ir-main">
      <div class="ir-title">${esc(p.title)}</div>
      <div class="ir-meta"><span class="tag">${esc(p.kind)}</span><span class="muted">更新于 ${relTime(p.updated_at)}</span>
        ${p.due_date ? `<span class="muted">· 截止 ${fmtDate(p.due_date)}</span>` : ''}</div>
      ${fb ? `<div class="ir-fb"><span class="ev-dot ev-feedback"></span><b>${fmtShort(fb.happened_on)} 反馈：</b>${esc(fb.content)}</div>` : ''}
    </div>
    <div class="ir-prog">${bar(p.progress)}<span>${p.progress}%</span></div>
    <div class="ir-stage">${pill(p.stage)}</div>
    <div class="ir-dates">
      <div><span class="muted">提交</span> ${sub ? fmtDate(sub.happened_on) : '—'}</div>
      <div><span class="muted">反馈</span> ${fb ? fmtDate(fb.happened_on) : '—'}</div>
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
  const fb = lastEvent(p.id, 'feedback');

  const timeline = evs.map((e) => {
    const k = EVENT_KINDS[e.kind] || EVENT_KINDS.note;
    return `<li class="tl-item">
      <span class="ev-dot ${k.cls}"></span>
      <div class="tl-body">
        <div class="tl-top"><b>${k.label}</b><span class="muted">${fmtDate(e.happened_on)} · ${esc(profile(e.author_id)?.name || '')}</span>
          ${canDel(e.author_id) ? `<button class="icon-btn subtle" data-action="del-event" data-id="${e.id}" title="删除">${icon.trash}</button>` : ''}</div>
        ${e.content ? `<div class="tl-content">${esc(e.content)}</div>` : ''}
      </div></li>`;
  }).join('');

  const files = fs.map((f) => `<li class="file-item">
      <span class="file-ic">${icon.file}</span>
      <div class="file-main">
        <div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div>
        <div class="muted small">${fmtSize(f.size)} · ${esc(profile(f.uploaded_by)?.name || '')} · ${relTime(f.created_at)}${f.note ? ` · ${esc(f.note)}` : ''}</div>
      </div>
      <button class="icon-btn" data-action="dl-file" data-id="${f.id}" title="下载">${icon.download}</button>
      ${canDel(f.uploaded_by) ? `<button class="icon-btn subtle" data-action="del-file" data-id="${f.id}" title="删除">${icon.trash}</button>` : ''}
    </li>`).join('');

  const kindOpts = Object.entries(EVENT_KINDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  const stageOpts = (sel) => STAGES.map((s) => `<option ${s.name === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

  return `
    <div class="crumbs"><a href="#/">总览</a>${icon.chevron}<a href="#/member/${owner?.id}">${esc(owner?.name || '')}</a>${icon.chevron}<span class="clip">${esc(p.title)}</span></div>
    <div class="page-head detail-head">
      <div>
        <div class="tags"><span class="tag">${esc(p.kind)}</span>${pill(p.stage)}</div>
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
      <div class="ov-cell"><div class="ov-k">最近反馈</div><div class="ov-v">${fb ? fmtDate(fb.happened_on) : '—'}</div></div>
      <div class="ov-cell"><div class="ov-k">截止日期</div><div class="ov-v">${p.due_date ? fmtDate(p.due_date) : '—'}</div></div>
    </div>
    ${p.description ? `<div class="card desc"><div class="ov-k">说明</div><div class="desc-text">${esc(p.description)}</div></div>` : ''}

    <div class="detail-grid">
      <section class="card">
        <h2 class="sec-title in-card">进展记录 <span class="count">${evs.length}</span></h2>
        <form class="event-form" data-form="add-event" data-id="${p.id}">
          <div class="ef-row">
            <select name="kind" data-change="event-kind">${kindOpts}</select>
            <input type="date" name="happened_on" value="${today()}" required>
          </div>
          <textarea name="content" rows="2" placeholder="内容：提交了哪些材料 / 专利中心的反馈意见 / 导师批注…"></textarea>
          <div class="ef-row">
            ${editable ? `<label class="inline muted small">同时把阶段改为
              <select name="stage_sync"><option value="">不变</option>${STAGES.map((s) => `<option ${s.name === EVENT_KINDS.submit.stage ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : '<span></span>'}
            <button class="btn primary sm" type="submit">${icon.send}添加记录</button>
          </div>
        </form>
        <ul class="timeline">${timeline || '<li class="empty small">还没有记录</li>'}</ul>
      </section>

      <section class="card">
        <h2 class="sec-title in-card">文件 <span class="count">${fs.length}</span></h2>
        <label class="dropzone" data-drop="${p.id}">
          <input type="file" multiple data-change="upload" data-id="${p.id}" hidden>
          ${icon.upload}<span>点击或拖拽文件到这里上传</span><span class="muted small">单个文件 ≤ ${cfg.MAX_FILE_MB} MB</span>
        </label>
        <input class="file-note" placeholder="文件备注（可选，例如：说明书 v3 / 按反馈修改版）" data-file-note>
        <ul class="file-list">${files || '<li class="empty small">还没有文件</li>'}</ul>
      </section>
    </div>`;
}

// ======================= 全部条目 =======================
const F = { q: '', owner: '', stage: '', kind: '' };

function viewAll() {
  const sel = (key, opts, label) =>
    `<select data-filter="${key}"><option value="">${label}</option>${opts.map(([v, t]) => `<option value="${esc(v)}" ${F[key] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  return `
    <div class="page-head"><div><h1>全部条目</h1><p class="muted">共 ${S.patents.length} 条</p></div>
      <button class="btn primary" data-action="new-patent">${icon.plus}新建条目</button></div>
    <div class="filters">
      <label class="search">${icon.search}<input data-filter="q" placeholder="搜索名称" value="${esc(F.q)}"></label>
      ${sel('owner', S.profiles.map((p) => [p.id, p.name]), '全部撰写人')}
      ${sel('stage', STAGES.map((s) => [s.name, s.name]), '全部阶段')}
      ${sel('kind', KINDS.map((k) => [k, k]), '全部类型')}
    </div>
    <div class="card table-card"><table class="table">
      <thead><tr><th class="num">#</th><th>名称</th><th>撰写人</th><th>进度</th><th>阶段</th><th>提交时间</th><th>最近反馈</th><th class="num">文件</th></tr></thead>
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
    const fb = lastEvent(p.id, 'feedback');
    return `<tr data-href="#/patent/${p.id}">
      <td class="num muted">${i + 1}</td>
      <td class="t-title"><span class="tag sm">${esc(p.kind)}</span>${esc(p.title)}</td>
      <td class="nowrap">${esc(profile(p.owner_id)?.name || '')}</td>
      <td class="t-prog">${bar(p.progress, 'thin')}<span>${p.progress}%</span></td>
      <td>${pill(p.stage)}</td>
      <td class="nowrap">${sub ? fmtDate(sub.happened_on) : '<span class="muted">—</span>'}</td>
      <td class="t-fb">${fb ? `<span class="nowrap">${fmtDate(fb.happened_on)}</span><span class="muted fb-txt">${esc(fb.content)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="num">${filesOf(p.id).length || '<span class="muted">0</span>'}</td>
    </tr>`;
  }).join('');
}

// ======================= 成员管理（管理员） =======================
function viewTeam() {
  return `
    <div class="page-head"><div><h1>成员管理</h1>
      <p class="muted">修改后自动保存。取消「首页显示」只是不在总览里显示成员卡片，TA 的条目仍会出现在「全部条目」里。</p>
      <p class="muted">${api.mode === 'demo'
        ? '演示模式下成员是固定的三个示例账号。'
        : '新成员请在 Supabase 控制台 → Authentication → Users → Add user 创建（邮箱填 用户名@' + esc(cfg.EMAIL_DOMAIN) + '，勾选 Auto Confirm），创建后会自动出现在这里。'}</p></div></div>
    <div class="card table-card"><table class="table team-table">
      <thead><tr><th>成员</th><th>显示名</th><th>角色</th><th>首页显示</th><th>排序（小的在前）</th><th>条目数</th><th></th></tr></thead>
      <tbody>${S.profiles.map((p) => `<tr data-profile="${p.id}">
        <td>${avatar(p, 'sm')}</td>
        <td><input name="name" value="${esc(p.name)}"></td>
        <td><select name="role"><option value="member" ${p.role === 'member' ? 'selected' : ''}>成员</option><option value="admin" ${p.role === 'admin' ? 'selected' : ''}>管理员</option></select></td>
        <td><input type="checkbox" name="show_on_board" ${p.show_on_board ? 'checked' : ''}></td>
        <td><input type="number" name="sort_order" value="${p.sort_order}" class="w-num"></td>
        <td class="num">${patentsOf(p.id).length}</td>
        <td class="nowrap"><button class="icon-btn subtle" data-action="del-member" data-id="${p.id}" title="删除成员">${icon.trash}</button></td>
      </tr>`).join('')}</tbody></table></div>`;
}

// ======================= 弹窗表单 =======================
function patentForm(p = null, ownerId = null) {
  const owner = p?.owner_id || ownerId || S.me.id;
  const ownerSel = isAdmin()
    ? `<select name="owner_id">${S.profiles.map((m) => `<option value="${m.id}" ${m.id === owner ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`
    : `<select name="owner_id" disabled><option value="${S.me.id}">${esc(S.me.name)}</option></select>`;
  openModal({
    title: p ? '编辑条目' : '新建条目',
    wide: true,
    body: `<form class="form" data-modal-form>
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
          owner_id: isAdmin() ? fd.get('owner_id') : (p?.owner_id || S.me.id),
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
      <label class="field"><span>新密码</span><input type="password" name="pw" minlength="6" required autocomplete="new-password"></label>
      <label class="field"><span>再输一次</span><input type="password" name="pw2" minlength="6" required autocomplete="new-password"></label>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>取消</button><button class="btn primary" type="submit">确定</button></div></form>`,
    onMount(m, close) {
      m.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        if (fd.get('pw') !== fd.get('pw2')) return toast('两次输入不一致', 'error');
        try { await api.changePassword(fd.get('pw')); toast('密码已修改', 'ok'); close(); } catch (err) { handleErr(err); }
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

function deleteMemberForm(m) {
  const self = m.id === S.me.id;
  const list = patentsOf(m.id);
  const nFiles = list.reduce((n, p) => n + filesOf(p.id).length, 0);
  const others = S.profiles.filter((x) => x.id !== m.id);
  if (m.role === 'admin' && !S.profiles.some((x) => x.id !== m.id && x.role === 'admin')) {
    toast('这是唯一的管理员，请先在「成员」页把其他人设为管理员', 'error');
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
      <p class="confirm-text">${self
        ? '注销后你的登录账号会被删除，无法再登录本站。'
        : `将删除 ${esc(m.name)} 的登录账号，TA 将无法再登录。`}
        TA 添加过的进展记录和上传的文件会保留。</p>
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
          if (mode === 'delete') {
            for (const p of list) await api.deletePatent(p.id, filesOf(p.id));
          }
          await api.deleteMember(m.id, to);
          close();
          if (self) {
            await api.signOut();
            S.loaded = false; S.me = null; location.hash = '#/';
            renderLogin();
            toast('账号已注销', 'ok');
            return;
          }
          if (location.hash.includes(m.id)) location.hash = '#/';
          await reload(); render();
          toast(`已删除成员 ${m.name}`, 'ok');
        } catch (err) {
          busy(btn, false);
          handleErr(err);
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
  await run(async () => {
    for (const f of ok) {
      if (label) label.textContent = `上传中 ${++n}/${ok.length}：${f.name}`;
      await api.uploadFile(pid, f, note);
    }
  }, `已上传 ${ok.length} 个文件`);
}

// ======================= 事件绑定 =======================
const actions = {
  menu(el) { const m = el.nextElementSibling; m.hidden = !m.hidden; },
  async logout() { await api.signOut(); S.loaded = false; S.me = null; location.hash = '#/'; renderLogin(); },
  'change-pw': changePwForm,
  'rename-self': renameSelfForm,
  async 'reset-demo'() {
    if (await confirmDialog('将清空本浏览器中的演示数据并恢复示例数据，确定？', '重置')) { api.resetDemo(); location.hash = '#/'; location.reload(); }
  },
  'new-patent'(el) { patentForm(null, el.dataset.owner); },
  'edit-patent'(el) { patentForm(patent(el.dataset.id)); },
  async 'del-patent'(el) {
    const p = patent(el.dataset.id);
    if (!await confirmDialog(`删除「${p.title}」？其进展记录和 ${filesOf(p.id).length} 个文件也会一并删除，无法恢复。`)) return;
    const owner = p.owner_id;
    location.hash = `#/member/${owner}`;
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
  'del-member'(el) { deleteMemberForm(profile(el.dataset.id)); },
};

root.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (a) { e.preventDefault(); actions[a.dataset.action]?.(a, e); return; }
  const tr = e.target.closest('tr[data-href]');
  if (tr) { location.hash = tr.dataset.href; return; }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.user-menu')) root.querySelectorAll('.user-menu .menu').forEach((m) => { m.hidden = true; });
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

async function saveProfileField(t) {
  const tr = t.closest('tr[data-profile]');
  const id = tr.dataset.profile;
  const old = profile(id);
  let patch;
  if (t.name === 'name') {
    const name = t.value.trim();
    if (!name) { t.value = old.name; return toast('显示名不能为空', 'error'); }
    if (name === old.name) return;
    patch = { name };
  } else if (t.name === 'role') {
    if (id === S.me.id && t.value !== 'admin' && !await confirmDialog('确定取消自己的管理员身份？取消后将无法再进入本页面。', '确定')) {
      t.value = old.role; return;
    }
    patch = { role: t.value };
  } else if (t.name === 'show_on_board') {
    patch = { show_on_board: t.checked };
  } else if (t.name === 'sort_order') {
    patch = { sort_order: parseInt(t.value, 10) || 0 };
  } else return;
  await run(() => api.updateProfile(id, patch), `已保存：${patch.name || old.name}`);
}

root.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.closest('tr[data-profile]')) return saveProfileField(t);
  const c = t.dataset.change;
  if (c === 'progress') await run(() => api.updatePatent(t.dataset.id, { progress: +t.value }), '进度已更新');
  else if (c === 'stage') await run(() => api.updatePatent(t.dataset.id, { stage: t.value }), '阶段已更新');
  else if (c === 'upload') { await uploadFiles(t.dataset.id, t.files); t.value = ''; }
  else if (c === 'event-kind') {
    const s = t.form.querySelector('[name=stage_sync]');
    if (s) s.value = EVENT_KINDS[t.value]?.stage || '';
  }
});

root.addEventListener('submit', async (e) => {
  const f = e.target;
  if (f.dataset.form === 'login') {
    e.preventDefault();
    const fd = new FormData(f);
    const btn = f.querySelector('[type=submit]');
    busy(btn, true, '登录中…');
    try {
      await api.signIn(fd.get('login'), fd.get('password'));
      S.loaded = false;
      await render();
    } catch (err) { handleErr(err); busy(btn, false); }
  }
  if (f.dataset.form === 'add-event') {
    e.preventDefault();
    const fd = new FormData(f);
    const pid = f.dataset.id;
    const content = fd.get('content').trim();
    const kind = fd.get('kind');
    if (!content && kind !== 'submit') return toast('请填写内容', 'error');
    const stage = fd.get('stage_sync');
    const btn = f.querySelector('[type=submit]');
    busy(btn, true, '提交中…');
    await run(async () => {
      await api.addEvent({ patent_id: pid, kind, content, happened_on: fd.get('happened_on') || today() });
      if (stage && patent(pid).stage !== stage) await api.updatePatent(pid, { stage });
    }, '已添加记录');
  }
});

root.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('tr[data-profile] input')) e.target.blur();
});

// 记住「最近动态」展开状态（toggle 事件不冒泡，用捕获）
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

function afterRender() { /* 预留 */ }

render();
