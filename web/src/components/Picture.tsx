import { cn } from '@/lib/utils'

/** The source photography is 1200px wide; nothing here is upscaled. */
const WIDTHS = [600, 900, 1200]

/**
 * One image, three widths, two formats.
 *
 * AVIF first, WebP behind it, and an explicit aspect ratio on the element so
 * nothing on the page moves when it decodes. `position` exists because
 * every one of these photographs is a 4:5 crop of a wider frame, and the
 * pendant has to survive the crop.
 */
export function Picture({
  name,
  alt,
  sizes = '(min-width: 1024px) 34vw, 90vw',
  position = '50% 50%',
  className,
  priority,
  width = 1200,
  height = 1500,
}: {
  name: string
  alt: string
  sizes?: string
  position?: string
  className?: string
  priority?: boolean
  /** Intrinsic size, so the box is reserved before the file decodes. */
  width?: number
  height?: number
}) {
  const set = (extension: string) =>
    WIDTHS.map((w) => `/img/${name}-${w}.${extension} ${w}w`).join(', ')

  return (
    <picture>
      <source type="image/avif" srcSet={set('avif')} sizes={sizes} />
      <source type="image/webp" srcSet={set('webp')} sizes={sizes} />
      <img
        src={`/img/${name}-1200.webp`}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        style={{ objectPosition: position }}
        className={cn('h-full w-full object-cover', className)}
      />
    </picture>
  )
}
