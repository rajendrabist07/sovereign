-- The app's runtime role must not be able to read or rewrite the migration
-- history: migrations are applied with the privileged DIRECT_URL, never at
-- runtime. REVOKE is guarded so a fresh database without the role does not fail.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    REVOKE ALL ON TABLE _prisma_migrations FROM app_user;
  END IF;
END
$$;
