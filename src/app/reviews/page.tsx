import { ReviewWorkspace } from "@/features/reviews/review-workspace";
import { reviewWorkspaceData } from "@/server/review-data";
export const dynamic = "force-dynamic";
export default function Reviews() {
  return <ReviewWorkspace {...reviewWorkspaceData()} />;
}
