// Supabase の接続先（anon key は公開してよい鍵。読み書きの可否は表の鍵（RLS）で決まる）
// 空にすると試作モード（ブラウザ内のサンプルデータで動く）
const SUPABASE_URL = 'https://xbjcxouwewvkgnrkdwca.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhiamN4b3V3ZXd2a2ducmtkd2NhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5NTM2ODcsImV4cCI6MjExMDUyOTY4N30.5-r5RD5KYh8x0j9AEGM0MxS4iOAaFSbJNzzPjXIhgRc';
// 閲覧ページを置く場所（Edge Function view）
const VIEW_API = SUPABASE_URL + '/functions/v1/view';
