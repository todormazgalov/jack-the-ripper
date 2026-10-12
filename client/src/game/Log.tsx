import { useEffect, useRef } from 'react';
import type { LogEntry } from '@jtr/shared';

export default function Log({ entries }: { entries: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [entries.length]);
  return (
    <div className="log" ref={ref}>
      {entries.map((e, i) => (
        <div key={i} className={e.jackOnly ? 'secret' : ''}>
          <span className="n">N{e.night}</span> {e.text}
        </div>
      ))}
    </div>
  );
}
