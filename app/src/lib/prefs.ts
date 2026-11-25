import { useEffect, useState } from 'react';

const PREFIX = 'sjrw:';

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const v = JSON.parse(raw);
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback) && v && typeof v === 'object') return { ...fallback, ...v };
    return v as T;
  } catch {
    return fallback;
  }
}

export function savePref<T>(key: string, value: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or blocked */
  }
}

/** useState that is saved in this browser and restored on the next visit. */
export function usePersistentState<T>(key: string, fallback: T) {
  const [v, setV] = useState<T>(() => loadPref(key, fallback));
  useEffect(() => savePref(key, v), [key, v]);
  return [v, setV] as const;
}

export type Basemap = 'dark' | 'streets' | 'satellite' | 'terrain';

export interface LayerPrefs {
  mainStem: boolean;
  flowAnimation: boolean;
  hydro: boolean;
  canals: boolean;
  ditches: boolean;
  cityStorm: boolean;
  cityBasins: boolean;
  culverts: boolean;
  structures: boolean;
  nhdStructures: boolean;
  levees: boolean;
  ponds: boolean;
  basins: boolean;
  subbasins: boolean;
  fema: boolean;
  hillshade: boolean;
  rain: boolean;
  alertAreas: boolean;
  pulse: boolean;
  labels: boolean;
  groups: Record<'main' | 'tributary' | 'coastal' | 'other', boolean>;
}

export const DEFAULT_LAYERS: LayerPrefs = {
  mainStem: true,
  flowAnimation: true,
  hydro: true,
  canals: true,
  ditches: true,
  cityStorm: true,
  cityBasins: false,
  culverts: false,
  structures: true,
  nhdStructures: false,
  levees: false,
  ponds: false,
  basins: false,
  subbasins: false,
  fema: false,
  hillshade: false,
  rain: true,
  alertAreas: true,
  pulse: true,
  labels: true,
  groups: { main: true, tributary: true, coastal: true, other: false },
};

export interface SavedLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}
