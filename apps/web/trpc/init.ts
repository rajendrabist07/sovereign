import { initTRPC, TRPCError } from "@trpc/server";
import { withTenant } from "@sovereign/db";
import { roleAtLeast, type Role } from "@sovereign/shared";

export type Session = { userId: string; tenantId: string; role: Role };

export type Context = {
  session: Session | null;
  /** Why session is null, so we can return the right error code. */
  reason?: "UNAUTHENTICATED" | "NO_ORGANIZATION";
};

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

/**
 * Every protected procedure goes through the same 3 gates, in this order:
 *   1. signed in + has an active organization
 *   2. role is high enough (rejected BEFORE we open a DB transaction)
 *   3. runs inside withTenant(), so ctx.db is RLS-scoped
 * Middlewares are inline on purpose: that lets TypeScript narrow
 * ctx.session to non-null for everything after gate 1.
 */
export const procedureFor = (minRole: Role) =>
  t.procedure
    .use(({ ctx, next }) => {
      if (!ctx.session) {
        throw new TRPCError(
          ctx.reason === "NO_ORGANIZATION"
            ? {
                code: "PRECONDITION_FAILED",
                message: "Select or create an organization first"
              }
            : { code: "UNAUTHORIZED", message: "Sign in required" }
        );
      }
      return next({ ctx: { session: ctx.session } });
    })
    .use(({ ctx, next }) => {
      if (!roleAtLeast(ctx.session.role, minRole)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Requires ${minRole} role or higher`
        });
      }
      return next();
    })
    .use(({ ctx, next }) =>
      withTenant(ctx.session.tenantId, async (tx) => {
        const result = await next({ ctx: { db: tx } });
        // tRPC returns procedure errors as a value instead of throwing.
        // Re-throw so the transaction ROLLS BACK instead of committing
        // half-finished work.
        if (!result.ok) throw result.error;
        return result;
      })
    );

export const viewerProcedure = procedureFor("VIEWER");
export const memberProcedure = procedureFor("MEMBER");
export const adminProcedure = procedureFor("ADMIN");
