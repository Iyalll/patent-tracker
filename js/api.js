import { createSupabaseBackend } from './backend-supabase.js';
import { createDemoBackend } from './backend-demo.js';

const cfg = window.APP_CONFIG;

export const api = cfg.SUPABASE_URL && cfg.SUPABASE_KEY
  ? createSupabaseBackend(cfg)
  : createDemoBackend(cfg);
