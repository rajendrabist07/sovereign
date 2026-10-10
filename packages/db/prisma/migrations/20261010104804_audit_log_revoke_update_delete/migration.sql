-- audit_log is append-only. RLS already has no UPDATE/DELETE policy
-- (default deny); this adds an independent second layer by removing
-- the privilege itself, so even a future mistaken policy cannot
-- re-enable tampering.
-- app_user is a cluster-level role created outside migrations, so the
-- REVOKE is guarded: a fresh database without it must not fail.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_log FROM app_user;
  END IF;
END
$$;
