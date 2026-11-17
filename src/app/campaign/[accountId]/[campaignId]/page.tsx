import { Suspense } from "react";
import CampaignView from "@/components/ads/CampaignView";

export default function CampaignPage() {
  // Параметры адреса читаются в браузере, поэтому содержимое подгружается после оболочки страницы.
  return (
    <Suspense fallback={<p className="p-6 text-sm text-ink-2">Загружаю кампанию…</p>}>
      <CampaignView />
    </Suspense>
  );
}
