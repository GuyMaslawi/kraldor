import {
  Skeleton,
  SkeletonHeading,
  SkeletonPage,
  SkeletonPanelTitle,
} from "@/components/ui/Skeleton";

/** Mirrors /game/titles: the worn-title header, then the two shelves. */
export default function TitlesLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading titleWidth="w-20" />

      <div className="panel-gold rounded-2xl p-5">
        <SkeletonPanelTitle width="w-28" />
        <Skeleton className="mt-3 h-8 w-32 rounded-lg" />
      </div>

      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="panel rounded-2xl p-5">
          <SkeletonPanelTitle width="w-40" />
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, j) => (
              <Skeleton key={j} className="h-24 rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </SkeletonPage>
  );
}
