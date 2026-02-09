// src/components/MermaidDiagram.tsx
import { useEffect, useMemo, useRef } from "react";
import mermaid from "mermaid";

type Props = {
  code: string;
  id?: string; // ✅ allow passing an id
};

export function MermaidDiagram({ code, id }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // stable unique id if none provided
  const renderId = useMemo(() => id ?? `mermaid-${Math.random().toString(36).slice(2)}`, [id]);

  useEffect(() => {
    // init once is fine; mermaid is smart about it
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!containerRef.current) return;

      try {
        // render returns SVG string
        const { svg } = await mermaid.render(renderId, code);

        if (cancelled) return;
        containerRef.current.innerHTML = svg;
      } catch (e: any) {
        if (cancelled) return;
        containerRef.current.innerHTML = `<pre style="white-space:pre-wrap;color:#ef4444;">Mermaid render error:\n${String(
          e?.message ?? e
        )}</pre>`;
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [code, renderId]);

  return <div ref={containerRef} />;
}

export default MermaidDiagram;