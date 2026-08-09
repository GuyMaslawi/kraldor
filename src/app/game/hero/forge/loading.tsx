import {
  Skeleton,
  SkeletonHeading,
  SkeletonPage,
  SkeletonPanelTitle,
} from "@/components/ui/Skeleton";

/** Mirrors /game/hero/forge: the pouch, the commission bench, the temper list. */
export default function ForgeLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading titleWidth="w-24" />

      <div className="panel-gold rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <SkeletonPanelTitle width="w-36" />
          <Skeleton className="h-11 w-32 rounded-xl" />
        </div>
        <div className="mt-4 flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-24 rounded-lg" />
          ))}
        </div>
      </div>

      <div className="panel rounded-2xl p-5">
        <SkeletonPanelTitle width="w-28" />
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <Skeleton className="mt-4 h-10 w-44 rounded-lg" />
      </div>

      <div className="panel rounded-2xl p-5">
        <SkeletonPanelTitle width="w-20" />
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}
