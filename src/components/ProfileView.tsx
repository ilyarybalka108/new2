import type { ApiResult } from "@/lib/types";

const DOMAIN_RU: Record<string, string> = { music: "музыка", film: "кино", book: "книги" };

export default function ProfileView({ profile }: { profile: ApiResult["profile"] }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-6">
      <h2 className="font-serif text-2xl">Портрет вкуса</h2>
      <p className="mt-3 text-[15px] leading-relaxed text-fg/90">{profile.summary}</p>

      {profile.translations?.length ? (
        <div className="mt-6">
          <h3 className="text-xs uppercase tracking-wide text-muted">Карта переводов вкуса</h3>
          <ul className="mt-2 grid gap-3 md:grid-cols-2">
            {profile.translations.map((t) => (
              <li key={`${t.from}-${t.to}`} className="rounded-xl border border-accent-2/30 bg-accent-2/10 p-4">
                <div className="text-sm font-medium text-accent-2">
                  {DOMAIN_RU[t.from]} <span className="text-muted">→</span> {DOMAIN_RU[t.to]}
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-fg/90">{t.statement}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-xs uppercase tracking-wide text-muted">Оси</h3>
          <ul className="mt-2 space-y-3">
            {profile.axes.map((a) => (
              <li key={a.name}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{a.name}</span>
                  <span className="font-mono text-xs text-muted">{a.value}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-panel-2">
                  <div className="h-full rounded bg-accent" style={{ width: `${a.value}%` }} />
                </div>
                <div className="mt-1 text-xs text-muted">{a.note}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-5">
          <div>
            <h3 className="text-xs uppercase tracking-wide text-muted">Опоры</h3>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {profile.anchors.map((x) => (
                <li key={x} className="rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-xs text-accent">
                  {x}
                </li>
              ))}
            </ul>
          </div>
          {profile.blind_spots.length ? (
            <div>
              <h3 className="text-xs uppercase tracking-wide text-muted">Слепые зоны</h3>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {profile.blind_spots.map((x) => (
                  <li key={x} className="rounded-md border border-line bg-panel-2 px-2 py-1 text-xs text-fg/80">
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
