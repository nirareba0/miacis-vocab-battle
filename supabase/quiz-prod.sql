-- supabase/quiz-prod.sql: Miacis クイズ（0030）の本番だけの設定。テストでは読まない。何度流してもよい
--   1. http 拡張（LINE の ID トークンを LINE のサーバーで確かめる quiz_line_verify が使う）
--   2. 問題の画像の置き場（Storage）。読むのは誰でも（公開バケット）、置く・消すのはスタッフだけ。
--      1枚 2MB まで・画像だけ（管理画面で長辺 1200px の JPEG に縮めてから送る）。問題の画像に人の顔や名前を入れない
create extension if not exists http with schema extensions;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quiz-images', 'quiz-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists quiz_images_staff_insert on storage.objects;
drop policy if exists quiz_images_staff_update on storage.objects;
drop policy if exists quiz_images_staff_delete on storage.objects;
create policy quiz_images_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'quiz-images' and public.quiz_is_admin());
create policy quiz_images_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'quiz-images' and public.quiz_is_admin());
create policy quiz_images_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'quiz-images' and public.quiz_is_admin());
