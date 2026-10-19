import { ReaderPending } from "@/components/reader/ReaderPending";
import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingReaderPage() {
  return (
    // ReaderPending: the site header is hidden from the start (globals.css), as it is once the reader renders, and
    // the placeholder takes the stored reader theme's tokens.
    <ReaderPending className="bg-background text-foreground min-h-screen">
      {/* Reader toolbar */}
      <header className="bg-background/95 sticky top-0 z-20 border-b border-current/10 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-6">
          <div className="flex min-w-0 items-center gap-4">
            <Skeleton className="size-9 rounded-md" />

            <div className="hidden min-w-0 space-y-1.5 sm:block">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-4 w-44" />
            </div>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>

          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="size-9 rounded-md" />
          </div>
        </div>
      </header>

      {/* Progress */}
      <div className="h-px w-full bg-current/10">
        <div className="h-px w-1/4 animate-pulse bg-current/30" />
      </div>

      {/* Reading area */}
      <article className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <header className="mb-14 text-center">
          <Skeleton className="mx-auto h-3 w-24" />

          <div className="mt-6 space-y-3">
            <Skeleton className="mx-auto h-10 w-full max-w-xl" />
            <Skeleton className="mx-auto h-10 w-3/5 max-w-sm" />
          </div>
        </header>

        <div className="space-y-8">
          {["100%", "96%", "88%", "98%", "82%", "94%", "90%", "97%", "85%", "93%"].map((width, index) => (
            <div key={index} className="space-y-3">
              <Skeleton className="h-4" style={{ width }} />

              <Skeleton className="h-4 w-full" />

              {index % 3 !== 2 && <Skeleton className="h-4 w-4/5" />}
            </div>
          ))}
        </div>
      </article>

      {/* Bottom navigation */}
      <footer className="border-t border-current/10">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-8">
          <Skeleton className="h-10 w-32 rounded-md" />

          <Skeleton className="h-4 w-20" />

          <Skeleton className="h-10 w-32 rounded-md" />
        </div>
      </footer>
    </ReaderPending>
  );
}
