import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

/** Seeded pseudo-random for stable star positions between renders */
function starField(seed: number, count: number) {
  const out: { left: number; top: number; s: number; d: number }[] = [];
  let x = seed;
  for (let i = 0; i < count; i++) {
    x = (x * 9301 + 49297) % 233280;
    const r = x / 233280;
    x = (x * 9301 + 49297) % 233280;
    const r2 = x / 233280;
    x = (x * 9301 + 49297) % 233280;
    const r3 = x / 233280;
    out.push({
      left: r * 100,
      top: r2 * 100,
      s: r3 > 0.92 ? 2.2 : r3 > 0.75 ? 1.4 : 1,
      d: 3 + (i % 7) * 1.2,
    });
  }
  return out;
}

/** Light, airy cosmic wash for the dashboard shell only */
export function CosmicBackground() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const fn = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setParallax({
          x: (e.clientX / window.innerWidth - 0.5) * 28,
          y: (e.clientY / window.innerHeight - 0.5) * 22,
        });
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
    };
  }, [reduceMotion]);

  const stars = useMemo(() => starField(42, 48), []);

  const px = (m: number) => `${parallax.x * m}px`;
  const py = (m: number) => `${parallax.y * m}px`;

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_100%_80%_at_50%_-10%,rgba(129,140,248,0.22)_0%,transparent_50%),radial-gradient(ellipse_90%_60%_at_100%_30%,rgba(56,189,248,0.12)_0%,transparent_45%),#eef2ff]" />

      {!reduceMotion && (
        <>
          <div
            className="absolute will-change-transform"
            style={{ transform: `translate3d(${px(0.45)}, ${py(0.38)}, 0)` }}
          >
            <div className="-ml-[20%] mt-[10%] h-[70vh] w-[70vw] rounded-full bg-indigo-400/20 blur-[100px] motion-safe:animate-cosmic-drift-a" />
          </div>
          <div
            className="absolute will-change-transform"
            style={{ transform: `translate3d(${px(-0.35)}, ${py(-0.42)}, 0)` }}
          >
            <div className="ml-[40%] h-[55vh] w-[55vw] rounded-full bg-sky-400/15 blur-[90px] motion-safe:animate-cosmic-drift-b" />
          </div>
          <div
            className="absolute will-change-transform"
            style={{ transform: `translate3d(${px(0.28)}, ${py(-0.3)}, 0)` }}
          >
            <div className="ml-[25%] mt-[35%] h-[40vh] w-[45vw] rounded-full bg-amber-300/15 blur-[110px] motion-safe:animate-cosmic-drift-c" />
          </div>
        </>
      )}

      {reduceMotion && (
        <>
          <div className="absolute -left-[15%] top-[15%] h-[50vh] w-[50vw] rounded-full bg-indigo-300/25 blur-[90px]" />
          <div className="absolute right-0 bottom-0 h-[40vh] w-[40vw] rounded-full bg-sky-300/20 blur-[80px]" />
        </>
      )}

      <div className="absolute inset-0 opacity-45">
        {stars.map((st, i) => (
          <span
            key={i}
            className={cn(
              "absolute rounded-full bg-slate-400/80",
              !reduceMotion && "motion-safe:animate-cosmic-twinkle"
            )}
            style={{
              left: `${st.left}%`,
              top: `${st.top}%`,
              width: st.s,
              height: st.s,
              animationDelay: `${(i % 12) * 0.35}s`,
              animationDuration: `${st.d}s`,
              boxShadow: "0 0 2px rgba(255,255,255,0.9)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
