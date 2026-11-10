"use client";

import { useEffect } from "react";

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * In-page links on the landing page ("How it works", "Protection", "Your payout", "FAQ") glide
 * to their section instead of jumping, then mark where you arrived. The link still works without
 * JavaScript, the address bar gets the #section, focus moves to the section for keyboard and
 * screen-reader users, and people who prefer reduced motion get the plain jump.
 */
export default function AnchorScroll() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let stopUser: (() => void) | null = null;

    const arrive = (target: HTMLElement) => {
      const heading = (target.matches("h2") ? target : target.querySelector("h2")) as HTMLElement | null;
      if (heading) {
        heading.classList.remove("arrived");
        void heading.offsetWidth; // restart the animation on repeat clicks
        heading.classList.add("arrived");
        heading.addEventListener("animationend", () => heading.classList.remove("arrived"), { once: true });
      }
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    };

    const glide = (target: HTMLElement) => {
      cancelAnimationFrame(frame);
      stopUser?.();
      const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
      const start = window.scrollY;
      const end = Math.max(0, Math.min(target.getBoundingClientRect().top + start - margin, document.documentElement.scrollHeight - window.innerHeight));
      const distance = end - start;
      if (reduce.matches || Math.abs(distance) < 2) {
        window.scrollTo({ top: end, behavior: "instant" });
        return arrive(target);
      }
      // Longer trips take a little longer, within limits, so every section feels equally close.
      const duration = Math.min(1100, Math.max(450, Math.abs(distance) * 0.45));
      const t0 = performance.now();
      // A wheel, touch or key press takes over straight away.
      const cancel = () => {
        cancelAnimationFrame(frame);
        stopUser?.();
      };
      const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
      events.forEach((e) => window.addEventListener(e, cancel, { passive: true }));
      stopUser = () => {
        events.forEach((e) => window.removeEventListener(e, cancel));
        stopUser = null;
      };
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        window.scrollTo({ top: start + distance * ease(p), behavior: "instant" });
        if (p < 1) frame = requestAnimationFrame(step);
        else {
          stopUser?.();
          arrive(target);
        }
      };
      frame = requestAnimationFrame(step);
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href^='#']") as HTMLAnchorElement | null;
      const id = link?.getAttribute("href")?.slice(1);
      const target = id ? document.getElementById(decodeURIComponent(id)) : null;
      if (!link || !target || !link.closest(".landing")) return;
      e.preventDefault();
      if (location.hash !== `#${id}`) history.pushState(null, "", `#${id}`);
      glide(target);
    };

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      cancelAnimationFrame(frame);
      stopUser?.();
    };
  }, []);
  return null;
}
