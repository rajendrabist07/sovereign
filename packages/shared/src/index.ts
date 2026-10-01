import { z } from "zod";


export const healthCheckSchema = z.object({
    ok: z.literal(true),
    service: z.literal("sovereign")
});


export type HealthCheck = z.infer<typeof healthCheckSchema>;