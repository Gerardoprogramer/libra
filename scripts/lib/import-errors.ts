// Log useful causes without dumping query parameters, driver objects or credentials.
export function formatImportError(error: unknown): string {
  let cause = error;
  const seen = new Set<Error>();

  while (cause instanceof Error && cause.cause instanceof Error && !seen.has(cause)) {
    seen.add(cause);
    cause = cause.cause;
  }

  let message = cause instanceof Error ? `${cause.name}: ${cause.message}` : "Unknown import error";

  if (cause instanceof Error && "code" in cause && typeof cause.code === "string") {
    message = `[${cause.code}] ${message}`;
  }

  const secrets = new Set<string>();

  for (const [name, value] of Object.entries(process.env)) {
    if (value && /SECRET|TOKEN|PASSWORD|DATABASE_URL|ACCESS_KEY/i.test(name)) {
      secrets.add(value);

      if (/DATABASE_URL/i.test(name)) {
        try {
          const url = new URL(value);
          if (url.password) {
            secrets.add(url.password);
            secrets.add(decodeURIComponent(url.password));
          }
        } catch {
          // Invalid connection strings are still redacted as a whole.
        }
      }
    }
  }

  for (const secret of [...secrets].sort((first, second) => second.length - first.length)) {
    message = message.split(secret).join("[redacted]");
  }

  return message;
}
