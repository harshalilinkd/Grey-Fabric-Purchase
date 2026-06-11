import { PagePlaceholder } from "@/components/ui/PagePlaceholder";
import { NAV_BY_PATH } from "@/lib/nav";

const item = NAV_BY_PATH["/final-receipts"];

export default function FinalReceiptsPage() {
  return <PagePlaceholder title={item.label} subtitle={item.blurb} icon={item.icon} />;
}
