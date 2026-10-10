-- 0035: おとなのランキングと、結果の画面の最後のお知らせ（2026-10-10 本人「おとなのランキングも見れるところを」「最後の画面で BINGO 大会の案内を。何時からと、景品がほかにもあること」）
--   quiz_ranking に p_student（既定は中高生）。おとな（それ以外）は参考のランキングで、クーポンは今までどおり中高生だけ。
--   quiz_sets に「最後のお知らせ」（見出し・本文・画像・リンク）。結果の画面に出す。

alter table public.quiz_sets add column end_title text check (end_title is null or char_length(end_title) <= 60);
alter table public.quiz_sets add column end_body text check (end_body is null or char_length(end_body) <= 300);
alter table public.quiz_sets add column end_image_path text check (end_image_path is null or char_length(end_image_path) <= 300);
alter table public.quiz_sets add column end_link_url text check (end_link_url is null or (end_link_url ~ '^https://' and char_length(end_link_url) <= 500));

revoke update (title, time_limit_sec, prize, coupon_url, closes_at) on public.quiz_sets from authenticated;
revoke insert (title, time_limit_sec, prize, coupon_url, closes_at) on public.quiz_sets from authenticated;
grant insert (title, time_limit_sec, prize, coupon_url, closes_at, end_title, end_body, end_image_path, end_link_url),
      update (title, time_limit_sec, prize, coupon_url, closes_at, end_title, end_body, end_image_path, end_link_url)
  on public.quiz_sets to authenticated;

drop function public.quiz_ranking(uuid, text);
create or replace function public.quiz_ranking(p_set uuid, p_token text default null, p_student boolean default true) returns table (
  rank int, nickname text, correct int, total_ms int, is_me boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  pid uuid;
begin
  if coalesce(p_token, '') <> '' then
    select s.player_id into pid from public.quiz_sessions s
     where s.token_hash = public.quiz_hash(p_token) and s.expires_at > now();
  end if;
  return query
    select (row_number() over (order by a.correct desc, a.total_ms asc, a.finished_at asc))::int,
      pl.nickname, a.correct, a.total_ms, coalesce(a.player_id = pid, false)
    from public.quiz_attempts a
    join public.quiz_players pl on pl.id = a.player_id
    join public.quiz_sets z on z.id = a.set_id
    where a.set_id = p_set and a.finished_at is not null and z.status <> 'draft' and pl.is_student is not distinct from p_student
      and (z.closes_at is null or a.finished_at <= z.closes_at)
    order by 1
    limit 100;
end;
$$;
revoke execute on function public.quiz_ranking(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.quiz_ranking(uuid, text, boolean) to anon, authenticated;

create or replace function public.quiz_list(p_token text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pid uuid;
begin
  if coalesce(p_token, '') <> '' then
    select s.player_id into pid from public.quiz_sessions s
     where s.token_hash = public.quiz_hash(p_token) and s.expires_at > now();
  end if;
  return (
    select coalesce(jsonb_agg(r order by r->>'status' desc, (r->>'opened_at') desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', z.id, 'title', z.title, 'time_limit_sec', z.time_limit_sec, 'prize', z.prize,
        'status', z.status, 'opened_at', z.opened_at, 'closed_at', z.closed_at, 'closes_at', z.closes_at,
        'total', (select count(*) from public.quiz_set_items i where i.set_id = z.id),
        'players', (select count(*) from public.quiz_attempts a2 join public.quiz_players p2 on p2.id = a2.player_id
                     where a2.set_id = z.id and a2.finished_at is not null and p2.is_student
                       and (z.closes_at is null or a2.finished_at <= z.closes_at)),
        'adults', (select count(*) from public.quiz_attempts a3 join public.quiz_players p3 on p3.id = a3.player_id
                    where a3.set_id = z.id and a3.finished_at is not null and p3.is_student = false
                      and (z.closes_at is null or a3.finished_at <= z.closes_at)),
        'end_title', z.end_title, 'end_body', z.end_body, 'end_image_path', z.end_image_path, 'end_link_url', z.end_link_url,
        'my_correct', a.correct, 'my_finished', a.finished_at is not null, 'my_started', a.id is not null
      ) as r
      from public.quiz_sets z
      left join public.quiz_attempts a on a.set_id = z.id and a.player_id = pid
      where z.status in ('open', 'closed')
    ) s
  );
end;
$$;
