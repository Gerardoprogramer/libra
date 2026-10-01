import { isPublicCopyrightStatus, type PublicCopyrightStatus } from "../../src/lib/editorial-status";

export type EditionReviewAction = "show" | "publish" | "reject" | "archive" | "prefer";

export interface EditionReviewArguments {
  sourceName: string;
  sourceIdentifier: string;
  notes?: string;
  action: EditionReviewAction;
  copyrightStatus?: PublicCopyrightStatus;
}

const actionFlags = new Map<string, Exclude<EditionReviewAction, "show">>([
  ["--publish", "publish"],
  ["--reject", "reject"],
  ["--archive", "archive"],
  ["--prefer", "prefer"],
]);

export function parseEditionReviewArguments(args: readonly string[]): EditionReviewArguments {
  let gutenbergId: string | undefined;
  let sourceName: string | undefined;
  let sourceIdentifier: string | undefined;
  let copyrightStatus: PublicCopyrightStatus | undefined;
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

    if (argument === "--source-name") {
      const value = args[++index];
      if (sourceName !== undefined || !value || value.startsWith("--")) {
        throw new Error("Expected one --source-name value.");
      }
      sourceName = value;
      continue;
    }

    if (argument === "--source-identifier") {
      const value = args[++index];
      if (sourceIdentifier !== undefined || !value || value.startsWith("--")) {
        throw new Error("Expected one --source-identifier value.");
      }
      sourceIdentifier = value;
      continue;
    }

    if (argument === "--copyright-status") {
      const value = args[++index];
      if (copyrightStatus !== undefined || !value || value.startsWith("--")) {
        throw new Error("Expected one --copyright-status value.");
      }
      if (!isPublicCopyrightStatus(value)) {
        throw new Error("Publishable copyright status must be PUBLIC_DOMAIN_VERIFIED, LICENSED or ORIGINAL.");
      }
      copyrightStatus = value;
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

  if (gutenbergId && (sourceName || sourceIdentifier)) {
    throw new Error("Use --gutenberg-id or the --source-name/--source-identifier pair, not both.");
  }

  if (!gutenbergId && (!sourceName || !sourceIdentifier)) {
    throw new Error("Specify --gutenberg-id or both --source-name and --source-identifier.");
  }

  if (actions.length > 1) {
    throw new Error("Only one action may be specified: --publish, --reject, --archive or --prefer.");
  }

  const action = actions[0] ?? "show";

  if (action === "publish" && !copyrightStatus) {
    throw new Error("--publish requires an explicit --copyright-status.");
  }

  if (action !== "publish" && copyrightStatus) {
    throw new Error("--copyright-status may only be used with --publish.");
  }

  const resolvedSourceName = gutenbergId !== undefined ? "Project Gutenberg" : sourceName;
  const resolvedSourceIdentifier = gutenbergId ?? sourceIdentifier;

  if (!resolvedSourceName || !resolvedSourceIdentifier) {
    throw new Error("Specify --gutenberg-id or both --source-name and --source-identifier.");
  }

  return {
    sourceName: resolvedSourceName,
    sourceIdentifier: resolvedSourceIdentifier,
    notes,
    action,
    copyrightStatus,
  };
}
