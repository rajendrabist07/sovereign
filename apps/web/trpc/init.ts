import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { withTenant } from "@sovereign/db";
import { roleAtLeast, type Role } from "@sovereign/shared";

export type Session = { userId: string; tenantId: string; role: Role };

export type Context = {
  session: Session | null;
  /** Why session is null, so we can return the right error code. */
  reason?: "UNAUTHENTICATED" | "NO_ORGANIZATION";
};

type AfterCommit = (fn: () => Promise<void>) => void;

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

/**
 * Every protected procedure goes through the same 3 gates, in this order:
 *   1. signed in + has an active organization
 *   2. role is high enough (rejected BEFORE we open a DB transaction)
 *   3. runs inside withTenant(), so ctx.db is RLS-scoped
 * Side effects that must only happen if the transaction COMMITS (queueing
 * a job, sending an email) go through ctx.afterCommit(), which runs them
 * after the commit and never if the procedure failed.
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
    .use(async ({ ctx, next }) => {
      const pending: Array<() => Promise<void>> = [];
      const afterCommit: AfterCommit = (fn) => {
        pending.push(fn);
      };

      const result = await withTenant(ctx.session.tenantId, async (tx) => {
        const inner = await next({ ctx: { db: tx, afterCommit } });
        // tRPC returns procedure errors as a value instead of throwing.
        // Re-throw so the transaction ROLLS BACK instead of committing
        // half-finished work.
        if (!inner.ok) throw inner.error;
        return inner;
      });

      // The transaction has committed: now it is safe to tell the outside world.
      for (const fn of pending) await fn();
      return result;
    });

export const viewerProcedure = procedureFor("VIEWER");
export const memberProcedure = procedureFor("MEMBER");
export const adminProcedure = procedureFor("ADMIN");
