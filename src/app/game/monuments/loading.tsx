import {
  Skeleton,
  SkeletonHeading,
  SkeletonPage,
  SkeletonPanelTitle,
} from "@/components/ui/Skeleton";

/** Mirrors /game/monuments: the header panel, then a card per monument. */
export default function MonumentsLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading titleWidth="w-28" />

      <div className="panel-gold rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <SkeletonPanelTitle width="w-44" />
          <Skeleton className="h-10 w-16 rounded" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-56 rounded-2xl" />
        ))}
      </div>
    </SkeletonPage>
  );
}
