import {
  Skeleton,
  SkeletonHeading,
  SkeletonPage,
  SkeletonPanelTitle,
  SkeletonRows,
} from "@/components/ui/Skeleton";

/** Mirrors /game/daily: the muster roll, the contract, then two mission panels. */
export default function DailyLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading titleWidth="w-24" />

      {/* the muster roll: header row, the seven-day cycle, the sign button */}
      <div className="panel-gold rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <SkeletonPanelTitle width="w-32" />
          <div className="flex gap-4">
            <Skeleton className="h-10 w-10 rounded" />
            <Skeleton className="h-10 w-10 rounded" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
        <Skeleton className="mt-4 h-10 w-40 rounded-lg" />
      </div>

      {/* the guild contract */}
      <Skeleton className="h-40 rounded-2xl" />

      {/* the two mission boards */}
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="panel rounded-2xl p-5">
          <SkeletonPanelTitle width="w-28" />
          <SkeletonRows count={3} row="h-24" className="mt-4 space-y-2" />
        </div>
      ))}
    </SkeletonPage>
  );
}
