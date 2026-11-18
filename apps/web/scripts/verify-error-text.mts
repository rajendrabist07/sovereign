import { friendlyMessage, GENERIC_ERROR, internalErrorMessage } from "../lib/errors";
import { maskInternalError } from "../trpc/mask";

// No database, no network: what a person is shown when a request fails.

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

const RAW = "Invalid `prisma.user.upsert()` invocation: Can't reach database server at db.example.supabase.co";
const STACK = "Error: boom\n    at /Users/someone/project/secret.ts:1:1";
const shapeOf = (code: string, message: string) => ({
  message,
  code: -32603,
  data: { code, httpStatus: 500, path: "workflow.list", stack: STACK }
});
const TEXT = (v: unknown) => JSON.stringify(v);

// The server side
const hidden = maskInternalError({ shape: shapeOf("INTERNAL_SERVER_ERROR", RAW), production: true, ref: "0a1b2c3d" });
check("in production an internal error loses its message", !TEXT(hidden.shape).includes("supabase"));
check("it is replaced by the generic text with the reference", hidden.shape.message === internalErrorMessage("0a1b2c3d"));
check("the reference is handed back so it can be logged next to the real error", hidden.ref === "0a1b2c3d");
check("the stack is removed too", hidden.shape.data.stack === undefined && !TEXT(hidden.shape).includes("secret.ts"));
check(
  "the code, status and path survive",
  hidden.shape.data.code === "INTERNAL_SERVER_ERROR" &&
    hidden.shape.data.httpStatus === 500 &&
    hidden.shape.data.path === "workflow.list" &&
    hidden.shape.code === -32603
);

const generated = maskInternalError({ shape: shapeOf("INTERNAL_SERVER_ERROR", RAW), production: true });
const again = maskInternalError({ shape: shapeOf("INTERNAL_SERVER_ERROR", RAW), production: true });
check("a generated reference is 8 hex characters", /^[0-9a-f]{8}$/.test(generated.ref ?? ""));
check("two errors get different references", generated.ref !== null && generated.ref !== again.ref);

const authored = maskInternalError({
  shape: shapeOf("TOO_MANY_REQUESTS", "Monthly run limit reached (100)."),
  production: true
});
check(
  "an error we threw on purpose keeps its message and gets no reference",
  authored.shape.message === "Monthly run limit reached (100)." && authored.ref === null
);
const dev = maskInternalError({ shape: shapeOf("INTERNAL_SERVER_ERROR", RAW), production: false });
check("outside production nothing is hidden", dev.shape.message === RAW && dev.shape.data.stack === STACK && dev.ref === null);

// The screen
const clientError = (code: string | null, message: string) => ({
  message,
  data: code === null ? null : { code }
});
check("an authored message is shown", friendlyMessage(clientError("TOO_MANY_REQUESTS", "Monthly run limit reached (100).")) === "Monthly run limit reached (100).");
check("a permission message is shown", friendlyMessage(clientError("FORBIDDEN", "Requires ADMIN role or higher")) === "Requires ADMIN role or higher");
check("the masked internal message, with its reference, is shown", friendlyMessage(clientError("INTERNAL_SERVER_ERROR", internalErrorMessage("0a1b2c3d"))) === internalErrorMessage("0a1b2c3d"));
check("a raw database error that was not masked never reaches the screen", friendlyMessage(clientError("INTERNAL_SERVER_ERROR", RAW)) === GENERIC_ERROR);
check(
  "text that only looks like the masked message is not trusted",
  friendlyMessage(clientError("INTERNAL_SERVER_ERROR", "Something went wrong on our side (ref zzzzzzzz). Please try again.")) === GENERIC_ERROR &&
    friendlyMessage(clientError("INTERNAL_SERVER_ERROR", `${internalErrorMessage("0a1b2c3d")} Also: ${RAW}`)) === GENERIC_ERROR
);
check("the masked message is only trusted when the code says internal error", friendlyMessage(clientError("FORBIDDEN", internalErrorMessage("0a1b2c3d"))) === internalErrorMessage("0a1b2c3d"));
check("a validation dump (BAD_REQUEST) becomes the generic text", friendlyMessage(clientError("BAD_REQUEST", '[{"code":"too_small","path":["name"]}]')) === GENERIC_ERROR);
check("a code we do not know is generic", friendlyMessage(clientError("SOMETHING_NEW", "details nobody should see")) === GENERIC_ERROR);
check("a network failure has no code and is generic", friendlyMessage(clientError(null, "Failed to fetch")) === GENERIC_ERROR);
check("not-found with no message of its own reads naturally", friendlyMessage(clientError("NOT_FOUND", "NOT_FOUND")) === "We couldn't find that.");
check("a forbidden with no message of its own reads naturally", friendlyMessage(clientError("FORBIDDEN", "FORBIDDEN")) === "You don't have permission to do that.");
check("an empty message is generic", friendlyMessage(clientError("FORBIDDEN", "   ")) === GENERIC_ERROR);
check(
  "null, undefined, a string and a number are generic",
  [null, undefined, "boom", 42].every((value) => friendlyMessage(value) === GENERIC_ERROR)
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
