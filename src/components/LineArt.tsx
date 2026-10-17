import type { AttractionArt } from '../data/site';

// Deliberate line-illustration stand-ins for landmark photos. Replace with
// licensed photographs when available — never label stock as the property.

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  vectorEffect: 'non-scaling-stroke' as const,
};

export function LandmarkArt({ art, className = '' }: { art: AttractionArt | 'house'; className?: string }) {
  return (
    <svg viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <g {...stroke}>{ART[art]}</g>
    </svg>
  );
}

const ART: Record<AttractionArt | 'house', JSX.Element> = {
  // Kamakhya: beehive shikhara on a base, with a finial, on a hill line
  temple: (
    <>
      <path d="M150 18v14M144 24h12" />
      <path d="M150 32c-22 18-30 44-30 70h60c0-26-8-52-30-70z" />
      <path d="M113 102h74M118 102v40h64v-40" />
      <path d="M140 142v-22h20v22" />
      <path d="M0 162c40-10 80-22 130-16s100 8 170-16" />
    </>
  ),
  // Museum: classical pediment and columns
  museum: (
    <>
      <path d="M90 66l60-32 60 32z" />
      <path d="M86 66h128M92 74h116" />
      <path d="M104 74v70M126 74v70M150 74v70M174 74v70M196 74v70" />
      <path d="M86 144h128M80 152h140" />
      <path d="M0 176c60-6 120-6 180-2s90 2 120-4" />
    </>
  ),
  // Umananda: small temple on an island, river lines
  island: (
    <>
      <path d="M150 50v10M146 56h8" />
      <path d="M150 60l-9 18h18z" />
      <path d="M139 78h22v18h-22z" />
      <path d="M96 124c10-18 30-28 54-28s44 10 54 28" />
      <path d="M0 126c50-6 90 2 150-2s100-4 150 4" />
      <path d="M40 146h40M112 154h70M210 144h44" />
      <path d="M190 168l14-6 10 6-14 6z" />
    </>
  ),
  // Riverfront: bridge arches over water, a low sun
  river: (
    <>
      <circle cx="226" cy="44" r="12" />
      <path d="M0 106h300M0 114h300" />
      <path d="M0 106c22-30 52-30 74 0M74 106c26-34 60-34 86 0M160 106c26-34 60-34 86 0M246 106c18-24 40-26 54-14" />
      <path d="M74 114v52M160 114v52M246 114v52" />
      <path d="M0 166c50 4 100 4 150 0s100-4 150 0" />
    </>
  ),
  // Hero "Around Us" tile: a simple house outline on a hill
  house: (
    <>
      <path d="M150 30v10" />
      <path d="M118 78l32-38 32 38" />
      <path d="M124 72v52h52V72" />
      <path d="M0 150c50-30 100-20 150-8s110 14 150-14" />
    </>
  ),
};
