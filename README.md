# 专利进度看板

团队分工撰写专利 / 软著时用的进度管理小站：谁写了几篇、各自写到哪一步、什么时候交的专利中心、老师提了什么意见、最新文件在哪，一目了然。

- **总览**：团队统计；「专利中心 / 老师意见」列表（`11-26 陈老师 对 李四《…》进行了批注：…`）；可折叠的全部动态；成员卡片（一行两个，默认显示 3 篇，可展开，点条目直接跳转）
- **个人页**：TA 的全部条目，进度、阶段、提交 / 意见时间、最新意见摘要、文件数，有未处理意见会标红
- **条目详情**：拖动修改进度、切换阶段；进展记录时间线；文件上传、下载和**在线预览**（PDF、Word .docx、图片、文本）
- **全部条目**：总表，可按撰写人 / 阶段 / 类型筛选和搜索
- **管理**（有「可管理」权限的人）：账号、人员名单、角色与权限、注册设置
- **注册**：只有人员名单里的人能自助注册（姓名或任一别名都能匹配）；管理员可以直接给任何人开通账号、重置密码
- **登录**：用户名或名单中的姓名 / 别名都可以

## 角色与权限

角色是若干权限的组合，管理员可以在「管理 → 角色与权限」里改名称、改说明、勾选权限、新建角色：

| 权限 | 含义 |
|---|---|
| 可撰写 | 新建 / 修改 / 删除**自己名下**的条目，上报进度、阶段，上传和删除自己的文件 |
| 可审核 | 对**所有人**的条目提出「专利中心意见 / 老师批注 / 备注」、上传批注文件；**不能**修改或删除别人的条目、记录 |
| 可修改所有 | 修改、删除所有人的条目，删除任何人的记录和文件 |
| 可管理 | 管理账号（直接建号、重置密码、删除）、人员名单、角色、注册码 |

所有登录的人都能查看全部条目、进展记录，下载和预览文件。

默认三个角色（可随意修改）：

| 角色 | 可撰写 | 可审核 | 可修改所有 | 可管理 |
|---|:-:|:-:|:-:|:-:|
| 学生 | ✅ | | | |
| 老师 / 专利中心 | | ✅ | | |
| 管理员 | ✅ | ✅ | ✅ | ✅ |

想让老师同时是管理员：新建一个「老师（管理员）」角色，勾选「可审核 + 可管理」（需要的话再加「可修改所有」），再把老师的账号改成这个角色。

一些规则：
- 老师的意见会出现在撰写人的进展记录（紫色底）和首页「专利中心 / 老师意见」里，并标记「新意见」；撰写人之后修改了条目（进度、阶段等），就视为已处理
- 别人留的意见，撰写人**不能删除**（只有留言人自己或「可修改所有」的人能删），保证审核记录完整
- 系统始终至少保留一位有「可管理」权限的成员

以上规则写在数据库 RLS 里，绕过网页直接调接口也一样生效。

## 架构

```
浏览器 ──► GitHub Pages（本仓库的静态页面）
   │
   └────► Supabase（免费版）
            ├─ Auth           账号密码登录
            ├─ Postgres       条目 / 记录 / 名单 / 角色，RLS 控制权限
            ├─ Storage        私有文件桶
            └─ Edge Function  account：名单注册、管理员建号、重置密码（持有管理密钥，只在服务器上）
```

纯 HTML + 原生 JS，**无需构建、无任何 npm / CDN 依赖**（Word 预览也是自己解析的）。

## 本地预览（演示模式）

`config.js` 里 `SUPABASE_URL` 留空时自动进入演示模式，数据只存在当前浏览器。

```bash
cd patent-tracker
python -m http.server 8000
# 打开 http://localhost:8000
# 演示账号：zhangsan（管理员）/ lisi（学生）/ chen（老师），密码 123456
# 名单中「赵六」（别名 小赵）尚未注册，可用来试注册
```

## 部署

### 1. Supabase 项目与数据库

1. <https://supabase.com> → New project，Region 建议 Tokyo 或 Singapore。
2. **SQL Editor** → New query → 粘贴 `supabase/schema.sql` 全部内容 → **Run**。

> 以后更新代码时如果 `schema.sql` 有改动，重新整份运行一次即可：脚本可重复执行，旧版本会自动迁移，不会清空数据。

### 2. 登录设置

**Authentication → Sign In / Providers**：

- **Allow new users to sign up：关闭**（注册统一走下面的 Edge Function，它会先核对人员名单）
- Email 里 **Confirm email：关闭**

### 3. 部署账号服务（Edge Function）

1. 左侧 **Edge Functions** → **Deploy a new function** → **Via Editor**
2. 函数名填 **`account`**（必须是这个名字）
3. 把 `supabase/functions/account/index.ts` 的全部内容粘贴进去 → **Deploy**
4. 进入该函数的设置（Details / Settings），**关闭「Verify JWT」/「Enforce JWT verification」** → 保存。
   注册时用户还没登录，必须关闭；函数内部会自行校验管理员身份。
5. 如果你把 `config.js` 的 `EMAIL_DOMAIN` 改成了别的（不是 `team.local`），到 **Edge Functions → Secrets** 添加同名密钥 `EMAIL_DOMAIN`，值保持一致。

部署好后，在网站「管理 → 注册设置」点「检测」，显示「账号服务正常」即可。

### 4. 第一个管理员

全新项目里还没有任何账号，先手动建第一个：

1. **Authentication → Users → Add user → Create new user**：邮箱填 `你的用户名@team.local`，设密码，勾选 Auto Confirm
2. SQL Editor 执行：
   ```sql
   update public.profiles set role = 'admin', name = '你的名字' where username = '你的用户名';
   ```

之后所有账号都可以在网页里管理：「管理 → 人员名单」加人（或批量导入），让他们自己注册；或者在「账号」里直接新建账号。

### 5. 填写配置并发布

`config.js` 里填 `SUPABASE_URL` 和 `SUPABASE_KEY`（Project Settings → API 的 Project URL 和 anon / publishable key）。这个 key 本来就是公开给浏览器的，可以提交到 GitHub；**不要**放 service_role / secret key。

```bash
git add -A && git commit -m "更新" && git push
```

仓库 **Settings → Pages → Deploy from a branch → `main` / `(root)`**，约 1 分钟后可通过 `https://<用户名>.github.io/patent-tracker/` 访问。

### 6.（可选）防止 Supabase 休眠

免费项目长期无人访问会被暂停。仓库自带 `.github/workflows/keepalive.yml`，每 3 天访问一次数据库；在仓库 **Settings → Secrets and variables → Actions** 添加 `SUPABASE_URL`、`SUPABASE_KEY` 即可启用。

## 安全提示

网站地址是公开的，任何知道名单里某个未注册姓名的人，理论上都能抢先用这个姓名注册。建议在「管理 → 注册设置」设一个**注册码**，只告诉团队成员；名单里的人都注册完之后也可以清空名单或保留注册码。如果发现冒名账号，在「账号」里删除即可，名单记录会恢复为「未注册」。

## 文件预览

| 类型 | 支持情况 |
|---|---|
| PDF | 浏览器内置阅读器，完整显示 |
| Word（.docx） | 浏览器内解析：正文、标题、粗体、列表、表格、图片；公式显示为文本，复杂排版以 Word 为准 |
| 图片 | png / jpg / gif / webp / bmp / svg |
| 文本 | txt / md / csv / json / tex / 代码等 |
| 其他（.doc、.pptx、.zip…） | 不预览，可下载 |

超过 8 MB 的文件不会自动加载预览，需要点「加载预览」。

## 自定义

`config.js`：`APP_NAME` 站点名称、`KINDS` 条目类型、`STAGES` 阶段名称与颜色（顺序即流程顺序）、`MAX_FILE_MB` 单文件上限（免费版最大 50 MB）。

## 目录结构

```
index.html                         入口
config.js                          配置
assets/style.css                   样式
js/app.js                          页面与交互
js/preview.js                      文件预览（含 docx 解析）
js/api.js                          自动选择后端
js/backend-supabase.js             Supabase 调用
js/backend-demo.js                 演示模式（localStorage）
js/ui.js                           通用组件
supabase/schema.sql                数据库初始化 / 升级脚本
supabase/functions/account/index.ts  账号服务（Edge Function）
```
