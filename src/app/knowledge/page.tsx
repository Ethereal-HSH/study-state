import { readCatalog } from "@/server/catalog";
import { CatalogView } from "@/features/knowledge/catalog-view";
export const dynamic = "force-dynamic";
export default function KnowledgePage() {
  return <CatalogView catalog={readCatalog()} />;
}
