-- 048 の revoke が効いていなかったことへの追加対応。
--
-- PostgreSQL は関数を作ると既定で PUBLIC に EXECUTE を与える。
-- anon はそこから権限を継いでいるため、anon から revoke しても
-- PUBLIC 側が残っている限り実行できてしまう。
-- 診断で anon の実行権が消えなかったのはこのため。
-- PUBLIC ごと外し、必要な役割にだけ付け直す。
revoke execute on function public.setup_self_service_account(uuid, text, text, text) from public;
revoke execute on function public.setup_self_service_account(uuid, text, text, text) from anon;
grant execute on function public.setup_self_service_account(uuid, text, text, text) to authenticated;
grant execute on function public.setup_self_service_account(uuid, text, text, text) to service_role;
