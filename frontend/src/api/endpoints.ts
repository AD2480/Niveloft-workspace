import type { TagDescription } from '@reduxjs/toolkit/query';
import { placeBetween } from '@/lib/ordering';
import { api, unwrap, TAGS } from './baseApi';
import type {
  Activity,
  ChangeLog,
  JourneyStepName,
  JourneySummary,
  DocumentRequest,
  AiFeedbackRequest,
  AiFeedbackSummary,
  ForecastTrial,
  DocumentSummary,
  ProjectDocument,
  AiCriteriaSuggestion,
  AiReviewAssist,
  AiStatus,
  AiSummary,
  AiAnswer,
  AiAskRequest,
  AiPlan,
  AiPlanRequest,
  ApiResponse,
  AuthOptions,
  AuditEvent,
  DeletionCheck,
  OpsSwitch,
  SessionInfo,
  EmailLinkRequest,
  RegisterResponse,
  ResetPasswordRequest,
  AuthResponse,
  CalendarEvent,
  ChangePasswordRequest,
  ChecklistUpdateRequest,
  Comment,
  CriteriaUpdateRequest,
  DashboardData,
  Dependency,
  Invitation,
  LoginRequest,
  Member,
  Milestone,
  MilestoneRequest,
  MoveTaskRequest,
  Notification,
  NotificationCategory,
  Page,
  PlanApplyRequest,
  PlanResult,
  ProjectAnalytics,
  ProjectDetail,
  ProjectRequest,
  ProjectStatus,
  ProjectSummary,
  RegisterRequest,
  ReviewRequest,
  SearchResult,
  Role,
  Submission,
  SubmissionRequest,
  StatusChange,
  Task,
  TaskQuery,
  TaskRequest,
  TaskStatus,
  UpdateProfileRequest,
  User,
  TaskMention,
  CatchUp,
} from './types';

type Tag = TagDescription<(typeof TAGS)[number]>;

/** Everything that depends on a project's tasks. */
function projectTaskTags(projectId: number): Tag[] {
  return [
    { type: 'TaskList', id: projectId },
    { type: 'TaskList', id: 'MINE' },
    { type: 'Project', id: projectId },
    { type: 'ProjectList', id: 'LIST' },
    { type: 'Analytics', id: projectId },
    { type: 'Milestone', id: projectId },
    { type: 'Activity', id: projectId },
    { type: 'Dependency', id: projectId },
    // Backlinks show the status and title of the tasks that mention a task.
    'Mention',
    'Dashboard',
    'Calendar',
  ];
}

export const endpoints = api.injectEndpoints({
  endpoints: (build) => ({
    // ---------------------------------------------------------------- auth
    login: build.mutation<AuthResponse, LoginRequest>({
      // credentials: the API sets or removes the HttpOnly "keep me signed in" cookie, even from another site.
      query: (body) => ({ url: '/auth/login', method: 'POST', body, credentials: 'include' }),
      transformResponse: unwrap<AuthResponse>,
    }),
    register: build.mutation<RegisterResponse, RegisterRequest>({
      query: (body) => ({ url: '/auth/register', method: 'POST', body, credentials: 'include' }),
      transformResponse: unwrap<RegisterResponse>,
    }),
    authOptions: build.query<AuthOptions, void>({
      query: () => '/auth/options',
      transformResponse: unwrap<AuthOptions>,
    }),
    /** Confirms the address; it doesn't sign in (the person signs in next). */
    verifyEmail: build.mutation<{ email: string }, { token: string }>({
      query: (body) => ({ url: '/auth/verify-email', method: 'POST', body }),
      transformResponse: unwrap<{ email: string }>,
    }),
    /** Resolves to the server's message (the same whether or not the address has an account). */
    resendVerification: build.mutation<string, EmailLinkRequest>({
      query: (body) => ({ url: '/auth/resend-verification', method: 'POST', body }),
      transformResponse: (r: ApiResponse<null>) => r.message ?? 'If that address has an account, a new link is on its way.',
    }),
    forgotPassword: build.mutation<string, EmailLinkRequest>({
      query: (body) => ({ url: '/auth/forgot-password', method: 'POST', body }),
      transformResponse: (r: ApiResponse<null>) => r.message ?? 'If that address has an account, a reset link is on its way.',
    }),
    resetPassword: build.mutation<string, ResetPasswordRequest>({
      query: (body) => ({ url: '/auth/reset-password', method: 'POST', body }),
      transformResponse: (r: ApiResponse<null>) => r.message ?? 'Your password was changed. Sign in with the new password.',
    }),
    me: build.query<User, void>({
      query: () => '/auth/me',
      transformResponse: unwrap<User>,
      providesTags: ['Me'],
    }),
    updateProfile: build.mutation<User, UpdateProfileRequest>({
      query: (body) => ({ url: '/users/me', method: 'PUT', body }),
      transformResponse: unwrap<User>,
      // Names/colours appear everywhere, so refresh all cached views.
      invalidatesTags: [...TAGS],
    }),
    /** Returns a new session for this device; the server signs every other device out. */
    changePassword: build.mutation<AuthResponse, ChangePasswordRequest>({
      query: (body) => ({ url: '/users/me/password', method: 'PUT', body, credentials: 'include' }),
      transformResponse: unwrap<AuthResponse>,
      invalidatesTags: ['Session'],
    }),
    /** Ends this device's session on the server (the token stops working wherever it was copied). */
    logout: build.mutation<null, void>({
      query: () => ({ url: '/auth/logout', method: 'POST', credentials: 'include' }),
      transformResponse: unwrap<null>,
    }),
    logoutEverywhere: build.mutation<string, void>({
      query: () => ({ url: '/auth/logout-everywhere', method: 'POST', credentials: 'include' }),
      transformResponse: (r: ApiResponse<null>) => r.message ?? 'Signed out everywhere.',
    }),
    sessions: build.query<SessionInfo[], void>({
      query: () => '/auth/sessions',
      transformResponse: unwrap<SessionInfo[]>,
      providesTags: ['Session'],
    }),
    endSession: build.mutation<null, number>({
      query: (id) => ({ url: `/auth/sessions/${id}`, method: 'DELETE' }),
      transformResponse: unwrap<null>,
      invalidatesTags: ['Session'],
    }),
    deletionCheck: build.query<DeletionCheck, void>({
      query: () => '/users/me/deletion-check',
      transformResponse: unwrap<DeletionCheck>,
      providesTags: ['Session'],
    }),
    deleteAccount: build.mutation<null, { password: string; confirm: string }>({
      query: (body) => ({ url: '/users/me/delete', method: 'POST', body }),
      transformResponse: unwrap<null>,
    }),

    // ---------------------------------------------------------------- dashboard
    dashboard: build.query<DashboardData, void>({
      query: () => '/dashboard',
      transformResponse: unwrap<DashboardData>,
      providesTags: ['Dashboard'],
    }),
    /** "Since you were last here" on Today. */
    catchUp: build.query<CatchUp, void>({
      query: () => '/catch-up',
      transformResponse: unwrap<CatchUp>,
      providesTags: ['CatchUp'],
    }),
    /** You've seen it: the next catch-up starts from now (the one on screen stays until you leave). */
    markCaughtUp: build.mutation<null, void>({
      query: () => ({ url: '/catch-up/seen', method: 'POST' }),
      transformResponse: unwrap<null>,
    }),

    // ---------------------------------------------------------------- projects
    projects: build.query<Page<ProjectSummary>, { search?: string; status?: ProjectStatus | ''; page?: number; size?: number }>({
      query: (params) => ({ url: '/projects', params }),
      transformResponse: unwrap<Page<ProjectSummary>>,
      providesTags: (res) => [{ type: 'ProjectList', id: 'LIST' }, ...(res?.content.map((p) => ({ type: 'Project' as const, id: p.id })) ?? [])],
    }),
    project: build.query<ProjectDetail, number>({
      query: (id) => `/projects/${id}`,
      transformResponse: unwrap<ProjectDetail>,
      providesTags: (_r, _e, id) => [{ type: 'Project', id }],
    }),
    createProject: build.mutation<ProjectDetail, ProjectRequest>({
      query: (body) => ({ url: '/projects', method: 'POST', body }),
      transformResponse: unwrap<ProjectDetail>,
      invalidatesTags: [{ type: 'ProjectList', id: 'LIST' }, 'Dashboard', 'Calendar'],
    }),
    updateProject: build.mutation<ProjectDetail, { id: number; body: ProjectRequest }>({
      query: ({ id, body }) => ({ url: `/projects/${id}`, method: 'PUT', body }),
      transformResponse: unwrap<ProjectDetail>,
      invalidatesTags: (_r, _e, { id }) => [...projectTaskTags(id), { type: 'TaskList', id }],
    }),
    deleteProject: build.mutation<null, number>({
      query: (id) => ({ url: `/projects/${id}`, method: 'DELETE' }),
      transformResponse: unwrap<null>,
      invalidatesTags: [{ type: 'ProjectList', id: 'LIST' }, 'Dashboard', 'Calendar', 'Notification', { type: 'TaskList', id: 'MINE' }],
    }),
    leaveProject: build.mutation<null, number>({
      query: (id) => ({ url: `/projects/${id}/leave`, method: 'POST' }),
      transformResponse: unwrap<null>,
      invalidatesTags: [{ type: 'ProjectList', id: 'LIST' }, 'Dashboard', 'Calendar', { type: 'TaskList', id: 'MINE' }],
    }),

    // ---------------------------------------------------------------- members & invitations
    members: build.query<Member[], number>({
      query: (projectId) => `/projects/${projectId}/members`,
      transformResponse: unwrap<Member[]>,
      providesTags: (_r, _e, projectId) => [{ type: 'Member', id: projectId }],
    }),
    updateMemberRole: build.mutation<Member, { projectId: number; memberId: number; role: Role }>({
      query: ({ projectId, memberId, role }) => ({ url: `/projects/${projectId}/members/${memberId}`, method: 'PUT', body: { role } }),
      transformResponse: unwrap<Member>,
      invalidatesTags: (_r, _e, { projectId }) => [{ type: 'Member', id: projectId }, ...projectTaskTags(projectId), { type: 'TaskList', id: projectId }],
    }),
    /** Makes another member the owner; the current owner stays on as a manager. */
    transferOwnership: build.mutation<Member, { projectId: number; memberId: number }>({
      query: ({ projectId, memberId }) => ({ url: `/projects/${projectId}/transfer-ownership`, method: 'POST', body: { memberId } }),
      transformResponse: unwrap<Member>,
      invalidatesTags: (_r, _e, { projectId }) => [{ type: 'Member', id: projectId }, { type: 'Project', id: projectId }, { type: 'ProjectList', id: 'LIST' },
        { type: 'Audit', id: projectId }],
    }),
    projectAudit: build.query<AuditEvent[], number>({
      query: (projectId) => `/projects/${projectId}/audit?limit=50`,
      transformResponse: unwrap<AuditEvent[]>,
      providesTags: (_r, _e, projectId) => [{ type: 'Audit', id: projectId }],
    }),
    opsSwitches: build.query<OpsSwitch[], void>({
      query: () => '/ops/switches',
      transformResponse: unwrap<OpsSwitch[]>,
      providesTags: ['OpsSwitch'],
    }),
    setOpsSwitch: build.mutation<OpsSwitch, { name: string; enabled: boolean; reason?: string }>({
      query: ({ name, ...body }) => ({ url: `/ops/switches/${name}`, method: 'PUT', body }),
      transformResponse: unwrap<OpsSwitch>,
      invalidatesTags: ['OpsSwitch'],
    }),
    removeMember: build.mutation<null, { projectId: number; memberId: number }>({
      query: ({ projectId, memberId }) => ({ url: `/projects/${projectId}/members/${memberId}`, method: 'DELETE' }),
      transformResponse: unwrap<null>,
      invalidatesTags: (_r, _e, { projectId }) => [{ type: 'Member', id: projectId }, ...projectTaskTags(projectId)],
    }),
    projectInvitations: build.query<Invitation[], number>({
      query: (projectId) => `/projects/${projectId}/invitations`,
      transformResponse: unwrap<Invitation[]>,
      providesTags: (_r, _e, projectId) => [{ type: 'Invitation', id: projectId }],
    }),
    invite: build.mutation<Invitation, { projectId: number; email: string; role: Role }>({
      query: ({ projectId, ...body }) => ({ url: `/projects/${projectId}/invitations`, method: 'POST', body }),
      transformResponse: unwrap<Invitation>,
      invalidatesTags: (_r, _e, { projectId }) => [{ type: 'Invitation', id: projectId }, { type: 'Activity', id: projectId }, 'MyInvitation', 'Notification'],
    }),
    revokeInvitation: build.mutation<null, { projectId: number; invitationId: number }>({
      query: ({ projectId, invitationId }) => ({ url: `/projects/${projectId}/invitations/${invitationId}`, method: 'DELETE' }),
      transformResponse: unwrap<null>,
      invalidatesTags: (_r, _e, { projectId }) => [{ type: 'Invitation', id: projectId }, 'MyInvitation'],
    }),
    myInvitations: build.query<Invitation[], void>({
      query: () => '/invitations/mine',
      transformResponse: unwrap<Invitation[]>,
      providesTags: ['MyInvitation'],
    }),
    respondToInvitation: build.mutation<{ projectId: number }, { id: number; accept: boolean }>({
      query: ({ id, accept }) => ({ url: `/invitations/${id}/${accept ? 'accept' : 'decline'}`, method: 'POST' }),
      transformResponse: unwrap<{ projectId: number }>,
      invalidatesTags: ['MyInvitation', 'Notification', { type: 'ProjectList', id: 'LIST' }, 'Dashboard', 'Calendar', 'Member', 'Invitation'],
    }),

    // ---------------------------------------------------------------- milestones
    milestones: build.query<Milestone[], number>({
      query: (projectId) => `/projects/${projectId}/milestones`,
      transformResponse: unwrap<Milestone[]>,
      providesTags: (_r, _e, projectId) => [{ type: 'Milestone', id: projectId }],
    }),
    createMilestone: build.mutation<Milestone, { projectId: number; body: MilestoneRequest }>({
      query: ({ projectId, body }) => ({ url: `/projects/${projectId}/milestones`, method: 'POST', body }),
      transformResponse: unwrap<Milestone>,
      invalidatesTags: (_r, _e, { projectId }) => [{ type: 'Milestone', id: projectId }, { type: 'Activity', id: projectId }, { type: 'Analytics', id: projectId }, 'Calendar', 'Dashboard'],
    }),
    updateMilestone: build.mutation<Milestone, { id: number; projectId: number; body: MilestoneRequest }>({
      query: ({ id, body }) => ({ url: `/milestones/${id}`, method: 'PUT', body }),
      transformResponse: unwrap<Milestone>,
      invalidatesTags: (_r, _e, { projectId }) => [{ type: 'Milestone', id: projectId }, { type: 'Activity', id: projectId }, { type: 'Analytics', id: projectId }, 'Calendar', 'Dashboard', { type: 'TaskList', id: projectId }],
    }),
    deleteMilestone: build.mutation<null, { id: number; projectId: number }>({
      query: ({ id }) => ({ url: `/milestones/${id}`, method: 'DELETE' }),
      transformResponse: unwrap<null>,
      invalidatesTags: (_r, _e, { projectId }) => [{ type: 'Milestone', id: projectId }, { type: 'Activity', id: projectId }, { type: 'Analytics', id: projectId }, 'Calendar', 'Dashboard', { type: 'TaskList', id: projectId }, 'Task'],
    }),

    // ---------------------------------------------------------------- tasks
    tasks: build.query<Page<Task>, { projectId: number } & TaskQuery>({
      query: ({ projectId, ...params }) => ({ url: `/projects/${projectId}/tasks`, params }),
      transformResponse: unwrap<Page<Task>>,
      providesTags: (_r, _e, { projectId }) => [{ type: 'TaskList', id: projectId }],
    }),
    /** All tasks of a project in board order (used by the Kanban board). */
    boardTasks: build.query<Task[], number>({
      query: (projectId) => ({ url: `/projects/${projectId}/tasks`, params: { size: 500, sort: 'position' } }),
      transformResponse: (r: ApiResponse<Page<Task>>) => r.data.content,
      providesTags: (_r, _e, projectId) => [{ type: 'TaskList', id: projectId }],
    }),
    myTasks: build.query<Page<Task>, TaskQuery>({
      query: (params) => ({ url: '/tasks/mine', params }),
      transformResponse: unwrap<Page<Task>>,
      providesTags: [{ type: 'TaskList', id: 'MINE' }],
    }),
    task: build.query<Task, number>({
      query: (id) => `/tasks/${id}`,
      transformResponse: unwrap<Task>,
      providesTags: (_r, _e, id) => [{ type: 'Task', id }],
    }),
    createTask: build.mutation<Task, { projectId: number; body: TaskRequest }>({
      query: ({ projectId, body }) => ({ url: `/projects/${projectId}/tasks`, method: 'POST', body }),
      transformResponse: unwrap<Task>,
      invalidatesTags: (_r, _e, { projectId }) => [...projectTaskTags(projectId), 'Notification', { type: 'Member', id: projectId }],
    }),
    updateTask: build.mutation<Task, { id: number; projectId: number; body: TaskRequest }>({
      query: ({ id, body }) => ({ url: `/tasks/${id}`, method: 'PUT', body }),
      transformResponse: unwrap<Task>,
      invalidatesTags: (_r, _e, { id, projectId }) => [{ type: 'Task', id }, { type: 'Activity', id: `TASK-${id}` }, ...projectTaskTags(projectId), { type: 'Member', id: projectId }],
    }),
    changeTaskStatus: build.mutation<Task, { id: number; projectId: number; status: TaskStatus }>({
      query: ({ id, status }) => ({ url: `/tasks/${id}/status`, method: 'PATCH', body: { status } }),
      transformResponse: unwrap<Task>,
      invalidatesTags: (_r, _e, { id, projectId }) => [{ type: 'Task', id }, { type: 'Activity', id: `TASK-${id}` }, ...projectTaskTags(projectId)],
    }),
    moveTask: build.mutation<Task, { id: number; projectId: number } & MoveTaskRequest>({
      query: ({ id, status, previousTaskId, nextTaskId }) => ({ url: `/tasks/${id}/move`, method: 'PATCH', body: { status, previousTaskId, nextTaskId } }),
      transformResponse: unwrap<Task>,
      invalidatesTags: (_r, _e, { id, projectId }) => [{ type: 'Task', id }, { type: 'Activity', id: `TASK-${id}` }, ...projectTaskTags(projectId)],
    }),
    updateCriteria: build.mutation<Task, { id: number; projectId: number } & CriteriaUpdateRequest>({
      query: ({ id, items, version }) => ({ url: `/tasks/${id}/criteria`, method: 'PUT', body: { items, version } }),
      transformResponse: unwrap<Task>,
      invalidatesTags: (_r, _e, { id, projectId }) => [{ type: 'Task', id }, { type: 'Activity', id: `TASK-${id}` }, { type: 'TaskList', id: projectId }, { type: 'Activity', id: projectId }],
    }),
    updateChecklist: build.mutation<Task, { id: number; projectId: number } & ChecklistUpdateRequest>({
      query: ({ id, items, version }) => ({ url: `/tasks/${id}/checklist`, method: 'PUT', body: { items, version } }),
      transformResponse: unwrap<Task>,
      invalidatesTags: (_r, _e, { id, projectId }) => [{ type: 'Task', id }, { type: 'Activity', id: `TASK-${id}` }, { type: 'TaskList', id: projectId }, { type: 'Activity', id: projectId }],
    }),
    toggleChecklistItem: build.mutation<Task, { itemId: number; taskId: number; projectId: number; done: boolean }>({
      query: ({ itemId, done }) => ({ url: `/checklist-items/${itemId}`, method: 'PATCH', body: { done } }),
      transformResponse: unwrap<Task>,
      invalidatesTags: (_r, _e, { taskId, projectId }) => [{ type: 'Activity', id: `TASK-${taskId}` }, { type: 'TaskList', id: projectId }, { type: 'Activity', id: projectId }],
    }),
    aiStatus: build.query<AiStatus, void>({
      query: () => '/ai/status',
      transformResponse: unwrap<AiStatus>,
      providesTags: ['AiStatus'],
    }),
    aiReviewAssist: build.mutation<AiReviewAssist, number>({
      query: (taskId) => ({ url: `/tasks/${taskId}/ai/review-assist`, method: 'POST' }),
      transformResponse: unwrap<AiReviewAssist>,
      invalidatesTags: ['AiStatus'],
    }),
    aiSuggestCriteria: build.mutation<AiCriteriaSuggestion, number>({
      query: (taskId) => ({ url: `/tasks/${taskId}/ai/criteria`, method: 'POST' }),
      transformResponse: unwrap<AiCriteriaSuggestion>,
      invalidatesTags: ['AiStatus'],
    }),
    aiAskProject: build.mutation<AiAnswer, { projectId: number; body: AiAskRequest }>({
      query: ({ projectId, body }) => ({ url: `/projects/${projectId}/ai/ask`, method: 'POST', body }),
      transformResponse: unwrap<AiAnswer>,
      invalidatesTags: ['AiStatus'],
    }),
    aiPlanProject: build.mutation<AiPlan, { projectId: number; body: AiPlanRequest }>({
      query: ({ projectId, body }) => ({ url: `/projects/${projectId}/ai/plan`, method: 'POST', body }),
      transformResponse: unwrap<AiPlan>,
      invalidatesTags: ['AiStatus'],
    }),
    aiProjectSummary: build.mutation<AiSummary, number>({
      query: (projectId) => ({ url: `/projects/${projectId}/ai/summary`, method: 'POST' }),
      transformResponse: unwrap<AiSummary>,
      invalidatesTags: ['AiStatus'],
    }),
    applyPlan: build.mutation<PlanResult, { projectId: number } & PlanApplyRequest>({
      query: ({ projectId, changes, basis, note }) => ({ url: `/projects/${projectId}/plan/apply`, method: 'POST', body: { changes, basis, note } }),
      transformResponse: unwrap<PlanResult>,
      // Nothing changed on a rejected plan, so don't refetch (that would silently recalculate the scenario).
      invalidatesTags: (_r, e, { projectId }) => (e ? [] : [...projectTaskTags(projectId), 'Task', 'Notification', { type: 'Member', id: projectId }]),
    }),
    dependencies: build.query<Dependency[], number>({
      query: (projectId) => `/projects/${projectId}/dependencies`,
      transformResponse: unwrap<Dependency[]>,
      providesTags: (_r, _e, projectId) => [{ type: 'Dependency', id: projectId }],
    }),
    addDependency: build.mutation<Dependency, { projectId: number; blockedTaskId: number; blockerTaskId: number }>({
      query: ({ blockedTaskId, blockerTaskId }) => ({ url: `/tasks/${blockedTaskId}/dependencies`, method: 'POST', body: { blockerTaskId } }),
      transformResponse: unwrap<Dependency>,
      invalidatesTags: (_r, _e, { projectId, blockedTaskId }) => [{ type: 'Dependency', id: projectId }, { type: 'Activity', id: `TASK-${blockedTaskId}` }, { type: 'Activity', id: projectId }, 'Dashboard'],
    }),
    removeDependency: build.mutation<null, { id: number; projectId: number; blockedTaskId: number }>({
      query: ({ id }) => ({ url: `/dependencies/${id}`, method: 'DELETE' }),
      transformResponse: unwrap<null>,
      invalidatesTags: (_r, _e, { projectId, blockedTaskId }) => [{ type: 'Dependency', id: projectId }, { type: 'Activity', id: `TASK-${blockedTaskId}` }, { type: 'Activity', id: projectId }, 'Dashboard'],
    }),
    deleteTask: build.mutation<null, { id: number; projectId: number }>({
      query: ({ id }) => ({ url: `/tasks/${id}`, method: 'DELETE' }),
      transformResponse: unwrap<null>,
      invalidatesTags: (_r, _e, { projectId }) => [...projectTaskTags(projectId), 'Notification', { type: 'Member', id: projectId }],
    }),

    // ---------------------------------------------------------------- comments
    comments: build.query<Comment[], number>({
      query: (taskId) => `/tasks/${taskId}/comments`,
      transformResponse: unwrap<Comment[]>,
      providesTags: (_r, _e, taskId) => [{ type: 'Comment', id: taskId }],
    }),
    /** Where a task is mentioned by its key (backlinks), from the projects you're on. */
    taskMentions: build.query<TaskMention[], number>({
      query: (taskId) => `/tasks/${taskId}/mentions`,
      transformResponse: unwrap<TaskMention[]>,
      providesTags: (_r, _e, taskId) => [{ type: 'Mention', id: taskId }],
    }),
    addComment: build.mutation<Comment, { taskId: number; projectId: number; body: string }>({
      query: ({ taskId, body }) => ({ url: `/tasks/${taskId}/comments`, method: 'POST', body: { body } }),
      transformResponse: unwrap<Comment>,
      invalidatesTags: (_r, _e, { taskId, projectId }) => [
        { type: 'Comment', id: taskId },
        { type: 'Task', id: taskId },
        { type: 'Activity', id: `TASK-${taskId}` },
        { type: 'Activity', id: projectId },
        { type: 'TaskList', id: projectId },
        'Mention',
        'Dashboard',
      ],
    }),
    editComment: build.mutation<Comment, { id: number; taskId: number; body: string }>({
      query: ({ id, body }) => ({ url: `/comments/${id}`, method: 'PUT', body: { body } }),
      transformResponse: unwrap<Comment>,
      invalidatesTags: (_r, _e, { taskId }) => [{ type: 'Comment', id: taskId }, 'Mention'],
    }),
    deleteComment: build.mutation<null, { id: number; taskId: number; projectId: number }>({
      query: ({ id }) => ({ url: `/comments/${id}`, method: 'DELETE' }),
      transformResponse: unwrap<null>,
      invalidatesTags: (_r, _e, { taskId, projectId }) => [{ type: 'Comment', id: taskId }, { type: 'Task', id: taskId }, { type: 'TaskList', id: projectId }, 'Mention'],
    }),

    // ---------------------------------------------------------------- submissions & reviews
    submissions: build.query<Submission[], number>({
      query: (taskId) => `/tasks/${taskId}/submissions`,
      transformResponse: unwrap<Submission[]>,
      providesTags: (_r, _e, taskId) => [{ type: 'Submission', id: taskId }],
    }),
    submitWork: build.mutation<Submission, { taskId: number; projectId: number } & SubmissionRequest>({
      query: ({ taskId, notes, evidence, files }) => {
        // multipart/form-data: a JSON "data" part plus zero or more "files" parts.
        const form = new FormData();
        form.append('data', new Blob([JSON.stringify({ notes, evidence })], { type: 'application/json' }));
        for (const f of files) form.append('files', f);
        return { url: `/tasks/${taskId}/submissions`, method: 'POST', body: form };
      },
      transformResponse: unwrap<Submission>,
      invalidatesTags: (_r, _e, { taskId, projectId }) => [
        { type: 'Submission', id: taskId },
        { type: 'Task', id: taskId },
        { type: 'Activity', id: `TASK-${taskId}` },
        ...projectTaskTags(projectId),
        'Notification',
      ],
    }),
    reviewSubmission: build.mutation<Submission, { submissionId: number; taskId: number; projectId: number } & ReviewRequest>({
      query: ({ submissionId, decision, feedback, results }) => ({ url: `/submissions/${submissionId}/review`, method: 'POST', body: { decision, feedback, results } }),
      transformResponse: unwrap<Submission>,
      invalidatesTags: (_r, _e, { taskId, projectId }) => [
        { type: 'Submission', id: taskId },
        { type: 'Task', id: taskId },
        { type: 'Activity', id: `TASK-${taskId}` },
        ...projectTaskTags(projectId),
        'Notification',
      ],
    }),

    // ---------------------------------------------------------------- activity
    projectActivity: build.query<Page<Activity>, { projectId: number; page?: number; size?: number }>({
      query: ({ projectId, ...params }) => ({ url: `/projects/${projectId}/activity`, params }),
      transformResponse: unwrap<Page<Activity>>,
      providesTags: (_r, _e, { projectId }) => [{ type: 'Activity', id: projectId }],
    }),
    taskActivity: build.query<Activity[], number>({
      query: (taskId) => `/tasks/${taskId}/activity`,
      transformResponse: unwrap<Activity[]>,
      providesTags: (_r, _e, taskId) => [{ type: 'Activity', id: `TASK-${taskId}` }],
    }),

    // ---------------------------------------------------------------- notifications
    notifications: build.query<Page<Notification>, { category: NotificationCategory; page?: number; size?: number }>({
      query: (params) => ({ url: '/notifications', params }),
      transformResponse: unwrap<Page<Notification>>,
      providesTags: ['Notification'],
    }),
    unreadCount: build.query<number, void>({
      query: () => '/notifications/unread-count',
      transformResponse: (r: ApiResponse<{ count: number }>) => r.data.count,
      providesTags: ['Notification'],
    }),
    markNotificationRead: build.mutation<Notification, { id: number; read?: boolean }>({
      query: ({ id, read = true }) => ({ url: `/notifications/${id}/read`, method: 'PATCH', body: { read } }),
      transformResponse: unwrap<Notification>,
      invalidatesTags: ['Notification'],
    }),
    markAllNotificationsRead: build.mutation<{ count: number }, void>({
      query: () => ({ url: '/notifications/read-all', method: 'POST' }),
      transformResponse: unwrap<{ count: number }>,
      invalidatesTags: ['Notification'],
    }),
    deleteNotification: build.mutation<null, number>({
      query: (id) => ({ url: `/notifications/${id}`, method: 'DELETE' }),
      transformResponse: unwrap<null>,
      invalidatesTags: ['Notification'],
    }),

    // ---------------------------------------------------------------- analytics & calendar
    projectHistory: build.query<StatusChange[], number>({
      query: (projectId) => `/projects/${projectId}/history`,
      transformResponse: unwrap<StatusChange[]>,
      // Status changes are what invalidates analytics, so share its tag.
      providesTags: (_r, _e, projectId) => [{ type: 'Analytics', id: projectId }],
    }),
    /** Changes since a moment, for "Why the date moved" (a replay of the forecast as of then). */
    projectChanges: build.query<ChangeLog, { projectId: number; since: string }>({
      query: ({ projectId, since }) => ({ url: `/projects/${projectId}/changes`, params: { since } }),
      transformResponse: unwrap<ChangeLog>,
      providesTags: (_r, _e, { projectId }) => [{ type: 'Analytics', id: projectId }],
    }),
    /** The forecast model trial: a trained model beside Niveloft's forecast (any member). */
    forecastTrial: build.query<ForecastTrial, number>({
      query: (projectId) => `/projects/${projectId}/forecast/trial`,
      transformResponse: unwrap<ForecastTrial>,
      providesTags: (_r, _e, projectId) => [{ type: 'Analytics', id: projectId }],
    }),
    // ---------------------------------------------------------------- corrections to Flurry
    recordAiFeedback: build.mutation<null, { projectId: number; body: AiFeedbackRequest }>({
      query: ({ projectId, body }) => ({ url: `/projects/${projectId}/ai/feedback`, method: 'POST', body }),
      transformResponse: () => null,
      invalidatesTags: (_r, _e, { projectId }) => [{ type: 'AiFeedback', id: projectId }],
    }),
    aiFeedbackSummary: build.query<AiFeedbackSummary, { projectId: number; days: number }>({
      query: ({ projectId, days }) => ({ url: `/projects/${projectId}/ai/feedback`, params: { days } }),
      transformResponse: unwrap<AiFeedbackSummary>,
      providesTags: (_r, _e, { projectId }) => [{ type: 'AiFeedback', id: projectId }],
    }),

    // ---------------------------------------------------------------- project documents
    documents: build.query<DocumentSummary[], number>({
      query: (projectId) => `/projects/${projectId}/documents`,
      transformResponse: unwrap<DocumentSummary[]>,
      providesTags: (_r, _e, projectId) => [{ type: 'Document', id: `P${projectId}` }],
    }),
    document: build.query<ProjectDocument, { projectId: number; id: number }>({
      query: ({ projectId, id }) => `/projects/${projectId}/documents/${id}`,
      transformResponse: unwrap<ProjectDocument>,
      providesTags: (_r, _e, { id }) => [{ type: 'Document', id }],
    }),
    createDocument: build.mutation<ProjectDocument, { projectId: number; body: DocumentRequest }>({
      query: ({ projectId, body }) => ({ url: `/projects/${projectId}/documents`, method: 'POST', body }),
      transformResponse: unwrap<ProjectDocument>,
      invalidatesTags: (_r, _e, { projectId }) => [{ type: 'Document', id: `P${projectId}` }, { type: 'Activity', id: projectId }],
    }),
    updateDocument: build.mutation<ProjectDocument, { projectId: number; id: number; body: DocumentRequest }>({
      query: ({ projectId, id, body }) => ({ url: `/projects/${projectId}/documents/${id}`, method: 'PUT', body }),
      transformResponse: unwrap<ProjectDocument>,
      invalidatesTags: (_r, _e, { projectId, id }) => [{ type: 'Document', id }, { type: 'Document', id: `P${projectId}` }, { type: 'Activity', id: projectId }],
    }),
    approveDocument: build.mutation<ProjectDocument, { projectId: number; id: number; approved: boolean }>({
      query: ({ projectId, id, approved }) => ({ url: `/projects/${projectId}/documents/${id}/approval`, method: 'PUT', body: { approved } }),
      transformResponse: unwrap<ProjectDocument>,
      invalidatesTags: (_r, _e, { projectId, id }) => [{ type: 'Document', id }, { type: 'Document', id: `P${projectId}` }, { type: 'Activity', id: projectId }],
    }),
    deleteDocument: build.mutation<null, { projectId: number; id: number }>({
      query: ({ projectId, id }) => ({ url: `/projects/${projectId}/documents/${id}`, method: 'DELETE' }),
      transformResponse: () => null,
      invalidatesTags: (_r, _e, { projectId, id }) => [{ type: 'Document', id }, { type: 'Document', id: `P${projectId}` }, { type: 'Activity', id: projectId }],
    }),

    /** Counts one step of the blocker journey (no person, task or text is sent). */
    recordJourney: build.mutation<null, { projectId: number; step: JourneyStepName; blockerKind?: string | null; option?: string | null }>({
      query: ({ projectId, step, blockerKind, option }) => ({ url: `/projects/${projectId}/journey`, method: 'POST', body: { step, blockerKind: blockerKind ?? null, option: option ?? null } }),
      transformResponse: () => null,
    }),
    journeySummary: build.query<JourneySummary, { projectId: number; days?: number }>({
      query: ({ projectId, days = 30 }) => ({ url: `/projects/${projectId}/journey`, params: { days } }),
      transformResponse: unwrap<JourneySummary>,
    }),
    projectAnalytics: build.query<ProjectAnalytics, number>({
      query: (projectId) => `/projects/${projectId}/analytics`,
      transformResponse: unwrap<ProjectAnalytics>,
      providesTags: (_r, _e, projectId) => [{ type: 'Analytics', id: projectId }],
    }),
    search: build.query<SearchResult, string>({
      query: (q) => ({ url: '/search', params: { q, limit: 8 } }),
      transformResponse: unwrap<SearchResult>,
      keepUnusedDataFor: 30,
    }),
    calendar: build.query<CalendarEvent[], { from: string; to: string; projectId?: number | ''; mine?: boolean }>({
      query: (params) => ({ url: '/calendar', params }),
      transformResponse: unwrap<CalendarEvent[]>,
      providesTags: ['Calendar'],
    }),
  }),
});

/** Optimistically reorder the board so drag-and-drop feels instant; roll back on error. */
endpoints.enhanceEndpoints({
  endpoints: {
    moveTask: {
      async onQueryStarted({ id, projectId, status, previousTaskId, nextTaskId }, { dispatch, queryFulfilled }) {
        // Same fractional-ordering rule as the server, so the card lands exactly where it will stay.
        const patch = dispatch(
          endpoints.util.updateQueryData('boardTasks', projectId, (draft) => {
            const task = draft.find((t) => t.id === id);
            if (!task) return;
            task.status = status;
            placeBetween(
              draft.filter((t) => t.status === status),
              task,
              previousTaskId,
              nextTaskId,
            );
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    },
    toggleChecklistItem: {
      // Tick instantly; the server's copy (with doneBy/doneAt and the new version) replaces it.
      async onQueryStarted({ itemId, taskId, done }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          endpoints.util.updateQueryData('task', taskId, (draft) => {
            const item = draft.checklist.find((c) => c.id === itemId);
            if (item) item.done = done;
          }),
        );
        try {
          const { data } = await queryFulfilled;
          // updateQueryData, not upsertQueryData: RTK runs upserted values through transformResponse
          // (unwrap) again, which would leave the task empty.
          dispatch(endpoints.util.updateQueryData('task', taskId, () => data));
        } catch {
          patch.undo();
        }
      },
    },
  },
});

export const {
  useLoginMutation,
  useRegisterMutation,
  useAuthOptionsQuery,
  useVerifyEmailMutation,
  useResendVerificationMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useMeQuery,
  useUpdateProfileMutation,
  useChangePasswordMutation,
  useLogoutMutation,
  useLogoutEverywhereMutation,
  useSessionsQuery,
  useEndSessionMutation,
  useDeletionCheckQuery,
  useDeleteAccountMutation,
  useDashboardQuery,
  useProjectsQuery,
  useProjectQuery,
  useCreateProjectMutation,
  useUpdateProjectMutation,
  useDeleteProjectMutation,
  useLeaveProjectMutation,
  useMembersQuery,
  useUpdateMemberRoleMutation,
  useRemoveMemberMutation,
  useTransferOwnershipMutation,
  useProjectAuditQuery,
  useOpsSwitchesQuery,
  useSetOpsSwitchMutation,
  useProjectInvitationsQuery,
  useInviteMutation,
  useRevokeInvitationMutation,
  useMyInvitationsQuery,
  useRespondToInvitationMutation,
  useMilestonesQuery,
  useCreateMilestoneMutation,
  useUpdateMilestoneMutation,
  useDeleteMilestoneMutation,
  useTasksQuery,
  useBoardTasksQuery,
  useMyTasksQuery,
  useTaskQuery,
  useCreateTaskMutation,
  useUpdateTaskMutation,
  useChangeTaskStatusMutation,
  useUpdateCriteriaMutation,
  useUpdateChecklistMutation,
  useToggleChecklistItemMutation,
  useMoveTaskMutation,
  useDeleteTaskMutation,
  useDependenciesQuery,
  useApplyPlanMutation,
  useAiStatusQuery,
  useAiReviewAssistMutation,
  useAiSuggestCriteriaMutation,
  useAiProjectSummaryMutation,
  useAiAskProjectMutation,
  useAiPlanProjectMutation,
  useAddDependencyMutation,
  useRemoveDependencyMutation,
  useCommentsQuery,
  useTaskMentionsQuery,
  useCatchUpQuery,
  useMarkCaughtUpMutation,
  useAddCommentMutation,
  useEditCommentMutation,
  useDeleteCommentMutation,
  useSubmissionsQuery,
  useSubmitWorkMutation,
  useReviewSubmissionMutation,
  useProjectActivityQuery,
  useTaskActivityQuery,
  useNotificationsQuery,
  useUnreadCountQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
  useDeleteNotificationMutation,
  useProjectAnalyticsQuery,
  useProjectHistoryQuery,
  useProjectChangesQuery,
  useRecordJourneyMutation,
  useDocumentsQuery,
  useRecordAiFeedbackMutation,
  useAiFeedbackSummaryQuery,
  useForecastTrialQuery,
  useDocumentQuery,
  useCreateDocumentMutation,
  useUpdateDocumentMutation,
  useApproveDocumentMutation,
  useDeleteDocumentMutation,
  useJourneySummaryQuery,
  useCalendarQuery,
  useSearchQuery,
} = endpoints;
