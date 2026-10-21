import { api, unwrap } from './baseApi';
import type { AiModel, ApiResponse, ArenaScoreboard, ArenaVoteRequest, ContactMessage, ContactReceipt, ContactRequest, SiteHealth } from './types';

/** Contact messages, the operator's Site health page, the AI models list and the Arena. */
export const siteEndpoints = api.injectEndpoints({
  endpoints: (build) => ({
    sendContact: build.mutation<{ receipt: ContactReceipt; message: string }, ContactRequest>({
      query: (body) => ({ url: '/contact', method: 'POST', body }),
      transformResponse: (r: ApiResponse<ContactReceipt>) => ({ receipt: r.data, message: r.message ?? 'Message sent.' }),
      invalidatesTags: ['SiteHealth'],
    }),
    siteHealth: build.query<SiteHealth, number>({
      query: (days) => ({ url: '/site-health', params: { days } }),
      transformResponse: unwrap<SiteHealth>,
      providesTags: ['SiteHealth'],
    }),
    markContactHandled: build.mutation<ContactMessage, { id: number; handled: boolean }>({
      query: ({ id, handled }) => ({ url: `/site-health/contact/${id}`, method: 'PATCH', body: { handled } }),
      transformResponse: unwrap<ContactMessage>,
      invalidatesTags: ['SiteHealth'],
    }),
    aiModels: build.query<AiModel[], void>({
      query: () => '/ai/models',
      transformResponse: unwrap<AiModel[]>,
      providesTags: ['AiStatus'],
    }),
    arenaScoreboard: build.query<ArenaScoreboard, void>({
      query: () => '/arena/scoreboard',
      transformResponse: unwrap<ArenaScoreboard>,
      providesTags: ['Arena'],
    }),
    arenaVote: build.mutation<ArenaScoreboard, ArenaVoteRequest>({
      query: (body) => ({ url: '/arena/votes', method: 'POST', body }),
      transformResponse: unwrap<ArenaScoreboard>,
      // The vote's answer is the new scoreboard: show it at once, without asking again.
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          // (updateQueryData, not upsertQueryData: upserted values go through transformResponse again.)
          dispatch(siteEndpoints.util.updateQueryData('arenaScoreboard', undefined, () => data));
        } catch {
          /* the page shows the error */
        }
      },
      invalidatesTags: ['SiteHealth'],
    }),
  }),
});

export const { useSendContactMutation, useSiteHealthQuery, useMarkContactHandledMutation, useAiModelsQuery, useArenaScoreboardQuery, useArenaVoteMutation } = siteEndpoints;
