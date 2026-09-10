-- 明細と仕訳の結び付き方を区別する。
--
-- これまでは仕訳が必ず台帳から生成されたものだったため、仕訳化を取り消す・
-- 明細を削除する際に仕訳も併せて削除していた。
-- 既にある仕訳（前の会計ソフトからの引き継ぎ、銀行明細の取込、過年度の仕訳）を
-- 台帳に取り込めるようにすると、この前提が崩れる。
-- 取り込んだだけの仕訳を消してしまうと、利用者の元データを失う。
--
--   generated … 台帳の明細から生成した仕訳。取り消し・削除で一緒に消す
--   linked    … もとからあった仕訳に結び付けただけ。結び付きを外すだけで仕訳は残す
alter table loan_entries
  add column if not exists journal_link text not null default 'generated'
    check (journal_link in ('generated', 'linked'));

comment on column loan_entries.journal_link is
  'generated=台帳から生成した仕訳（削除時に一緒に消す） / linked=既存の仕訳に結び付けただけ（消さない）';

-- 同じ仕訳が複数の明細に結び付くと、残高が二重に計上される
create unique index if not exists loan_entries_journal_entry_id_uniq
  on loan_entries (journal_entry_id)
  where journal_entry_id is not null;
