interface SiteFooterProps {
  /** Sentence before the Project Gutenberg link. */
  sourceLabel: string;
  /** Sentence after the link: public domain status and the scope of the code license. */
  noticeLabel: string;
}

const PROJECT_GUTENBERG_URL = "https://www.gutenberg.org/";

// Global attribution: the texts come from Project Gutenberg and are public domain in the United States; the MIT
// license covers only the code (README, "Content and attribution"). Labels are passed as props, like
// ConnectionStatus, so the client messages stay limited to the namespaces the layout lists.
// data-site-footer: hidden by globals.css on the chapter page, together with the site header.
export function SiteFooter({ sourceLabel, noticeLabel }: SiteFooterProps) {
  return (
    <footer data-site-footer className="text-muted-foreground mt-16 border-t">
      <p className="mx-auto max-w-7xl px-6 py-6 text-xs leading-5">
        {sourceLabel}{" "}
        <a
          href={PROJECT_GUTENBERG_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline decoration-current/30 underline-offset-4 transition hover:decoration-current"
        >
          Project Gutenberg
        </a>
        . {noticeLabel}
      </p>
    </footer>
  );
}
