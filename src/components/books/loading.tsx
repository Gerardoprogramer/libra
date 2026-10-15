import { BookCardSkeleton } from "@/components/books/BookCardSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingBooksPage() {
  return (
    <main id="main-content" className="min-h-screen">
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-14 md:py-20">
          <Skeleton className="mb-3 h-3 w-24" />

          <Skeleton className="h-12 w-full max-w-md md:h-14" />

          <Skeleton className="mt-5 h-5 w-full max-w-xl" />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-10 md:py-14">
        {/* Search */}
        <div className="mb-8">
          <Skeleton className="h-11 w-full max-w-lg rounded-md" />
        </div>

        {/* Categories / filters */}
        <div className="mb-10 flex flex-wrap gap-2">
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-32 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>

        {/* Result count */}
        <div className="mb-8 flex items-center justify-between">
          <Skeleton className="h-4 w-28" />

          <Skeleton className="h-4 w-20" />
        </div>

        {/* Books */}
        <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, index) => (
            <BookCardSkeleton key={index} />
          ))}
        </div>
      </section>
    </main>
  );
}
