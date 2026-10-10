-- 勘定科目内訳明細書: 入力で作る様式を増やす（①預貯金等・⑤棚卸資産・⑦固定資産・⑩-2源泉所得税預り金・⑫土地の売上高等・⑬事業所別・⑭-1役員給与等）
alter table breakdown_items drop constraint if exists breakdown_items_form_key_check;
alter table breakdown_items add constraint breakdown_items_form_key_check
    check (form_key in ('1', '2', '3', '4-1', '5', '6', '7', '8', '9', '10-1', '10-2', '12', '13', '14-1', '15-1', '15-2'));
