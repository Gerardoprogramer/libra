export type LocaleMessageDifferenceKind =
  "missing-key" | "additional-key" | "structure-mismatch" | "placeholder-mismatch";

export interface LocaleMessageDifference {
  path: string;
  kind: LocaleMessageDifferenceKind;
}

function isMessageObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPlaceholders(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z_][\w.-]*)\s*(?:,|\})/g)].map((match) => match[1]).sort();
}

export function compareLocaleMessages(reference: unknown, translated: unknown): LocaleMessageDifference[] {
  const differences: LocaleMessageDifference[] = [];

  function compare(referenceValue: unknown, translatedValue: unknown, path: string) {
    if (isMessageObject(referenceValue) && isMessageObject(translatedValue)) {
      const referenceKeys = new Set(Object.keys(referenceValue));
      const translatedKeys = new Set(Object.keys(translatedValue));

      for (const key of [...referenceKeys].sort()) {
        const childPath = path ? `${path}.${key}` : key;

        if (!translatedKeys.has(key)) {
          differences.push({ path: childPath, kind: "missing-key" });
        } else {
          compare(referenceValue[key], translatedValue[key], childPath);
        }
      }

      for (const key of [...translatedKeys].sort()) {
        if (!referenceKeys.has(key)) {
          differences.push({ path: path ? `${path}.${key}` : key, kind: "additional-key" });
        }
      }

      return;
    }

    if (
      typeof referenceValue !== "string" ||
      typeof translatedValue !== "string" ||
      Array.isArray(referenceValue) ||
      Array.isArray(translatedValue)
    ) {
      differences.push({ path, kind: "structure-mismatch" });
      return;
    }

    if (JSON.stringify(getPlaceholders(referenceValue)) !== JSON.stringify(getPlaceholders(translatedValue))) {
      differences.push({ path, kind: "placeholder-mismatch" });
    }
  }

  compare(reference, translated, "");
  return differences.sort((first, second) => first.path.localeCompare(second.path));
}
