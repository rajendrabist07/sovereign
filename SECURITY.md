# Security

## Reporting a problem

Please report security issues privately, not in a public issue. Use GitHub's "Report a vulnerability" on the Security tab of this repository. This is a portfolio project, so there is no response-time commitment.

## What is claimed, and what backs it

Each claim below says which test covers it. "Not proved" lists what is not covered by a test. Tests run against a real Postgres database and the live Supabase instance.

### Tenant isolation

- Claim: one organisation cannot read or change another organisation's data.
- How: Postgres row level security is enabled and forced on every tenant table, and the app connects as a role that is not a superuser and cannot bypass it. The tenant id is set per transaction with `set_config(..., true)`.
- Proved by: `verify-permissions` (31 checks: role attributes, RLS on and forced with a policy on every tenant table, rows hidden without a tenant set, rows of another tenant hidden); `verify-rbac` (tenant B gets zero rows and `NOT_FOUND` on get, update and delete of tenant A's workflow, and A's workflow is unchanged).
- Reproduced: the 8 migrations plus the role SQL in the README were run on a throwaway local Postgres 17 with two seeded tenants, and all 31 permission checks passed.
- Not proved: a second organisation signing in on the live site is supported by screenshots only, not by an explicit check. The database tests are not run in CI.

### Roles

- Claim: VIEWER < MEMBER < ADMIN < OWNER, enforced on the server.
- Proved by: `verify-rbac`, `verify-session`, `verify-approval` (a VIEWER or MEMBER cannot decide an approval).
- Not proved: OWNER has no test, and the app never assigns it (Clerk `org:admin` maps to ADMIN, everything else to MEMBER).

### Audit log

- Claim: the audit log can be written and read, but not edited or deleted by the app.
- Proved by: `verify-audit` (UPDATE and DELETE on `audit_log` are rejected, rows are unchanged after tamper attempts, a failed attempt writes no row, tenant B cannot read tenant A's log) and `verify-permissions` (the database refuses UPDATE and DELETE; no TRUNCATE grant).
- Not proved: the audit log is not protected against a database administrator, and not every action is logged (workflow create, update, delete, run requested and approval decided are).

### Approvals

- Claim: only an ADMIN or OWNER of the same tenant can decide, and a decision is recorded once.
- Proved by: `verify-approval` (permission checks, tenant isolation, 5 simultaneous decisions with exactly one winner, a late opposite decision changes nothing).

### Outbound requests (SSRF)

- Claim: the AI agent's HTTP tool only reaches https hosts on an allowlist and never private addresses. The address is checked when the socket connects, redirects are not followed, and size and time are capped.
- Proved by: `verify-safe-fetch` (host rules, decimal and hex IPv4, IPv6, an IPv4 hidden in IPv6, the cloud metadata address) and `verify-agent-step`.
- Not proved: the workflow `HTTP_REQUEST` step uses a weaker check (https only, no private-address literals, no DNS resolution), so a public name that resolves to a private address would pass. Moving it to the safe fetch is planned.

### Prompt injection

- Claim: data fetched by tools is wrapped as untrusted input for the model, tools take strictly validated arguments, and the agent has hard limits. The defaults in code are 5 iterations, 8000 tokens and 4 tool calls per turn; a test asserts the 5, and the other two limits are enforced and tested with smaller values, but their default numbers are not asserted by a test.
- Proved by: `verify-agent-logic` against a scripted fake model.
- Not proved: nothing was tested against a real model. The agent has never called the real Groq API, so resistance to real prompt injection is unknown.

### Error messages

- Claim: in production, an unexpected server error shows a generic message with a reference, and the real error stays in the server log. A failed step stores only messages the app wrote itself.
- Proved by: `verify-error-text` (unit tests) and `verify-runner` (authored messages such as `HTTP 404` survive).
- Not proved: it has not been triggered on the live site, and the failed-step path for an unexpected error has no end-to-end test.

### Secrets and the public repository

- The repository is public. `.env` is git-ignored; only `.env.example` (names, no values) is committed.
- A scan of the commit history in an earlier session found no real keys or passwords. The matches were test placeholders and `${...}` templates. That scan was not re-run for this file and is not part of CI.
- Not proved: no automated secret scanning runs in CI.

### Known gaps

- Development and the live site share one database.
- No rate limiting yet, and API keys are not implemented.
- A crash between committing a run and queueing its event can leave a run PENDING (no outbox).
- The restricted database role is created by hand, not by a migration.
