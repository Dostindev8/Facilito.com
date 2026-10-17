import type { Metadata } from 'next';
import { absoluteUrl, site, siteUrl } from './site';

export function pageMeta(input: { title: string; description: string; path: string }): Metadata {
  const url = absoluteUrl(input.path);
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      locale: site.locale,
      url,
      siteName: site.name,
      title: input.title,
      description: input.description,
    },
    twitter: {
      card: 'summary_large_image',
      title: input.title,
      description: input.description,
    },
    robots: { index: true, follow: true },
  };
}

export function organizationJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.legalName,
    url: siteUrl().toString(),
    logo: absoluteUrl('/brand/facilito-icon.png'),
    email: site.email || undefined,
    address: {
      '@type': 'PostalAddress',
      addressLocality: site.city,
      addressCountry: 'DO',
    },
  };
}

/** No price and no aggregateRating: neither is a verified public fact. */
export function softwareJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: site.name,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: site.description,
    url: siteUrl().toString(),
    offers: undefined,
    provider: { '@type': 'Organization', name: site.maker },
  };
}

export function breadcrumbJsonLd(items: readonly { name: string; path: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function faqJsonLd(faqs: readonly { question: string; answer: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };
}
