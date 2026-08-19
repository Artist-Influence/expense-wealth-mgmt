-- Run in the OLD project's SQL editor; save the single output cell to export/auth.json.
-- Copies users WITH password hashes + identities, so logins survive the move.
SELECT json_build_object(
  'users', (SELECT COALESCE(json_agg(u), '[]'::json) FROM auth.users u),
  'identities', (SELECT COALESCE(json_agg(i), '[]'::json) FROM auth.identities i)
) AS auth_export;
