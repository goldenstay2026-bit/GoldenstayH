import meta from '../data/image-meta.json';

const WIDTHS = [400, 800, 1600] as const;
const base = import.meta.env.BASE_URL;
const sizesMeta = meta as Record<string, { w: number; h: number }>;

export const imageUrl = (name: string, w: (typeof WIDTHS)[number] = 1600) => `${base}images/opt/${name}-${w}.webp`;

export function srcSet(name: string) {
  const intrinsic = sizesMeta[name]?.w ?? 1600;
  return WIDTHS.map((w) => `${imageUrl(name, w)} ${Math.min(w, intrinsic)}w`).join(', ');
}

type Props = {
  name: string;
  alt: string;
  sizes: string;
  className?: string;
  /** Above-the-fold image: eager + high priority */
  priority?: boolean;
  draggable?: boolean;
};

/** Responsive photo: WebP srcset (400/800/1600w) with the original JPEG as fallback. */
export function Img({ name, alt, sizes, className, priority, draggable }: Props) {
  const dims = sizesMeta[name];
  return (
    <picture>
      <source type="image/webp" srcSet={srcSet(name)} sizes={sizes} />
      <img
        src={`${base}images/${name}.jpg`}
        alt={alt}
        width={dims?.w}
        height={dims?.h}
        className={className}
        loading={priority ? 'eager' : 'lazy'}
        decoding={priority ? 'auto' : 'async'}
        // React 18 doesn't know the camelCase prop; pass the DOM attribute.
        {...{ fetchpriority: priority ? 'high' : 'auto' }}
        draggable={draggable}
      />
    </picture>
  );
}
