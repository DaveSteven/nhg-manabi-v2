import { useEffect, useState } from "react";

/**
 * True once the page has scrolled more than `threshold` px — i.e. a
 * position:sticky header sitting at the top is now "stuck" over content.
 * Passive scroll listener, state only flips when the boolean changes.
 */
export function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [threshold]);

  return scrolled;
}
