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
    { name: '撰写中',         color: '#f08c00', bg: '#fff4e6' },   // 橙
    { name: '导师审核',       color: '#7048e8', bg: '#f3f0ff' },   // 紫
    { name: '交专利中心审核', color: '#212529', bg: '#e9ecef' },   // 黑
    { name: '返回修改',       color: '#e03131', bg: '#fff5f5' },   // 红
    { name: '已提交受理',     color: '#1c7ed6', bg: '#e7f5ff' },   // 蓝
    { name: '已授权/登记',    color: '#2f9e44', bg: '#ebfbee' },   // 绿
    { name: '暂停',           color: '#adb5bd', bg: '#f1f3f5' },   // 灰
  ],
};
