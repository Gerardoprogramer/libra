import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingAuthorsPage() {
  return (
    <main id="main-content" aria-hidden="true" className="mx-auto min-h-screen max-w-7xl px-6 py-14 md:py-20">
      <header className="max-w-3xl">
        <Skeleton className="mb-4 h-3 w-20" />
        <Skeleton className="h-14 w-full max-w-md md:h-16" />
        <Skeleton className="mt-5 h-5 w-full max-w-xl" />
      </header>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="border p-7">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="mt-3 h-4 w-24" />
            <Skeleton className="mt-8 h-4 w-20" />
          </div>
        ))}
      </div>
    </main>
  );
}
