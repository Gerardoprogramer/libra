import { BookCardSkeleton } from "@/components/books/BookCardSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingAuthorPage() {
  return (
    <main className="min-h-screen">
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-14 md:py-20">
          <Skeleton className="mb-4 h-3 w-16" />

          <Skeleton className="h-14 w-full max-w-xl md:h-16" />

          <Skeleton className="mt-5 h-5 w-28" />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-14">
        <div className="mb-10 flex items-end justify-between">
          <div className="space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-32" />
          </div>

          <Skeleton className="h-4 w-14" />
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <BookCardSkeleton key={index} />
          ))}
        </div>
      </section>
    </main>
  );
}
