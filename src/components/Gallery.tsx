import { useState } from 'react';
import { GALLERY_GRID_COUNT, gallery } from '../data/site';
import { SectionHead } from './Heading';
import { Img } from './Img';
import { Lightbox } from './Lightbox';

// Desktop/tablet: tall first photo + six tiles across two 200px rows.
// Mobile: one wide photo + four tiles (the last two are lightbox-only).
const tileCls = [
  'col-span-2 aspect-[4/3] md:col-span-1 md:row-span-2 md:aspect-auto',
  'aspect-[4/3] md:aspect-auto',
  'aspect-[4/3] md:aspect-auto',
  'aspect-[4/3] md:aspect-auto',
  'aspect-[4/3] md:aspect-auto',
  'hidden md:block',
  'hidden md:block',
];

export function Gallery() {
  const [open, setOpen] = useState<number | null>(null);
  const grid = gallery.slice(0, GALLERY_GRID_COUNT);

  return (
    <section aria-labelledby="gallery-title" className="section container-x">
      <SectionHead
        id="gallery-title"
        before="A look"
        accent="around"
        lead="Real photographs of Golden Stay. Tap any photo to enlarge."
      />
      <ul className="grid grid-cols-2 gap-[10px] md:grid-cols-4 md:grid-rows-[170px_170px] md:gap-[14px] lg:grid-rows-[200px_200px]">
        {grid.map((p, i) => (
          <li key={p.image} className={tileCls[i]}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="group relative block size-full overflow-hidden rounded-[16px] bg-beige"
            >
              <span className="sr-only">Enlarge photo: </span>
              <Img
                name={p.image}
                alt={p.alt}
                sizes={i === 0 ? '(min-width: 641px) 25vw, 100vw' : '(min-width: 641px) 25vw, 50vw'}
                className="zoom-img absolute inset-0 size-full object-cover"
              />
              <span className="chip absolute bottom-2.5 left-2.5">{p.caption}</span>
            </button>
          </li>
        ))}
      </ul>

      {open !== null && (
        <Lightbox photos={gallery} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}
