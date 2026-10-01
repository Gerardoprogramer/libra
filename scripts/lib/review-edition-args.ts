export type EditionReviewAction = "show" | "publish" | "reject" | "archive";

export interface EditionReviewArguments {
  gutenbergId: string;
  notes?: string;
  action: EditionReviewAction;
}

const actionFlags = new Map<string, Exclude<EditionReviewAction, "show">>([
  ["--publish", "publish"],
  ["--reject", "reject"],
  ["--archive", "archive"],
]);

export function parseEditionReviewArguments(args: readonly string[]): EditionReviewArguments {
  let gutenbergId: string | undefined;
  let notes: string | undefined;
  let hasNotes = false;
  const actions: EditionReviewAction[] = [];

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];

    if (argument === "--gutenberg-id") {
      const value = args[++index];
      if (gutenbergId !== undefined || !value || value.startsWith("--")) {
        throw new Error("Expected one --gutenberg-id value.");
      }
      gutenbergId = value;
      continue;
    }

    if (argument === "--notes") {
      const value = args[++index];
      if (hasNotes || value === undefined || value.startsWith("--")) {
        throw new Error("Expected at most one --notes value.");
      }
      hasNotes = true;
      notes = value;
      continue;
    }

    const action = actionFlags.get(argument);
    if (action) {
      actions.push(action);
      continue;
    }

    throw new Error(`Unknown edition review argument: ${argument}`);
  }

  if (!gutenbergId) {
    throw new Error("Missing --gutenberg-id argument.");
  }

  if (actions.length > 1) {
    throw new Error("Only one action may be specified: --publish, --reject or --archive.");
  }

  return {
    gutenbergId,
    notes,
    action: actions[0] ?? "show",
  };
}
