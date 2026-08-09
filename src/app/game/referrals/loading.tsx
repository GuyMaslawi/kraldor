import {
  Skeleton,
  SkeletonHeading,
  SkeletonPage,
  SkeletonPanelTitle,
  SkeletonRows,
} from "@/components/ui/Skeleton";

/** Mirrors /game/referrals: the code card, the joiner card, the invitee list. */
export default function ReferralsLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading titleWidth="w-32" />

      <div className="panel-gold rounded-2xl p-5">
        <SkeletonPanelTitle width="w-28" />
        <Skeleton className="mt-3 h-10 w-56 rounded-xl" />
      </div>

      <div className="panel rounded-2xl p-5">
        <SkeletonPanelTitle width="w-32" />
        <Skeleton className="mt-3 h-10 w-full rounded-lg" />
      </div>

      <div className="panel rounded-2xl p-5">
        <SkeletonPanelTitle width="w-36" />
        <SkeletonRows count={3} row="h-14" className="mt-4 space-y-2" />
      </div>
    </SkeletonPage>
  );
}
