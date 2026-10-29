"use client";

import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FiChevronDown } from "react-icons/fi";

interface SynopsisTextProps {
  text: string;
  lang: string;
  moreLabel: string;
  lessLabel: string;
}

// What the synopsis shows for its two states: collapsed, it is clamped to a few lines (by CSS, so it adapts to the width
// and no word is ever cut), and the toggle is offered only while the clamped text overflows or the full text is open.
export function getSynopsisView(expanded: boolean, overflows: boolean) {
  return {
    clamped: !expanded,
    showToggle: expanded || overflows,
    label: expanded ? ("less" as const) : ("more" as const),
  };
}

// The synopsis paragraph and its "Read more" toggle. The whole text is always in the HTML, for search engines and
// screen readers alike: collapsing it only clamps what is painted. Before hydration (and on the server) the text is
// assumed to overflow, as every published synopsis does, so the toggle is rendered from the start and nothing shifts;
// once measured, a text that fits in its lines loses the toggle.
export function SynopsisText({ text, lang, moreLabel, lessLabel }: SynopsisTextProps) {
  const id = useId();
  const textRef = useRef<HTMLParagraphElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(true);
  const view = getSynopsisView(expanded, overflows);

  // Only the clamped text can be measured: open, it has no overflow to compare. The observer reports once on observe,
  // before the first paint after hydration, and again whenever the width (and so the line count) changes.
  useEffect(() => {
    const element = textRef.current;
    if (!element || expanded) return;

    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => observer.disconnect();
  }, [expanded]);

  function toggle() {
    const toggleElement = toggleRef.current;
    const before = toggleElement?.getBoundingClientRect().top;

    flushSync(() => setExpanded((value) => !value));

    // Collapsing removes the text above the toggle: the page is scrolled by as much, at once and without animation, so
    // the toggle stays under the pointer and the reader keeps their place instead of landing further down the page.
    if (expanded && toggleElement && before !== undefined) {
      const shift = toggleElement.getBoundingClientRect().top - before;
      if (shift < 0) window.scrollBy({ top: shift, behavior: "instant" });
    }
  }

  return (
    <>
      <p
        id={id}
        ref={textRef}
        lang={lang}
        className={`mt-4 text-base leading-7 text-pretty wrap-break-word md:leading-8 ${view.clamped ? "line-clamp-4" : ""}`}
      >
        {text}
      </p>

      {view.showToggle && (
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={toggle}
          className="text-foreground focus-visible:ring-ring/50 mt-2 -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium underline decoration-current/30 underline-offset-4 outline-none hover:decoration-current focus-visible:ring-[3px]"
        >
          {view.label === "less" ? lessLabel : moreLabel}
          <FiChevronDown aria-hidden="true" className={`size-4 ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </>
  );
}
