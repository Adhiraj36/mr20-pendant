import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * An element's top within an ancestor, ignoring transforms.
 *
 * `getBoundingClientRect` reports where a transform has put an element this
 * frame; `offsetTop` reports where layout put it. A gap measured between
 * two pieces of type has to be the latter, or the object placed in it would
 * follow the type's entrance and exit animations around the screen.
 *
 * The ancestor has to be positioned, or the walk goes straight past it.
 */
export function offsetTopWithin(el: HTMLElement, ancestor: HTMLElement) {
  let top = 0
  let node: HTMLElement | null = el
  while (node && node !== ancestor) {
    top += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return top
}
