-- Expense Memory: un-mix the Aug-2 wrong-tab imports (2026-08-19)
-- Backup of all affected rows already exists in _backup_mixed_import_20260819.
-- Expected result: duplicates_removed=143 ($213,134), rows_moved_to_business=196 ($160,984), batches_fixed=2.
WITH p8 AS (
  SELECT id, amount, date, description_normalized,
         ROW_NUMBER() OVER (PARTITION BY date, amount, description_normalized ORDER BY id) rn
  FROM transactions_uploaded
  WHERE source_file_name='Chase8886_Activity_20260802.csv' AND transaction_mode='personal' AND deleted_at IS NULL
),
b8 AS (
  SELECT date, amount, description_normalized, COUNT(*) c
  FROM transactions_uploaded
  WHERE source_file_name='Chase8886_Activity_20260802.csv' AND transaction_mode='business' AND deleted_at IS NULL
  GROUP BY 1,2,3
),
p2 AS (
  SELECT id, amount, date, description_normalized,
         ROW_NUMBER() OVER (PARTITION BY date, amount, description_normalized ORDER BY id) rn
  FROM transactions_uploaded
  WHERE source_file_name='Chase2662_Activity_20260802.csv' AND transaction_mode='personal' AND deleted_at IS NULL
),
b2 AS (
  SELECT date, amount, description_normalized, COUNT(*) c
  FROM transactions_uploaded
  WHERE transaction_mode='business' AND deleted_at IS NULL
  GROUP BY 1,2,3
),
victims AS (
  SELECT p8.id, p8.amount FROM p8
  JOIN b8 ON p8.date=b8.date AND p8.amount=b8.amount
         AND p8.description_normalized=b8.description_normalized AND p8.rn<=b8.c
  UNION ALL
  SELECT p2.id, p2.amount FROM p2
  JOIN b2 ON p2.date=b2.date AND p2.amount=b2.amount
         AND p2.description_normalized=b2.description_normalized AND p2.rn<=b2.c
),
softdeleted AS (
  UPDATE transactions_uploaded
  SET deleted_at = now()
  WHERE id IN (SELECT id FROM victims)
  RETURNING id, amount
),
flipped AS (
  UPDATE transactions_uploaded t
  SET mode='business',
      transaction_mode='business',
      economic_owner='artist_influence',
      counts_toward_true_personal_spend=false,
      counts_toward_true_business_spend=(NOT COALESCE(t.is_transfer,false) AND COALESCE(t.treatment_type,'expense')='expense'),
      duplicate_fingerprint = lower('business|' || COALESCE(t.date::text,'') || '|' || trim_scale(t.amount)::text || '|' || COALESCE(t.description_normalized,''))
  WHERE t.source_file_name IN ('Chase8886_Activity_20260802.csv','Chase2662_Activity_20260802.csv')
    AND t.transaction_mode='personal'
    AND t.deleted_at IS NULL
    AND t.id NOT IN (SELECT id FROM victims)
  RETURNING id, amount
),
batches AS (
  UPDATE upload_batches SET mode='business'
  WHERE file_name IN ('Chase8886_Activity_20260802.csv','Chase2662_Activity_20260802.csv') AND mode='personal'
  RETURNING id
)
SELECT (SELECT COUNT(*) FROM softdeleted)                     AS duplicates_removed,
       (SELECT ROUND(SUM(amount)::numeric,0) FROM softdeleted) AS duplicates_total,
       (SELECT COUNT(*) FROM flipped)                          AS rows_moved_to_business,
       (SELECT ROUND(SUM(amount)::numeric,0) FROM flipped)     AS moved_total,
       (SELECT COUNT(*) FROM batches)                          AS batches_fixed;
