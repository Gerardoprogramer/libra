import { Skeleton } from "@/components/ui/skeleton";

export function BookCardSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="aspect-2/3 w-full rounded-lg" />

      <div className="space-y-2">
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-4 w-2/3" />

        <div className="flex items-center gap-2 pt-1">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-12" />
        </div>
      </div>
    </div>
  );
}
