import {
  Skeleton,
  SkeletonHeading,
  SkeletonPage,
  SkeletonPanelTitle,
  SkeletonRows,
} from "@/components/ui/Skeleton";

/** Mirrors /game/arena: the card header, then the table. */
export default function ArenaLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading titleWidth="w-20" />

      <div className="panel-gold rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <SkeletonPanelTitle width="w-36" />
          <Skeleton className="h-10 w-16 rounded" />
        </div>
        <Skeleton className="mt-4 h-10 w-44 rounded-lg" />
      </div>

      <div className="panel rounded-2xl p-5">
        <SkeletonPanelTitle width="w-24" />
        <SkeletonRows count={8} row="h-8" className="mt-4 space-y-1" />
      </div>
    </SkeletonPage>
  );
}
