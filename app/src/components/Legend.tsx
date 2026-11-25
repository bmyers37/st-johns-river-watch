import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Severity } from '../shared/types';
import { SEVERITY } from '../lib/format';
import type { LayerPrefs } from '../lib/prefs';

const ORDER: Severity[] = ['major', 'moderate', 'minor', 'action', 'normal', 'unknown'];

export default function Legend({ layers }: { layers: LayerPrefs }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="glass absolute bottom-8 left-3 z-10 w-[214px] rounded-xl px-3 py-2 text-[11.5px]">
      <button className="label-xs flex w-full items-center justify-between" onClick={() => setOpen(!open)} aria-expanded={open}>
        Flood severity {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          {ORDER.map((s) => (
            <div key={s} className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full border border-white/80" style={{ background: SEVERITY[s].color }} />
              {SEVERITY[s].label}
            </div>
          ))}
          <div className="faint mt-1.5 border-t pt-1.5 text-[10.5px] leading-snug" style={{ borderColor: 'var(--border)' }}>
            ▲ rising · ▼ falling · ■ steady (3-hour change)
            <br />
            Dashed ring / ⚠ = reading is stale
            {layers.pulse && (
              <>
                <br />
                Pulsing = moderate or major flooding
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
