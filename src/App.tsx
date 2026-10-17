import { useState, type ReactNode } from 'react';
import { About } from './components/About';
import { Amenities, HighlightsStrip } from './components/Amenities';
import { AroundUs } from './components/AroundUs';
import { Contact } from './components/Contact';
import { CoupleNote } from './components/CoupleNote';
import { EntireHomestayBlock } from './components/EntireHomestayBlock';
import { Footer } from './components/Footer';
import { Gallery } from './components/Gallery';
import { Hero } from './components/Hero';
import { MobileActionBar } from './components/MobileActionBar';
import { Nav } from './components/Nav';
import { PolicyPage } from './components/PolicyPage';
import { Reviews } from './components/Reviews';
import { Rooms } from './components/Rooms';
import { EnquiryProvider } from './lib/EnquiryContext';
import { POLICY_PAGES, RouterProvider, TABS, useRouter, type PolicyId, type RouteId } from './lib/router';

/** One tab's content. Hidden (not removed) when inactive, so everything stays crawlable and form state is kept. */
function Panel({ id, children }: { id: RouteId; children: ReactNode }) {
  const { route } = useRouter();
  const isTab = TABS.some((t) => t.id === id);
  return (
    <section
      role="tabpanel"
      id={`panel-${id}`}
      {...(isTab ? { 'aria-labelledby': `tab-${id}` } : { 'aria-label': POLICY_PAGES[id as PolicyId] })}
      hidden={route !== id}
      className="tab-panel"
    >
      {children}
    </section>
  );
}

/**
 * Policy text is rendered the first time its page is opened (then kept), so
 * the homepage's first download stays small. The panel itself is always
 * present, so #terms etc. and the Back button work the same.
 */
function PolicyContent({ id }: { id: PolicyId }) {
  const { route } = useRouter();
  const [opened, setOpened] = useState(false);
  if (route === id && !opened) setOpened(true);
  return route === id || opened ? <PolicyPage id={id} /> : null;
}

function Panels() {
  return (
    <main id="main" tabIndex={-1} className="outline-none">
      <Panel id="home">
        <Hero />
        <HighlightsStrip />
        <div className="container-x mt-5 flex justify-center">
          <CoupleNote className="rounded-full bg-card px-4 py-2" />
        </div>
        <EntireHomestayBlock />
        <div className="container-x mt-8 flex justify-center">
          <a href="#rooms" className="btn btn-dark h-12 px-7 text-[15px]">
            View Rooms
          </a>
        </div>
        <About />
      </Panel>
      <Panel id="rooms">
        <Rooms />
      </Panel>
      <Panel id="amenities">
        <Amenities />
      </Panel>
      <Panel id="gallery">
        <Gallery />
      </Panel>
      <Panel id="around">
        <AroundUs />
      </Panel>
      <Panel id="reviews">
        <Reviews />
      </Panel>
      <Panel id="contact">
        <Contact />
      </Panel>
      {(Object.keys(POLICY_PAGES) as PolicyId[]).map((id) => (
        <Panel key={id} id={id}>
          <PolicyContent id={id} />
        </Panel>
      ))}
    </main>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <EnquiryProvider>
        <Nav />
        <Panels />
        <Footer />
        <MobileActionBar />
      </EnquiryProvider>
    </RouterProvider>
  );
}
