import { HomeLanding } from '@/features/public/home/HomeLanding';
import { usePageMeta } from '@/lib/pageMeta';

/**
 * The front page: the promise, the sample project as a block of snowpack read layer by layer, then
 * the product itself, working. See features/public/home.
 */
export function HomePage() {
  usePageMeta({ title: 'Niveloft', path: '/' });
  return <HomeLanding />;
}
