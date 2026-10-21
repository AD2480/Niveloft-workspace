import { PublicPage } from '@/components/layout/PublicFrame';
import { MeetFlurry } from '@/features/flurry/meet/MeetFlurry';
import { usePageMeta } from '@/lib/pageMeta';

/** Meet Flurry: the assistant's character, its behaviour, a sandbox to try it, and its rules. */
export function FlurryPage() {
  usePageMeta({ title: 'Meet Flurry', path: '/flurry' });
  return (
    <PublicPage>
      <MeetFlurry />
    </PublicPage>
  );
}
