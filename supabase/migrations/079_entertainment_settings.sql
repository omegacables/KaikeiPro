-- 交際費の設定（顧問先ごと）と、仕訳の行の交際費の区分・参加人数
--   clients.industry               … 業種（src/lib/entertainment.ts の IndustryCode。null は業種欄から推し量る）
--   clients.entertainment_settings … 1人当たりの基準額・基準額以下の飲食を移す科目・定額控除を使えない法人・独自のルール
--   journal_entry_lines.entertainment_kind … 接待飲食費 / 1人当たり基準額以下の飲食費 / 贈答 / 招待 / 慶弔 / その他
--   journal_entry_lines.attendees / attendee_note … 参加人数と相手（1人当たり基準額以下の飲食を交際費から除くときに記録が要る）

alter table clients
    add column if not exists industry text,
    add column if not exists entertainment_settings jsonb not null default '{}'::jsonb;

alter table clients drop constraint if exists clients_industry_check;
alter table clients add constraint clients_industry_check
    check (industry is null or industry in (
        'general', 'restaurant', 'retail', 'wholesale', 'manufacturing', 'construction', 'real_estate',
        'medical', 'care', 'professional', 'it', 'beauty', 'transport', 'hotel', 'education', 'agriculture'
    ));

alter table journal_entry_lines
    add column if not exists entertainment_kind text,
    add column if not exists attendees integer,
    add column if not exists attendee_note text;

alter table journal_entry_lines drop constraint if exists journal_entry_lines_entertainment_kind_check;
alter table journal_entry_lines add constraint journal_entry_lines_entertainment_kind_check
    check (entertainment_kind is null or entertainment_kind in ('dining', 'dining_under_limit', 'gift', 'golf', 'condolence', 'other'));

alter table journal_entry_lines drop constraint if exists journal_entry_lines_attendees_check;
alter table journal_entry_lines add constraint journal_entry_lines_attendees_check
    check (attendees is null or (attendees > 0 and attendees <= 10000));
