import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { buttonClass } from '@/components/ui/buttonStyles';
import { EmptyState } from '@/components/ui/States';

export function NotFoundPage({ title = 'Page not found', description = 'The page you’re looking for doesn’t exist or has moved.' }: { title?: string; description?: string }) {
  return (
    <EmptyState
      icon={Compass}
      title={title}
      description={description}
      className="min-h-[60vh]"
      action={
        <Link to="/dashboard" className={buttonClass('primary', 'md')}>
          Go to Today
        </Link>
      }
    />
  );
}
