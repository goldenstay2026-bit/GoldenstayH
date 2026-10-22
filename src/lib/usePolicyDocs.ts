// Policy pages with the owner's latest stay details & house rules
// (Admin → Settings), fetched once per visit. Until they arrive — or if the
// server can't be reached — the pages use the values in site.ts.

import { useEffect, useState } from 'react';
import type { PropertySettings } from '../../shared/types.ts';
import { POLICY_DOCS, buildPolicyDocs, type PolicyValues } from '../data/policies';
import { policies } from '../data/site';
import { api } from './api';

let cached: Promise<PropertySettings | null> | null = null;
const load = () => (cached ??= api<PropertySettings>('/property').catch(() => null));

export function usePolicyDocs() {
  const [docs, setDocs] = useState(POLICY_DOCS);
  useEffect(() => {
    let live = true;
    void load().then((s) => {
      if (!live || !s) return;
      const merged = { ...policies } as Record<string, unknown>;
      for (const [k, v] of Object.entries(s)) if (k in merged && v !== null && v !== '') merged[k] = v;
      setDocs(buildPolicyDocs(merged as PolicyValues));
    });
    return () => {
      live = false;
    };
  }, []);
  return docs;
}
