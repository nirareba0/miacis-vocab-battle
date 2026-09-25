export const SUPABASE_URL = 'https://aljlbxvucscmpbcuccin.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsamxieHZ1Y3NjbXBiY3VjY2luIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzMjI3NjgsImV4cCI6MjEwNTg5ODc2OH0.vOztp7iBU5ylXyj6hPtBe7E3WmIrlGMszO5P3-Sb27U';

export function isConfigured() {
  return (
    SUPABASE_ANON_KEY &&
    SUPABASE_ANON_KEY !== '__ANON_KEY__' &&
    SUPABASE_ANON_KEY.trim() !== ''
  );
}
