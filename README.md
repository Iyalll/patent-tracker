# 专利进度看板

团队分工撰写专利 / 软著时用的进度管理小站：谁写了几篇、各自写到多少、什么时候交的专利中心、反馈了什么、最新文件在哪，一目了然。

- **总览**：团队统计 + 每位成员一张卡片（篇数、平均进度、阶段分布）+ 最近动态
- **个人页**：点成员卡片进入，列出 TA 的全部条目（进度、阶段、提交 / 反馈时间、最新反馈摘要、文件数）
- **条目详情**：拖动修改进度、切换阶段；按时间线记录「提交专利中心 / 专利中心反馈 / 导师批注 / 新版本 / 备注」；上传和下载文件（别人的条目只读，可下载）
- **全部条目**：类似表格的总表，可按撰写人 / 阶段 / 类型筛选和搜索
- **成员管理**：管理员可改显示名、角色、首页是否显示、排序；本人或管理员可删除成员（成员卡片右上角 / 个人页）
- **只有团队账号能登录**：关闭公开注册，账号由管理员创建；未登录读不到任何数据和文件

## 架构

```
浏览器 ──► GitHub Pages（本仓库的静态页面，免费）
   │
   └────► Supabase（免费版）
            ├─ Auth      账号密码登录
            ├─ Postgres  条目 / 记录 / 文件信息，RLS 控制权限
            └─ Storage   私有文件桶，下载时生成 10 分钟有效的临时链接
```

纯 HTML + 原生 JS，**无需构建、无任何 npm 依赖**，推送到 GitHub 就能用。

## 本地预览（演示模式）

`config.js` 里 `SUPABASE_URL` 留空时自动进入演示模式，数据只存在当前浏览器。

```bash
cd patent-tracker
python -m http.server 8000
# 打开 http://localhost:8000
# 演示账号：zhangsan（管理员）/ lisi / wangwu，密码 123456
```

> 不能直接双击 index.html 打开（浏览器禁止 file:// 加载模块），需要像上面这样起一个本地服务。

## 部署（约 15 分钟）

### 1. 创建 Supabase 项目

1. 注册 <https://supabase.com> → New project。Region 建议选 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**，国内访问延迟较低。
2. 左侧 **SQL Editor** → New query → 把 `supabase/schema.sql` 全部粘贴进去 → **Run**。会建好 4 张表、权限规则和 `patent-files` 文件桶。

> 以后更新代码时如果 `schema.sql` 有改动，重新整份运行一次即可，脚本可重复执行、不会清空数据。

### 2. 关闭公开注册

**Authentication → Sign In / Providers**（旧版叫 Settings）：

- 关闭 **Allow new users to sign up**（这样只有管理员能建账号）
- Email 提供方里关闭 **Confirm email**

### 3. 给团队成员建账号

**Authentication → Users → Add user → Create new user**：

| 字段 | 填写 |
|---|---|
| Email | `用户名@team.local`，如 `zhangsan@team.local` |
| Password | 初始密码（成员登录后可在右上角自行修改） |
| Auto Confirm User | ✅ 勾选 |

成员登录时只需输入 `zhangsan` + 密码（也可以直接输完整邮箱）。如果控制台不接受 `team.local` 这种邮箱，把 `config.js` 的 `EMAIL_DOMAIN` 改成别的域名（比如你们实验室域名）即可，或者直接用真实邮箱。

然后在 SQL Editor 里把自己设成管理员（之后改名、改角色都可以在网页「成员」页里操作）：

```sql
update public.profiles set role = 'admin', name = '你的名字'
where id = (select id from auth.users where email = 'zhangsan@team.local');
```

> 导师等只看不写的人也可以建账号，在「成员」页取消「首页显示」即可。

### 4. 填写配置

**Project Settings → API**（或 API Keys）里复制：

- Project URL → `config.js` 的 `SUPABASE_URL`
- `anon` `public` key（新版叫 publishable key）→ `SUPABASE_KEY`

这个 key 设计上就是公开给浏览器用的，可以提交到 GitHub；数据安全由数据库 RLS 规则保证。**千万不要**把 `service_role` / secret key 放进来。

### 5. 发布到 GitHub Pages

```bash
git add -A && git commit -m "配置 Supabase"
git remote add origin https://github.com/<你的用户名>/patent-tracker.git
git push -u origin main
```

仓库 **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)` → Save**。
1 分钟左右就能通过 `https://<你的用户名>.github.io/patent-tracker/` 访问。

> 免费账号的 GitHub Pages 要求仓库是 Public。代码公开没关系——没有账号的人打开页面只能看到登录框，读不到任何数据。

### 6.（可选）防止 Supabase 休眠

免费项目长时间无人访问会被自动暂停。仓库里自带 `.github/workflows/keepalive.yml`，每 3 天访问一次数据库。启用方法：仓库 **Settings → Secrets and variables → Actions** 添加两个 secret：`SUPABASE_URL`、`SUPABASE_KEY`（同 config.js）。

## 权限规则

| 操作 | 普通成员 | 管理员 |
|---|---|---|
| 查看所有条目、进展记录，下载文件 | ✅ 全部 | ✅ 全部 |
| 新建 / 编辑 / 删除条目，拖进度、改阶段 | 仅自己名下的 | 所有人的 |
| 添加 / 删除进展记录（提交、反馈、批注、备注） | 仅自己名下的条目 | 所有条目 |
| 上传 / 删除文件 | 仅自己名下的条目 | 所有条目 |
| 新建时指定他人为撰写人、转交条目 | ❌ | ✅ |
| 改显示名 | 仅自己 | 所有人 |
| 改角色、首页显示、排序 | ❌ | ✅（不能取消最后一位管理员） |
| 删除成员（名下条目可转交他人或一并删除） | 仅注销自己 | 所有人（不能删最后一位管理员） |

以上规则写在数据库 RLS 里，绕过网页直接调接口也一样生效。

## 自定义

都在 `config.js`：

- `APP_NAME`：站点名称
- `KINDS`：条目类型（发明专利 / 实用新型 / 软著…）
- `STAGES`：阶段名称和颜色，顺序即流程顺序
- `MAX_FILE_MB`：单文件上限（Supabase 免费版最大 50 MB；改大需同时改 schema.sql 里的 `file_size_limit` 并升级套餐）

## 目录结构

```
index.html              入口
config.js               配置
assets/style.css        样式
js/app.js               页面与交互
js/api.js               自动选择后端
js/backend-supabase.js  Supabase REST 调用（登录、数据、文件）
js/backend-demo.js      演示模式（localStorage）
js/ui.js                通用组件（弹窗、提示、图标）
supabase/schema.sql     数据库初始化脚本
```

## 免费额度参考

Supabase 免费版：数据库 500 MB、文件存储 1 GB、每月 5 万活跃用户——一个课题组用绰绰有余。文件存储如果紧张，可以只上传终稿 / 关键版本，或定期清理旧版本。
