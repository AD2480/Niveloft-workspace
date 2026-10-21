/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "browser": the automated tests' in-browser stand-in for the API. Never in a production build. */
  readonly VITE_TEST_API?: string;
  /** The API's address: https://api.example.com/api, or /api when this host forwards it. */
  readonly VITE_API_BASE_URL?: string;
  /** The site's public address, e.g. https://projectflow.vercel.app (canonical links, social previews, sitemap). */
  readonly VITE_SITE_URL?: string;
  /** Who runs this copy of Niveloft, named on the privacy policy and terms. */
  readonly VITE_OPERATOR_NAME?: string;
  /** Where people can reach the operator about privacy or the terms. */
  readonly VITE_CONTACT_EMAIL?: string;
  /** Cloudflare Turnstile site key (public). The backend needs the matching secret. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  /** "vercel" turns on Vercel Web Analytics (after consent). */
  readonly VITE_ANALYTICS?: string;
  /** Google Analytics 4 measurement id (G-…), loaded only after consent. */
  readonly VITE_GA_MEASUREMENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
