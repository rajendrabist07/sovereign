import { createCallerFactory, router, sessionProcedure } from "../init";
import { quotaRouter } from "./quota";
import { runRouter } from "./run";
import { workflowRouter } from "./workflow";

export const appRouter = router({
  /** The caller's role, so the UI can hide actions they cannot perform. */
  me: sessionProcedure.query(({ ctx }) => ({ role: ctx.session.role })),
  workflow: workflowRouter,
  run: runRouter,
  quota: quotaRouter
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
