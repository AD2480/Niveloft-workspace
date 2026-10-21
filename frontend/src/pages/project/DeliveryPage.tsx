import { DeliveryOutlook } from '@/features/delivery/DeliveryOutlook';
import { useProjectContext } from '@/features/projects/projectContext';

/**
 * Delivery: when the project is likely to be delivered against its target, as a path and as a
 * chart from one forecast snapshot, what holds each milestone up, and scenarios to compare before
 * changing anything.
 */
export function DeliveryPage() {
  const { project } = useProjectContext();
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-10" data-delivery-page="">
      <div className="mb-6">
        <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-ink">When it’s likely to be delivered</h2>
        <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-muted">
          The target, the likely finish with its range, and what holds each milestone up, from the project’s records. Select a milestone to see its blocker; Flurry can point it out.
        </p>
      </div>
      <DeliveryOutlook project={project} />
    </div>
  );
}
