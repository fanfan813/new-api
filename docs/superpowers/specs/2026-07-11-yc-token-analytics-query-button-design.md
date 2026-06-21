# YC Token Analytics Query Button Design

## Goal

Change the token analytics filter action from a one-time “Apply” operation to a repeatable “Query” operation. Users must be able to submit unchanged filters again to refresh the latest data.

## Interaction

- The button label is `Query` and uses the existing i18n key with complete translations for all supported locales.
- The button remains enabled whenever no request is in progress.
- During a request, the button is disabled to prevent concurrent duplicate queries.
- Changed draft filters become the active query filters and trigger the normal React Query key change.
- When draft filters already match the active filters, clicking the button calls the current query's `refetch()` method.

## Implementation

Keep draft and active filter state separate. Destructure `isFetching` and `refetch` from the existing `useQuery` result. In the click handler, compare draft and active filters:

1. If they differ, update the active filters and let the changed query key fetch once.
2. If they match, call `refetch()` directly.

Do not add a click counter to the query key and do not invalidate the entire dashboard query namespace; both approaches create broader cache effects than required.

## Error and Loading Behavior

Existing React Query error behavior remains unchanged. The button is disabled only while `isFetching` is true, covering initial load and subsequent refreshes without permanently disabling unchanged filters.

## Verification

- TypeScript typecheck passes.
- Target file lint and formatting checks pass.
- Frontend production build passes.
- Manual behavior: changed filters query once; unchanged filters can be queried repeatedly; rapid clicks during an active request do not create concurrent requests.
