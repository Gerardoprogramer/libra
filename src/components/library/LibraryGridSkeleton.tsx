import { BookCardSkeleton } from "@/components/books/BookCardSkeleton";

export function LibraryGridSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, index) => (
        <BookCardSkeleton key={index} />
      ))}
    </div>
  );
}
