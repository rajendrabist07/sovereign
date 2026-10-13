import { createCallerFactory, router } from "../init";
import { quotaRouter } from "./quota";
import { runRouter } from "./run";
import { workflowRouter } from "./workflow";

export const appRouter = router({
  workflow: workflowRouter,
  run: runRouter,
  quota: quotaRouter
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
