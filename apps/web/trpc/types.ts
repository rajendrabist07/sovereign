import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "./routers/_app";

export type RouterOutputs = inferRouterOutputs<AppRouter>;
