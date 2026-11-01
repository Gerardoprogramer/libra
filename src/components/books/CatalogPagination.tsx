import { FiChevronLeft, FiChevronRight } from "react-icons/fi";

import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { getCatalogPath } from "@/lib/catalog-filters";
import { cn } from "@/lib/utils";

export interface CatalogPaginationLabels {
  navigation: string;
  previous: string;
  next: string;
  previousPage: string;
  nextPage: string;
  goToPage: (page: number) => string;
  currentPage: (page: number) => string;
  pageOf: (page: number, totalPages: number) => string;
}

interface CatalogPaginationProps {
  page: number;
  totalPages: number;
  category?: string;
  query?: string;
  labels: CatalogPaginationLabels;
}

/**
 * The page numbers to show: the first, the last and the neighbours of the current one, with an ellipsis for each gap.
 * A gap of a single page shows that page instead, since an ellipsis would take the same room.
 */
export function getPaginationItems(page: number, totalPages: number): (number | "ellipsis")[] {
  const pages = [1, page - 1, page, page + 1, totalPages]
    .filter((item) => item >= 1 && item <= totalPages)
    .filter((item, index, list) => list.indexOf(item) === index)
    .sort((first, second) => first - second);

  return pages.flatMap((item, index) => {
    const previous = pages[index - 1];

    if (previous === undefined || item - previous === 1) return [item];
    if (item - previous === 2) return [previous + 1, item];

    return ["ellipsis" as const, item];
  });
}

/**
 * Links between catalog pages. Every page is a real link that keeps the category and search, so crawlers can walk the
 * whole listing. The current page and the unavailable ends are plain text, never links. On narrow screens only the
 * previous and next links remain, with the position as text.
 */
export function CatalogPagination({ page, totalPages, category, query, labels }: CatalogPaginationProps) {
  if (totalPages <= 1) return null;

  const href = (target: number) => getCatalogPath({ category, query, page: target });
  const unavailable = cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50");

  return (
    <nav aria-label={labels.navigation} className="mt-12 flex items-center justify-between gap-3 border-t pt-6">
      {page > 1 ? (
        <Button variant="outline" size="sm" asChild>
          <Link href={href(page - 1)} aria-label={labels.previousPage} rel="prev">
            <FiChevronLeft aria-hidden="true" />
            {labels.previous}
          </Link>
        </Button>
      ) : (
        <span aria-disabled="true" className={unavailable}>
          <FiChevronLeft aria-hidden="true" />
          {labels.previous}
        </span>
      )}

      <p className="text-muted-foreground text-sm sm:hidden">{labels.pageOf(page, totalPages)}</p>

      <ul className="hidden items-center gap-1 sm:flex">
        {getPaginationItems(page, totalPages).map((item, index) => (
          <li key={item === "ellipsis" ? `ellipsis-${index}` : item}>
            {item === "ellipsis" ? (
              <span aria-hidden="true" className="text-muted-foreground px-2 text-sm">
                …
              </span>
            ) : item === page ? (
              <span
                aria-current="page"
                aria-label={labels.currentPage(item)}
                className={buttonVariants({ variant: "default", size: "icon-sm" })}
              >
                {item}
              </span>
            ) : (
              <Button variant="ghost" size="icon-sm" asChild>
                <Link href={href(item)} aria-label={labels.goToPage(item)}>
                  {item}
                </Link>
              </Button>
            )}
          </li>
        ))}
      </ul>

      {page < totalPages ? (
        <Button variant="outline" size="sm" asChild>
          <Link href={href(page + 1)} aria-label={labels.nextPage} rel="next">
            {labels.next}
            <FiChevronRight aria-hidden="true" />
          </Link>
        </Button>
      ) : (
        <span aria-disabled="true" className={unavailable}>
          {labels.next}
          <FiChevronRight aria-hidden="true" />
        </span>
      )}
    </nav>
  );
}
