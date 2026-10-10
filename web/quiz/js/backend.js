/**
 * backend.js - 本番は Supabase＋LINE ログイン。手元（localhost）で ?demo を付けたときだけ、
 * この端末の localStorage だけで動くお試し（見た目と流れの確認用）
 */
const demo = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('demo');

export const api = demo
  ? await import('./backend-demo.js')
  : await import('./backend-supabase.js');
