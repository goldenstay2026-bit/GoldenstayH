import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { Photo } from '../data/site';
import { imageUrl, srcSet } from './Img';
import { useModal } from '../lib/useModal';

type Props = {
  photos: Photo[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
};

const SWIPE_PX = 50;

export function Lightbox({ photos, index, onClose, onIndex }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const count = photos.length;
  const photo = photos[index];

  const go = (delta: number) => onIndex((index + delta + count) % count);
  const goRef = useRef(go);
  goRef.current = go;

  useModal(ref, true, onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goRef.current(1);
      else if (e.key === 'ArrowLeft') goRef.current(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Warm the neighbours so arrowing feels instant.
  useEffect(() => {
    for (const d of [1, -1]) {
      const img = new Image();
      img.src = imageUrl(photos[(index + d + count) % count].image, 1600);
    }
  }, [index, photos, count]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${count}: ${photo.caption}`}
      className="on-dark fixed inset-0 z-[60] flex flex-col bg-ink/95 text-white"
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4">
        <p className="text-[13px] text-white/80" aria-live="polite">
          <span className="font-semibold text-white">{photo.caption}</span>
          <span className="mx-2 text-white/40">·</span>
          {index + 1} / {count}
        </p>
        <button
          type="button"
          data-autofocus
          onClick={onClose}
          aria-label="Close gallery"
          className="grid size-11 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 md:px-20 md:pb-8"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <img
          key={photo.image}
          src={imageUrl(photo.image, 1600)}
          srcSet={srcSet(photo.image)}
          sizes="100vw"
          alt={photo.alt}
          className="max-h-full max-w-full select-none rounded-[16px] object-contain"
          draggable={false}
        />
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Previous photo"
          className="absolute left-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 backdrop-blur transition-colors hover:bg-white/25 md:left-6 md:size-12"
        >
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Next photo"
          className="absolute right-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 backdrop-blur transition-colors hover:bg-white/25 md:right-6 md:size-12"
        >
          <ChevronRight size={22} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
