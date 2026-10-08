-- Tenant-scoped tables: enable + FORCE row level security
ALTER TABLE tenants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants        FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships    ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships    FORCE ROW LEVEL SECURITY;
ALTER TABLE workflows      ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows      FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs  FORCE ROW LEVEL SECURITY;
ALTER TABLE run_steps      ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_steps      FORCE ROW LEVEL SECURITY;
ALTER TABLE approvals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals      FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log      FORCE ROW LEVEL SECURITY;
ALTER TABLE api_keys       ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys       FORCE ROW LEVEL SECURITY;
ALTER TABLE quotas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotas         FORCE ROW LEVEL SECURITY;

-- Policy pattern: a row is visible/writable only if its tenantId matches
-- the tenant_id set on the current database session (via SET LOCAL,
-- wired in Step 5's Prisma middleware). The `true` second argument to
-- current_setting() means "return NULL instead of erroring if unset" —
-- NULL never equals any tenantId, so an unset session sees ZERO rows.
-- This is "fail closed": a bug that forgets to set tenant context
-- blocks all data, it never accidentally leaks it.
--
-- NOTE: column is "tenantId" (camelCase, Prisma's default mapping) —
-- must be double-quoted in raw SQL or Postgres folds it to lowercase
-- "tenantid", which does not exist.

CREATE POLICY tenant_isolation ON tenants
  USING (id = current_setting('app.tenant_id', true))
  WITH CHECK (id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON memberships
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON workflows
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON workflow_runs
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON run_steps
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON approvals
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON api_keys
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON quotas
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- audit_log: tenant-scoped SELECT + INSERT only. No UPDATE/DELETE policy
-- is created at all — with RLS forced and no matching policy, Postgres
-- denies those commands outright. This enforces "append-only" at the
-- database level, matching the product's immutability guarantee.
CREATE POLICY tenant_isolation_select ON audit_log
  FOR SELECT
  USING ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation_insert ON audit_log
  FOR INSERT
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));