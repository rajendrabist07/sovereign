import { createCallerFactory, router } from "../init";
import { runRouter } from "./run";
import { workflowRouter } from "./workflow";

export const appRouter = router({
  workflow: workflowRouter,
  run: runRouter
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
