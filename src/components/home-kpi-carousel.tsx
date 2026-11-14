"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function HomeKpiCarousel({ children, currency }: { children: ReactNode; currency: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const el = containerRef.current?.querySelector<HTMLElement>(".ui-kpis");
    if (!el) return;

    const onScroll = () => {
      const scrollLeft = el.scrollLeft;
      const cardWidth = el.clientWidth;
      if (cardWidth <= 0) return;
      const index = Math.round(scrollLeft / cardWidth);
      setActiveIndex(Math.max(0, Math.min(3, index)));
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (index: number) => {
    const el = containerRef.current?.querySelector<HTMLElement>(".ui-kpis");
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
    setActiveIndex(index);
  };

  return (
    <div className="home-kpi-carousel-wrap" ref={containerRef}>
      {children}
      <div className="home-kpi-pagination" role="group" aria-label={`Pilih KPI ${currency}`}>
        {[0, 1, 2, 3].map((pos) => (
          <button
            type="button"
            key={pos}
            className="home-kpi-dot"
            aria-label={`KPI ${pos + 1} dari 4`}
            aria-current={pos === activeIndex ? "true" : undefined}
            onClick={() => scrollTo(pos)}
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
