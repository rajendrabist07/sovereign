-- A person may only see and change their own users row. The caller says who
-- they are with set_config('app.clerk_id', ..., true) inside a transaction
-- (withUser in packages/db). NULLIF turns the empty value a pooled connection
-- can hold after a transaction into NULL, so it matches no row.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY user_self ON users
  USING ("clerkId" = NULLIF(current_setting('app.clerk_id', true), ''))
  WITH CHECK ("clerkId" = NULLIF(current_setting('app.clerk_id', true), ''));
