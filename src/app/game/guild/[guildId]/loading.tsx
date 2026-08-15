import {
  Skeleton,
  SkeletonHeading,
  SkeletonPage,
  SkeletonPanelTitle,
} from "@/components/ui/Skeleton";

/**
 * Mirrors /game/guild/[guildId] — the hall, the three-pill stat row and the
 * roster. Its own file rather than the parent's skeleton, which draws the two
 * shop grids this screen does not have: a dossier that flashed a treasury and
 * a spell shop before settling would be promising a rival's screen it is not
 * allowed to show.
 */
export default function GuildDossierLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading titleWidth="w-48" />

      {/* the hall */}
      <Skeleton className="h-44 rounded-2xl" />

      {/* members / aid / founded */}
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-7 w-28 rounded-full" />
        <Skeleton className="h-7 w-32 rounded-full" />
        <Skeleton className="h-7 w-40 rounded-full" />
      </div>

      {/* the roster */}
      <div className="panel rounded-xl p-4">
        <SkeletonPanelTitle width="w-32" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-11 rounded-lg" />
          ))}
        </div>
      </div>

      {/* how one gets in */}
      <div className="panel rounded-xl p-4">
        <Skeleton className="h-4 w-2/3 rounded" />
        <Skeleton className="mt-3 h-9 w-full rounded-lg" />
      </div>
    </SkeletonPage>
  );
}
