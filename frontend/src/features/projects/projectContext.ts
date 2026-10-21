import { useOutletContext } from 'react-router';
import type { ProjectDetail } from '@/api/types';
import { useAppSelector } from '@/app/store';

export interface ProjectOutletContext {
  project: ProjectDetail;
  openNewTask: (defaults?: { status?: 'TODO' | 'IN_PROGRESS'; milestoneId?: number }) => void;
}

export function useProjectContext(): ProjectOutletContext {
  return useOutletContext<ProjectOutletContext>();
}

export function useCurrentUserId(): number {
  return useAppSelector((s) => s.auth.user?.id ?? 0);
}
