import { Search, X } from 'lucide-react';
import type { Member, Milestone } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Form';
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, TASK_STATUSES } from '@/lib/constants';

export interface TaskFilterValues {
  q: string;
  assignee: string;
  priority: string;
  status?: string;
  milestone?: string;
  due?: string;
}

interface Props {
  values: TaskFilterValues;
  search: string;
  onSearchChange: (v: string) => void;
  onChange: (patch: Partial<TaskFilterValues>) => void;
  onClear: () => void;
  members: Member[];
  milestones?: Milestone[];
  showStatus?: boolean;
  showDue?: boolean;
  showMilestone?: boolean;
}

export function TaskFilters({ values, search, onSearchChange, onChange, onClear, members, milestones, showStatus, showDue, showMilestone }: Props) {
  const active = Boolean(values.q || values.assignee || values.priority || values.status || values.milestone || values.due || search);
  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter tasks">
      <div className="w-full sm:w-60">
        <Input leftIcon={<Search />} type="search" value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" />
      </div>
      {showStatus && (
        <Select aria-label="Status" value={values.status ?? ''} onChange={(e) => onChange({ status: e.target.value })} className="w-[calc(50%-4px)] sm:w-36">
          <option value="">All statuses</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      )}
      <Select aria-label="Assignee" value={values.assignee} onChange={(e) => onChange({ assignee: e.target.value })} className="w-[calc(50%-4px)] sm:w-40">
        <option value="">Anyone</option>
        <option value="me">Assigned to me</option>
        <option value="unassigned">Unassigned</option>
        {members
          .filter((m) => m.role !== 'VIEWER')
          .map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.name}
            </option>
          ))}
      </Select>
      <Select aria-label="Priority" value={values.priority} onChange={(e) => onChange({ priority: e.target.value })} className="w-[calc(50%-4px)] sm:w-36">
        <option value="">Any priority</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]}
          </option>
        ))}
      </Select>
      {showMilestone && milestones && (
        <Select aria-label="Milestone" value={values.milestone ?? ''} onChange={(e) => onChange({ milestone: e.target.value })} className="w-[calc(50%-4px)] sm:w-44">
          <option value="">Any milestone</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      )}
      {showDue && (
        <Select aria-label="Due date" value={values.due ?? ''} onChange={(e) => onChange({ due: e.target.value })} className="w-[calc(50%-4px)] sm:w-36">
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="week">Next 7 days</option>
          <option value="none">No due date</option>
        </Select>
      )}
      {active && (
        <Button variant="ghost" size="sm" leftIcon={<X />} onClick={onClear}>
          Clear
        </Button>
      )}
    </div>
  );
}
