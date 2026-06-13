import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton shown while a lazy route chunk loads. Mirrors a typical page grid. */
export function RouteFallback() {
  return (
    <div className="animate-fade-up">
      <Skeleton className="mb-lg h-9 w-64" />
      <div className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
      <div className="mt-md grid grid-cols-1 gap-md lg:grid-cols-3">
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}
