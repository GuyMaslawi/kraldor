import {
  Skeleton,
  SkeletonHeading,
  SkeletonPage,
  SkeletonPanelTitle,
  SkeletonRows,
} from "@/components/ui/Skeleton";

/** Mirrors /game/worldboss: the beast and its bar, then the damage board. */
export default function WorldBossLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading titleWidth="w-32" />

      <div className="panel-gold rounded-2xl p-6">
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="h-16 w-16 rounded-full" />
          <Skeleton className="h-6 w-40 rounded" />
          <Skeleton className="h-4 w-full max-w-xl rounded" />
        </div>
        <Skeleton className="mt-5 h-6 w-full rounded-full" />
        <div className="mt-5 flex justify-center">
          <Skeleton className="h-11 w-32 rounded-lg" />
        </div>
      </div>

      <div className="panel rounded-2xl p-5">
        <SkeletonPanelTitle width="w-24" />
        <SkeletonRows count={8} row="h-8" className="mt-4 space-y-1" />
      </div>
    </SkeletonPage>
  );
}
