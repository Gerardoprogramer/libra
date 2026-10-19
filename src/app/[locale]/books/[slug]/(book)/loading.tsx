import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingBookPage() {
  return (
    <main id="main-content" className="min-h-screen">
      <section className="border-b">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-14 md:grid-cols-[280px_1fr] md:py-20">
          {/* Cover */}
          <div>
            <Skeleton className="mx-auto aspect-2/3 w-full max-w-70 rounded-lg" />
          </div>

          {/* Book information */}
          <div className="flex flex-col justify-center">
            {/* Categories */}
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-12 rounded-full" />
              <Skeleton className="h-4 w-10" />
            </div>

            {/* Title */}
            <div className="max-w-3xl space-y-3">
              <Skeleton className="h-12 w-full max-w-2xl md:h-16" />
              <Skeleton className="h-12 w-3/5 max-w-lg md:h-16" />
            </div>

            {/* Author */}
            <div className="mt-5 flex items-center gap-2">
              <Skeleton className="h-5 w-8" />
              <Skeleton className="h-5 w-36" />
            </div>

            {/* Metadata */}
            <div className="mt-7 flex flex-wrap gap-5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-4 w-28" />
            </div>

            {/* Description */}
            <div className="mt-8 max-w-2xl space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-3/4" />
            </div>

            {/* Actions */}
            <div className="mt-9 flex flex-wrap gap-3">
              <Skeleton className="h-11 w-40 rounded-md" />
              <Skeleton className="h-11 w-44 rounded-md" />
              <Skeleton className="size-11 rounded-md" />
            </div>
          </div>
        </div>
      </section>

      {/* Chapters */}
      <section className="mx-auto max-w-4xl px-6 py-14">
        <div className="mb-8 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-48" />
        </div>

        <div className="divide-y">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex items-center justify-between py-5">
              <div className="flex flex-1 items-center gap-5">
                <Skeleton className="h-4 w-8" />

                <Skeleton
                  className={
                    index % 3 === 0
                      ? "h-5 w-2/3 max-w-md"
                      : index % 3 === 1
                        ? "h-5 w-1/2 max-w-sm"
                        : "h-5 w-3/5 max-w-md"
                  }
                />
              </div>

              <Skeleton className="size-5 rounded" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
