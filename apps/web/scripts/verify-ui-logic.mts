import { formatDuration, formatRelative } from "../lib/format";
import { pollDelay, youngestActiveAge } from "../lib/polling";
import { stepDisplayStatus } from "../lib/step-status";
import {
  draftToInput,
  moveStep,
  newStep,
  validateDraft,
  workflowToDraft,
  type Draft,
  type DraftStep
} from "../lib/workflow-draft";
import { createChecker } from "./lib";

const { check, finish } = createChecker();

// step display status
check(
  "a PENDING step in a FAILED run shows as SKIPPED",
  stepDisplayStatus("FAILED", "PENDING") === "SKIPPED"
);
check(
  "a COMPLETED step in a FAILED run stays COMPLETED",
  stepDisplayStatus("FAILED", "COMPLETED") === "COMPLETED"
);
check(
  "the FAILED step itself stays FAILED",
  stepDisplayStatus("FAILED", "FAILED") === "FAILED"
);
check(
  "a PENDING step in a RUNNING run is still queued",
  stepDisplayStatus("RUNNING", "PENDING") === "PENDING"
);
check(
  "a PENDING step in a PENDING run is still queued",
  stepDisplayStatus("PENDING", "PENDING") === "PENDING"
);
check(
  "a RUNNING approval step shows as waiting for approval",
  stepDisplayStatus("RUNNING", "RUNNING", "MANUAL_APPROVAL") === "AWAITING_APPROVAL"
);
check(
  "a RUNNING wait step is still just running",
  stepDisplayStatus("RUNNING", "RUNNING", "WAIT") === "RUNNING"
);
check(
  "a COMPLETED approval step stays COMPLETED",
  stepDisplayStatus("RUNNING", "COMPLETED", "MANUAL_APPROVAL") === "COMPLETED"
);
check(
  "an approval step that never started in a FAILED run is skipped, not waiting",
  stepDisplayStatus("FAILED", "PENDING", "MANUAL_APPROVAL") === "SKIPPED"
);

// formatting
check("duration: 0 ms", formatDuration(0) === "0 ms");
check("duration: 999 ms", formatDuration(999) === "999 ms");
check("duration: 1000 ms is 1.0 s", formatDuration(1000) === "1.0 s");
check("duration: 9960 ms rounds to 10 s", formatDuration(9960) === "10 s");
check("duration: 59.6 s rolls over to minutes", formatDuration(59_600) === "1 m 0 s");
check("duration: 61 s", formatDuration(61_000) === "1 m 1 s");

const now = Date.UTC(2026, 9, 20, 12, 0, 0);
check("relative: 10 s ago is just now", formatRelative(new Date(now - 10_000), now) === "just now");
check("relative: 5 minutes", formatRelative(new Date(now - 5 * 60_000), now) === "5 minutes ago");
check("relative: 3 hours", formatRelative(new Date(now - 3 * 3_600_000), now) === "3 hours ago");
check("relative: 2 days", formatRelative(new Date(now - 2 * 86_400_000), now) === "2 days ago");

// polling
check("poll: nothing in flight means no polling", pollDelay(null) === false);
check("poll: young run polls every 1.5 s", pollDelay(0) === 1500 && pollDelay(29_999) === 1500);
check("poll: 30 s old run polls every 3 s", pollDelay(30_000) === 3000);
check("poll: 2 minute old run polls every 5 s", pollDelay(120_000) === 5000);
check("poll: 10 minute old run polls every 10 s", pollDelay(600_000) === 10_000);
check("poll: age of an empty list is null", youngestActiveAge([], now) === null);
check(
  "poll: finished runs do not count",
  youngestActiveAge([{ status: "COMPLETED", createdAt: new Date(now - 1000) }], now) === null
);
check(
  "poll: youngest ACTIVE run decides",
  youngestActiveAge(
    [
      { status: "RUNNING", createdAt: new Date(now - 5000) },
      { status: "PENDING", createdAt: new Date(now - 60_000) },
      { status: "COMPLETED", createdAt: new Date(now - 1000) }
    ],
    now
  ) === 5000
);

// workflow draft
const wait = (seconds: string, key = "w"): DraftStep => ({ key, type: "WAIT", name: "Pause", seconds });
const http = (over: Partial<Extract<DraftStep, { type: "HTTP_REQUEST" }>> = {}): DraftStep => ({
  key: "h",
  type: "HTTP_REQUEST",
  name: "Ping",
  method: "GET",
  url: "https://example.com/health",
  body: "",
  ...over
});
const draftOf = (steps: DraftStep[], name = "My workflow"): Draft => ({ name, steps });
const errorsOf = (draft: Draft) => {
  const result = validateDraft(draft);
  return result.ok ? {} : result.errors;
};

const good = validateDraft(draftOf([http(), wait("30")]));
check(
  "valid draft passes and seconds become a number",
  good.ok && good.input.definition.steps[1]?.type === "WAIT" &&
    (good.input.definition.steps[1] as { seconds: number }).seconds === 30
);
check(
  "a body typed before switching to GET is dropped",
  !("body" in draftToInput(draftOf([http({ body: "{}" })])).definition.steps[0]!)
);
check(
  "a POST keeps its body",
  (draftToInput(draftOf([http({ method: "POST", body: '{"a":1}' })])).definition.steps[0] as { body?: string }).body === '{"a":1}'
);
check("empty name: Required", errorsOf(draftOf([wait("5")], "  ")).name === "Required");
check("empty seconds asks for a number", errorsOf(draftOf([wait("")]))["steps.0.seconds"] === "Enter a number of seconds");
check("non-numeric seconds asks for a number", errorsOf(draftOf([wait("abc")]))["steps.0.seconds"] === "Enter a number of seconds");
check("0 seconds is too small", errorsOf(draftOf([wait("0")]))["steps.0.seconds"] === "Must be at least 1 second");
check("more than 7 days is too big", errorsOf(draftOf([wait("604801")]))["steps.0.seconds"] === "Must be 7 days (604800 seconds) or less");
check(
  "a malformed URL gets a helpful message",
  errorsOf(draftOf([http({ url: "nope" })]))["steps.0.url"]?.startsWith("Enter a full URL") === true
);
check(
  "http:// is rejected (https only)",
  errorsOf(draftOf([http({ url: "http://example.com" })]))["steps.0.url"] === "Only https:// URLs are allowed"
);
check("no steps: list-level error", errorsOf(draftOf([]))["steps"] === "Add at least one step");
check(
  "21 steps: list-level error",
  errorsOf(draftOf(Array.from({ length: 21 }, (_, i) => newStep("WAIT", `k${i}`))))["steps"] ===
    "A workflow can have at most 20 steps"
);

const roundTripDraft = draftOf([http({ method: "POST", body: '{"a":1}' }), wait("90")]);
const validated = validateDraft(roundTripDraft);
const back = validated.ok
  ? workflowToDraft({ name: "My workflow", definition: validated.input.definition }, () => "k")
  : null;
const normalize = (d: Draft | null) =>
  JSON.stringify(d && { ...d, steps: d.steps.map((s) => ({ ...s, key: "k" })) });
check("draft -> definition -> draft round trip is lossless", normalize(back) === normalize(roundTripDraft));
function checkApprovalSteps() {
  let n = 0;
  const nextKey = () => "k" + String(++n);
  const signOff: Draft = {
    name: "Sign-off flow",
    steps: [
      {
        key: "approval-1",
        type: "MANUAL_APPROVAL",
        name: "Manager sign-off",
        instructions: "Check the numbers"
      }
    ]
  };

  const fresh = newStep("MANUAL_APPROVAL", "x");
  check(
    "a new approval step starts with a name and no instructions",
    fresh.type === "MANUAL_APPROVAL" && fresh.name.length > 0 && fresh.instructions === ""
  );

  const valid = validateDraft(signOff);
  const validStep = valid.ok ? valid.input.definition.steps[0] : undefined;
  check(
    "a valid approval step passes and keeps its instructions",
    validStep?.type === "MANUAL_APPROVAL" && validStep.instructions === "Check the numbers"
  );

  const blank = validateDraft({
    ...signOff,
    steps: [{ key: "a", type: "MANUAL_APPROVAL", name: "Sign off", instructions: "   " }]
  });
  const blankStep = blank.ok ? blank.input.definition.steps[0] : undefined;
  check(
    "blank instructions are left out instead of sent as empty text",
    blankStep?.type === "MANUAL_APPROVAL" && blankStep.instructions === undefined
  );

  const noName = validateDraft({
    ...signOff,
    steps: [{ key: "a", type: "MANUAL_APPROVAL", name: "  ", instructions: "" }]
  });
  check(
    "an approval step needs a name",
    !noName.ok && noName.errors["steps.0.name"] === "Required"
  );

  const tooLong = validateDraft({
    ...signOff,
    steps: [
      { key: "a", type: "MANUAL_APPROVAL", name: "Sign off", instructions: "x".repeat(1001) }
    ]
  });
  check(
    "instructions over 1000 characters are rejected",
    !tooLong.ok && tooLong.errors["steps.0.instructions"] === "Too long"
  );

  const back = valid.ok
    ? workflowToDraft({ name: valid.input.name, definition: valid.input.definition }, nextKey)
    : null;
  const backStep = back?.steps[0];
  check(
    "an approval workflow can be edited: it round-trips through the draft",
    backStep?.type === "MANUAL_APPROVAL" &&
      backStep.name === "Manager sign-off" &&
      backStep.instructions === "Check the numbers"
  );

  const bare = workflowToDraft(
    { name: "x", definition: { steps: [{ type: "MANUAL_APPROVAL", name: "Sign off" }] } },
    nextKey
  );
  const bareStep = bare?.steps[0];
  check(
    "a stored approval step without instructions opens with an empty field",
    bareStep?.type === "MANUAL_APPROVAL" && bareStep.instructions === ""
  );
}
checkApprovalSteps();
check("an invalid stored definition is non-editable", workflowToDraft({ name: "x", definition: { steps: [] } }, () => "k") === null);

check("moveStep: swaps forward", JSON.stringify(moveStep([1, 2, 3], 0, 1)) === "[2,1,3]");
check("moveStep: out of range changes nothing", JSON.stringify(moveStep([1, 2, 3], 0, -1)) === "[1,2,3]");
check("moveStep: same index changes nothing", JSON.stringify(moveStep([1, 2, 3], 1, 1)) === "[1,2,3]");

finish();
