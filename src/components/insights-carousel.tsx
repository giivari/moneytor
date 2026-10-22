"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { carouselPosition } from "@/lib/analytics/visuals";
import { useInsightsViewport } from "./use-insights-viewport";

export type InsightsSlideSelection = { index: number; select: (index: number) => void };
export function InsightsCarousel({ children, selection }: { children: ReactNode[]; selection: InsightsSlideSelection }) {
  const track = useRef<HTMLDivElement>(null), fromSwipe = useRef(false);
  const mobile = useInsightsViewport();
  const index = Math.max(0, Math.min(children.length - 1, selection.index));
  useLayoutEffect(() => {
    const element = track.current;
    if (!element) return;
    const slide = element.children[index] as HTMLElement | undefined;
    const fitHeight = () => {
      if (!mobile) { element.style.height = ""; return; }
      if (slide && slide.offsetHeight > 0) {
        const height = `${slide.offsetHeight + 8}px`;
        if (element.style.height !== height) element.style.height = height;
      }
    };
    const reveal = () => {
      if (!mobile || element.scrollWidth <= element.clientWidth) return;
      if (slide) element.scrollLeft = slide.offsetLeft - element.offsetLeft;
    };
    fitHeight();
    if (!fromSwipe.current) reveal();
    fromSwipe.current = false;
    let previousWidth = element.clientWidth;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      fitHeight();
      if (element.clientWidth === previousWidth) return;
      previousWidth = element.clientWidth; reveal();
    });
    observer?.observe(element);
    if (slide) observer?.observe(slide);
    return () => observer?.disconnect();
  }, [index, mobile]);
  return <div className="insight-visual-workspace">
    <div className="insight-carousel-controls" role="group" aria-label="Navigasi analisis">
      <span aria-live="polite">{index + 1} dari {children.length}</span>
      <div className="insight-carousel-pagination" role="group" aria-label="Pilih analisis">{children.map((_, position) => <button type="button" key={position} aria-label={`Analisis ${position + 1} dari ${children.length}`} aria-current={position === index ? "true" : undefined} onClick={() => selection.select(position)}><span aria-hidden="true" /></button>)}</div>
      <div><button type="button" aria-label="Analisis sebelumnya" aria-disabled={index === 0} onClick={() => { if (index > 0) selection.select(index - 1); }}><ArrowLeft size={18} /></button>
        <button type="button" aria-label="Analisis berikutnya" aria-disabled={index === children.length - 1} onClick={() => { if (index < children.length - 1) selection.select(index + 1); }}><ArrowRight size={18} /></button></div>
    </div>
    <div className="insight-carousel-viewport">
    <div ref={track} className="insight-carousel-track" role="region" aria-label="Tiga analisis keuangan" tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault(); selection.select(Math.max(0, Math.min(children.length - 1, index + (event.key === "ArrowRight" ? 1 : -1))));
        }
      }} onScroll={(event) => {
        const element = event.currentTarget;
        if (element.scrollWidth <= element.clientWidth) return;
        const next = carouselPosition(element.scrollLeft, Array.from(element.children, (child) => (child as HTMLElement).offsetLeft - element.offsetLeft));
        if (next !== index) { fromSwipe.current = true; selection.select(next); }
      }}>
      {children.map((child, position) => <section className="surface insight-panel insight-slide" key={position} role="group" aria-label={`${position + 1} dari ${children.length}`} aria-current={position === index ? "true" : undefined} inert={mobile && position !== index}
        onFocusCapture={() => { if (track.current && track.current.scrollWidth > track.current.clientWidth && position !== index) selection.select(position); }}>{child}</section>)}
    </div>
    </div>
  </div>;
}
