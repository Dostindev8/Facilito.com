import { preload } from 'react-dom';
import { FinalCta } from '@/components/marketing/final-cta';
import { Hero } from '@/components/marketing/hero';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { JsonLd } from '@/components/marketing/json-ld';
import { Manifesto, TrustStrip } from '@/components/marketing/trust-strip';
import { Pillars } from '@/components/marketing/pillars';
import { organizationJsonLd, pageMeta, softwareJsonLd } from '@/lib/seo';
import { HERO_POSTER, heroVideoAvailable } from '@/lib/hero-media';
import { site } from '@/lib/site';

const title = `${site.name} — ${site.tagline}`;

export const metadata = {
  ...pageMeta({
    title,
    description: site.description,
    path: '/',
  }),
  title: { absolute: title },
};

export default function HomePage() {
  preload(HERO_POSTER, { as: 'image', fetchPriority: 'high' });
  return (
    <>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={softwareJsonLd()} />
      <Hero videoReady={heroVideoAvailable()} />
      <Pillars />
      <HowItWorks />
      <TrustStrip />
      <Manifesto />
      <FinalCta />
    </>
  );
}
