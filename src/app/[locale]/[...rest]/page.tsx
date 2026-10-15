import { notFound } from "next/navigation";

// Any localized URL that matches no route lands here, so the 404 renders inside the locale layout (header,
// translated copy, <html lang>) with a real 404 status, instead of Next.js's generic English page.
export default function UnknownLocalizedPage() {
  notFound();
}
