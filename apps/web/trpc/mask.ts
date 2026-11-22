import { internalErrorMessage, newRef } from "../lib/errors";

type Maskable = { message: string; data: { code: string; stack?: string | undefined } };

/**
 * Replaces the message of an INTERNAL_SERVER_ERROR (a database error, a bug)
 * with a generic one and a reference, and drops the stack. Errors we threw on
 * purpose (FORBIDDEN, TOO_MANY_REQUESTS, ...) keep their message. Outside
 * production nothing is hidden, so the real error is visible while developing.
 * `ref` is non-null exactly when the message was replaced.
 */
export function maskInternalError<S extends Maskable>(args: {
  shape: S;
  production: boolean;
  ref?: string;
}): { shape: S; ref: string | null } {
  const { shape, production } = args;
  if (!production || shape.data.code !== "INTERNAL_SERVER_ERROR") return { shape, ref: null };
  const ref = args.ref ?? newRef();
  const masked = {
    ...shape,
    message: internalErrorMessage(ref),
    data: { ...shape.data, stack: undefined }
  } as S;
  return { shape: masked, ref };
}
