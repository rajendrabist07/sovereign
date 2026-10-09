import { createCallerFactory, router } from "../init";
import { workflowRouter } from "./workflow";

export const appRouter = router({
  workflow: workflowRouter
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
