import { Footer } from '@/components/Footer'
import { Nav } from '@/components/Nav'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { Receipts } from '@/sections/Receipts'
import { Hero } from '@/sections/Hero'
import { Preorder } from '@/sections/Preorder'
import { Pricing } from '@/sections/Pricing'
import { Story } from '@/sections/Story'
import { PendantCanvas } from '@/three/PendantCanvas'

/**
 * The whole site, in five sections and about eight screens.
 *
 * The order is an argument: what it is, how it does it, what makes it
 * different, what it costs, and then the ask. Nothing here is a feature list, and nothing was added
 * because there was room for it.
 *
 * The pendant lives in one fixed canvas behind all of it, which is why the
 * first three sections and the last one paint no background of their own.
 *
 * Buying happens here too, and in the section that quotes the price:
 * every Preorder and Reserve scrolls to the paysheet in Pricing, which
 * takes the phone, the email, the code and the deposit without the page
 * ever changing.
 */
export function Landing() {
  useDocumentTitle('LYZN — the pendant that follows through')

  return (
    <>
      <a
        href="#product"
        className="btn btn-primary sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60]"
      >
        Skip to content
      </a>

      <PendantCanvas />
      <Nav />

      <main>
        <Hero />
        <Story />
        <Receipts />
        <Pricing />
        <Preorder />
      </main>

      <Footer />
    </>
  )
}
