// =====================================================================
//  站点配置 —— 部署前只需要改这个文件
// =====================================================================
window.APP_CONFIG = {
  APP_NAME: '专利进度看板',

  // ---- Supabase（留空 = 本地演示模式，数据只存在当前浏览器里）----
  // 控制台 → Project Settings → API：
  //   SUPABASE_URL  形如 https://xxxxxxxx.supabase.co
  //   SUPABASE_KEY  anon public key（或 publishable key）。此 key 本身就是公开的，
  //                 数据安全靠数据库里的 RLS 规则保证，可以放心提交到 GitHub。
  SUPABASE_URL: 'https://vinbdqxadzhtnrsfnvrt.supabase.co',
  SUPABASE_KEY: 'sb_publishable_BUpX3Lbdien_Kqy1FgrHGA_teOCbQv6',

  // 登录时输入的「用户名」会自动补成 用户名@EMAIL_DOMAIN 去登录。
  // 在 Supabase 里建账号时邮箱就填 zhangsan@team.local 这种形式。
  EMAIL_DOMAIN: 'team.local',

  STORAGE_BUCKET: 'patent-files',
  MAX_FILE_MB: 50,

  // 条目类型
  KINDS: ['发明专利', '实用新型', '软件著作权'],

  // 阶段：顺序即流程顺序，颜色用于标签
  STAGES: [
    { name: '撰写中',         color: '#b4234a', bg: '#fdecef' },
    { name: '导师审核',       color: '#6d3fc0', bg: '#f1ecfb' },
    { name: '交专利中心审核', color: '#a15c07', bg: '#fdf3e1' },
    { name: '返回修改',       color: '#c2410c', bg: '#fdeee6' },
    { name: '已提交受理',     color: '#1d5fb8', bg: '#e8f0fc' },
    { name: '已授权/登记',    color: '#1f7a52', bg: '#e5f4ec' },
    { name: '暂停',           color: '#5f6670', bg: '#eff0f2' },
  ],
};
