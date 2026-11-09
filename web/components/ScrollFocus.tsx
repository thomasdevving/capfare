"use client";

import { useEffect } from "react";

/** A short focus transition as new content enters the viewport. Content stays
 * visible without JavaScript, and reduced-motion users see no blur. */
export default function ScrollFocus() {
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches || !("IntersectionObserver" in window)) return;
    const animations = new Set<Animation>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const animation = entry.target.animate(
          [{ filter: "blur(5px)", opacity: 0.72, transform: "translateY(12px)" },
           { filter: "blur(0px)", opacity: 1, transform: "translateY(0)" }],
          { duration: 650, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
        );
        animations.add(animation);
        animation.finished.then(() => animations.delete(animation)).catch(() => {});
      }
    }, { rootMargin: "0px 0px -32px 0px", threshold: 0.08 });
    document.querySelectorAll(".landing-content .feature-panel, .landing-content .section > .panel").forEach((element) => {
      if (element.getBoundingClientRect().top >= window.innerHeight) observer.observe(element);
    });
    const stop = () => {
      if (!preference.matches) return;
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
    };
    preference.addEventListener("change", stop);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", stop);
      animations.forEach((animation) => animation.cancel());
    };
  }, []);
  return null;
}
