/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { VChart } from '@visactor/react-vchart'
import { KeyRound, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatNumber, formatQuota, formatTimestamp } from '@/lib/format'
import {
  formatChartTime,
  getEndOfDay,
  getRollingDateRange,
  getStartOfDay,
  type TimeGranularity,
} from '@/lib/time'
import { VCHART_OPTION } from '@/lib/vchart'
import { useThemeCustomization } from '@/context/theme-customization-provider'
import { useTheme } from '@/context/theme-provider'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { MultiSelect } from '@/components/multi-select'
import { getTokenAnalytics } from '@/features/dashboard/api'
import {
  getDefaultDays,
  getSavedGranularity,
  saveGranularity,
} from '@/features/dashboard/lib'
import type {
  TokenAnalyticsItem,
  TokenAnalyticsTokenOption,
} from '@/features/dashboard/types'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'

let themeManagerPromise: Promise<
  (typeof import('@visactor/vchart'))['ThemeManager']
> | null = null

const TOP_TOKEN_LIMIT_OPTIONS = [5, 10, 20, 50]
const TOKEN_UNIT_OPTIONS = ['K', 'M'] as const
const TOKEN_TIME_RANGE_PRESETS = [
  { label: 'Today', value: 'today', days: 1 },
  { label: '1 Day', value: '1', days: 1 },
  { label: '7 Days', value: '7', days: 7 },
  { label: '30 Days', value: '30', days: 30 },
] as const
const TOKEN_TIME_GRANULARITY_OPTIONS = [
  { label: 'Hour', value: 'hour' },
  { label: 'Day', value: 'day' },
] as const
const ONE_DAY_SECONDS = 24 * 60 * 60

type TokenUnit = (typeof TOKEN_UNIT_OPTIONS)[number]
type TokenRangeValue =
  | (typeof TOKEN_TIME_RANGE_PRESETS)[number]['value']
  | 'custom'

function toNumberIds(values: string[]) {
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
}

function formatTokenAmount(value: number, unit: TokenUnit) {
  const divisor = unit === 'K' ? 1_000 : 1_000_000
  return `${formatNumber(value / divisor)} ${unit}`
}

function shouldUseHourlyGranularity(
  startTimestamp: number,
  endTimestamp: number
) {
  return endTimestamp - startTimestamp <= ONE_DAY_SECONDS
}

function getTodayRange() {
  const now = new Date()
  return {
    start: getStartOfDay(now),
    end: new Date(Math.min(now.getTime(), getEndOfDay(now).getTime())),
  }
}

export function TokenCharts() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { resolvedTheme } = useTheme()
  const { customization } = useThemeCustomization()
  const [themeReady, setThemeReady] = useState(false)
  const themeManagerRef = useRef<
    (typeof import('@visactor/vchart'))['ThemeManager'] | null
  >(null)

  const [timeGranularity, setTimeGranularity] = useState<TimeGranularity>(() =>
    getSavedGranularity()
  )
  const [selectedRange, setSelectedRange] = useState<TokenRangeValue>(
    () => String(getDefaultDays(timeGranularity)) as TokenRangeValue
  )
  const [topTokenLimit, setTopTokenLimit] = useState(10)
  const [tokenUnit, setTokenUnit] = useState<TokenUnit>('K')
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [selectedTokenIds, setSelectedTokenIds] = useState<string[]>([])
  const [draftUserIds, setDraftUserIds] = useState<string[]>([])
  const [draftTokenIds, setDraftTokenIds] = useState<string[]>([])
  const [timeRange, setTimeRange] = useState(() => {
    const days = getDefaultDays(timeGranularity)
    const { start, end } = getRollingDateRange(days)
    return {
      start_timestamp: Math.floor(start.getTime() / 1000),
      end_timestamp: Math.floor(end.getTime() / 1000),
    }
  })

  const handleRangeChange = useCallback((value: TokenRangeValue) => {
    if (value === 'custom') return

    const preset = TOKEN_TIME_RANGE_PRESETS.find((item) => item.value === value)
    if (!preset) return

    setSelectedRange(value)
    const { start, end } =
      value === 'today' ? getTodayRange() : getRollingDateRange(preset.days)
    const startTimestamp = Math.floor(start.getTime() / 1000)
    const endTimestamp = Math.floor(end.getTime() / 1000)
    setTimeRange({
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    })
    if (shouldUseHourlyGranularity(startTimestamp, endTimestamp)) {
      setTimeGranularity('hour')
      saveGranularity('hour')
    }
  }, [])

  const handleDateRangeChange = useCallback(
    ({ start, end }: { start?: Date; end?: Date }) => {
      const startTimestamp = Math.floor((start?.getTime() ?? Date.now()) / 1000)
      const endTimestamp = Math.floor((end?.getTime() ?? Date.now()) / 1000)
      setSelectedRange('custom')
      setTimeRange({
        start_timestamp: startTimestamp,
        end_timestamp: endTimestamp,
      })
      if (shouldUseHourlyGranularity(startTimestamp, endTimestamp)) {
        setTimeGranularity('hour')
        saveGranularity('hour')
      }
    },
    []
  )

  const handleGranularityChange = useCallback(
    (g: TimeGranularity) => {
      setTimeGranularity(g)
      saveGranularity(g)
      const value = String(getDefaultDays(g)) as TokenRangeValue
      if (selectedRange !== 'custom' && value !== selectedRange) {
        handleRangeChange(value)
      }
    },
    [selectedRange, handleRangeChange]
  )

  useEffect(() => {
    const updateTheme = async () => {
      setThemeReady(false)
      if (!themeManagerPromise) {
        themeManagerPromise = import('@visactor/vchart').then(
          (m) => m.ThemeManager
        )
      }
      const ThemeManager = await themeManagerPromise
      themeManagerRef.current = ThemeManager
      ThemeManager.setCurrentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
      setThemeReady(true)
    }
    updateTheme()
  }, [resolvedTheme])

  const { data: tokenAnalytics, isLoading } = useQuery({
    queryKey: [
      'dashboard',
      'token-analytics',
      timeRange,
      topTokenLimit,
      selectedUserIds,
      selectedTokenIds,
    ],
    queryFn: () =>
      getTokenAnalytics({
        ...timeRange,
        limit: topTokenLimit,
        user_ids: toNumberIds(selectedUserIds),
        token_ids: toNumberIds(selectedTokenIds),
      }),
    select: (res) => (res.success ? res.data : undefined),
    staleTime: 60_000,
  })

  const userOptions = useMemo(
    () =>
      (tokenAnalytics?.user_options ?? []).map((option) => ({
        value: String(option.id),
        label: option.username,
      })),
    [tokenAnalytics?.user_options]
  )

  const tokenOptions = useMemo(
    () =>
      (tokenAnalytics?.token_options ?? []).map(
        (option: TokenAnalyticsTokenOption) => ({
          value: String(option.id),
          label: option.name,
          trailingLabel: option.username,
        })
      ),
    [tokenAnalytics?.token_options]
  )

  useEffect(() => {
    if (selectedTokenIds.length === 0 || tokenOptions.length === 0) return
    const available = new Set(tokenOptions.map((option) => option.value))
    const next = selectedTokenIds.filter((id) => available.has(id))
    if (next.length !== selectedTokenIds.length) {
      setSelectedTokenIds(next)
      setDraftTokenIds(next)
    }
  }, [selectedTokenIds, tokenOptions])

  const filtersDirty =
    draftUserIds.join(',') !== selectedUserIds.join(',') ||
    draftTokenIds.join(',') !== selectedTokenIds.join(',')

  const handleApplyFilters = useCallback(() => {
    setSelectedUserIds(draftUserIds)
    setSelectedTokenIds(draftTokenIds)
  }, [draftTokenIds, draftUserIds])

  const rankSpec = useMemo(() => {
    const values = (tokenAnalytics?.items ?? []).map((item) => ({
      Token: item.token_name || `#${item.token_id}`,
      User: item.username,
      Usage: item.quota,
      TokenUsed: item.token_used,
    }))
    type RankDatum = (typeof values)[number]
    const buildRankTooltip = (datum: RankDatum) => [
      {
        hasShape: false,
        key: t('Token Name'),
        value: datum.Token,
      },
      {
        hasShape: false,
        key: t('Username'),
        value: datum.User,
      },
      {
        hasShape: false,
        key: t('Quota'),
        value: formatQuota(Number(datum.Usage) || 0),
      },
      {
        hasShape: false,
        key: t('Token Amount'),
        value: formatTokenAmount(Number(datum.TokenUsed) || 0, tokenUnit),
      },
    ]
    return {
      type: 'bar',
      data: [{ id: 'rankData', values }],
      xField: 'Token',
      yField: 'Usage',
      seriesField: 'Token',
      legends: { visible: true, selectMode: 'single' },
      title: {
        visible: true,
        text: t('Token Consumption Ranking'),
      },
      axes: [
        { orient: 'bottom', type: 'band' },
        {
          orient: 'left',
          type: 'linear',
          title: { visible: true, text: t('Quota') },
          label: {
            formatMethod: (value: number | string) =>
              formatQuota(Number(value) || 0),
          },
        },
      ],
      tooltip: {
        mark: {
          content: [
            {
              hasShape: false,
              key: t('Token Name'),
              value: (datum: RankDatum) => datum.Token,
            },
            {
              hasShape: false,
              key: t('Username'),
              value: (datum: RankDatum) => datum.User,
            },
            {
              hasShape: false,
              key: t('Quota'),
              value: (datum: RankDatum) =>
                formatQuota(Number(datum.Usage) || 0),
            },
            {
              hasShape: false,
              key: t('Token Amount'),
              value: (datum: RankDatum) =>
                formatTokenAmount(Number(datum.TokenUsed) || 0, tokenUnit),
            },
          ],
        },
        dimension: {
          updateContent: (
            items: Array<{
              datum?: RankDatum
              key?: string | number
              value?: string | number
            }>
          ) => {
            const datum = items.find((item) => item.datum)?.datum
            return datum ? buildRankTooltip(datum) : items
          },
        },
      },
    }
  }, [t, tokenAnalytics?.items, tokenUnit])

  const trendSpec = useMemo(() => {
    const values = (tokenAnalytics?.trend ?? []).map((item) => ({
      Time: formatChartTime(item.created_at, timeGranularity),
      Token: item.token_name || `#${item.token_id}`,
      Usage: item.quota,
    }))
    return {
      type: 'area',
      data: [{ id: 'trendData', values }],
      xField: 'Time',
      yField: 'Usage',
      seriesField: 'Token',
      stack: true,
      legends: { visible: true, selectMode: 'single' },
      title: {
        visible: true,
        text: t('Token Consumption Trend'),
      },
      axes: [
        { orient: 'bottom', type: 'band' },
        {
          orient: 'left',
          type: 'linear',
          title: { visible: true, text: t('Quota') },
          label: {
            formatMethod: (value: number | string) =>
              formatQuota(Number(value) || 0),
          },
        },
      ],
      tooltip: {
        dimension: {
          updateContent: (items: { key: string; value: number }[]) =>
            items.map((item) => ({
              ...item,
              value: formatQuota(Number(item.value) || 0),
            })),
        },
      },
    }
  }, [t, timeGranularity, tokenAnalytics?.trend])

  const columns = useMemo<StaticDataTableColumn<TokenAnalyticsItem>[]>(
    () => [
      {
        id: 'token',
        header: t('Token Name'),
        className: 'w-[24%]',
        cell: (row) => (
          <div className='min-w-0'>
            <div className='truncate font-medium'>
              {row.token_name || `#${row.token_id}`}
            </div>
            <div className='text-muted-foreground truncate text-xs'>
              #{row.token_id}
            </div>
          </div>
        ),
      },
      {
        id: 'username',
        header: t('Username'),
        className: 'w-[14%]',
        cell: (row) => row.username || '-',
      },
      {
        id: 'count',
        header: t('Requests'),
        className: 'w-[10%] text-right',
        cellClassName: 'text-right font-mono tabular-nums',
        cell: (row) => formatNumber(row.count),
      },
      {
        id: 'quota',
        header: t('Quota'),
        className: 'w-[12%] text-right',
        cellClassName: 'text-right font-mono tabular-nums',
        cell: (row) => formatQuota(row.quota),
      },
      {
        id: 'tokens',
        header: t('Token Amount'),
        className: 'w-[12%] text-right',
        cellClassName: 'text-right font-mono tabular-nums',
        cell: (row) => formatTokenAmount(row.token_used, tokenUnit),
      },
      {
        id: 'errors',
        header: t('Errors'),
        className: 'w-[8%] text-right',
        cellClassName: 'text-right font-mono tabular-nums',
        cell: (row) => formatNumber(row.error_count),
      },
      {
        id: 'last_used',
        header: t('Last Used'),
        className: 'w-[14%]',
        cell: (row) => formatTimestamp(row.last_used_at),
      },
      {
        id: 'actions',
        header: '',
        className: 'w-[6%]',
        cellClassName: 'text-right',
        cell: (row) => (
          <Button
            variant='ghost'
            size='sm'
            onClick={() =>
              void navigate({
                to: '/usage-logs/$section',
                params: { section: 'common' },
                search: {
                  page: 1,
                  startTime: timeRange.start_timestamp * 1000,
                  endTime: timeRange.end_timestamp * 1000,
                  token: row.token_name,
                  username: row.username,
                  type: ['0'],
                },
              })
            }
          >
            {t('View Logs')}
          </Button>
        ),
      },
    ],
    [navigate, t, timeRange.end_timestamp, timeRange.start_timestamp, tokenUnit]
  )

  const chartKey = [
    topTokenLimit,
    selectedUserIds.join(','),
    selectedTokenIds.join(','),
    timeGranularity,
    resolvedTheme,
    customization.preset,
  ].join('-')

  const userSummary =
    draftUserIds.length > 0
      ? t('{{count}} selected', { count: draftUserIds.length })
      : undefined
  const tokenSummary =
    draftTokenIds.length > 0
      ? t('{{count}} selected', { count: draftTokenIds.length })
      : undefined

  return (
    <div className='space-y-3'>
      <div className='flex flex-col gap-2 lg:flex-row lg:items-start'>
        <div className='flex items-center gap-1.5 overflow-x-auto pb-1 sm:gap-2'>
          <span className='text-muted-foreground shrink-0 text-xs font-medium whitespace-nowrap'>
            {t('Range')}
          </span>
          <Tabs
            value={selectedRange}
            onValueChange={(value) =>
              handleRangeChange(value as TokenRangeValue)
            }
            className='shrink-0'
          >
            <TabsList>
              {TOKEN_TIME_RANGE_PRESETS.map((preset) => (
                <TabsTrigger
                  key={preset.value}
                  value={preset.value}
                  className='px-2.5 text-xs'
                >
                  {t(preset.label)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <CompactDateTimeRangePicker
            start={new Date(timeRange.start_timestamp * 1000)}
            end={new Date(timeRange.end_timestamp * 1000)}
            onChange={handleDateRangeChange}
            className='h-9 w-[260px] shrink-0 text-xs'
          />

          <span className='text-muted-foreground ml-1 shrink-0 text-xs font-medium whitespace-nowrap'>
            {t('Granularity')}
          </span>
          <Tabs
            value={timeGranularity}
            onValueChange={(value) =>
              handleGranularityChange(value as TimeGranularity)
            }
            className='shrink-0'
          >
            <TabsList>
              {TOKEN_TIME_GRANULARITY_OPTIONS.map((opt) => (
                <TabsTrigger
                  key={opt.value}
                  value={opt.value}
                  className='px-2.5 text-xs'
                >
                  {t(opt.label)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Tabs
            value={String(topTokenLimit)}
            onValueChange={(value) => setTopTokenLimit(Number(value))}
            className='shrink-0'
          >
            <TabsList>
              <span className='text-muted-foreground px-2 text-xs font-medium whitespace-nowrap'>
                {t('Top Tokens')}
              </span>
              {TOP_TOKEN_LIMIT_OPTIONS.map((limit) => (
                <TabsTrigger
                  key={limit}
                  value={String(limit)}
                  className='px-2.5 text-xs'
                >
                  {t('Top {{count}}', { count: limit })}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Tabs
            value={tokenUnit}
            onValueChange={(value) => setTokenUnit(value as TokenUnit)}
            className='shrink-0'
          >
            <TabsList>
              <span className='text-muted-foreground px-2 text-xs font-medium whitespace-nowrap'>
                {t('Unit')}
              </span>
              {TOKEN_UNIT_OPTIONS.map((unit) => (
                <TabsTrigger key={unit} value={unit} className='px-2.5 text-xs'>
                  {unit}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {isLoading && (
            <Loader2 className='text-muted-foreground size-4 animate-spin' />
          )}
        </div>

        <div className='grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:w-[520px] lg:flex-none'>
          <MultiSelect
            options={userOptions}
            selected={draftUserIds}
            onChange={(values) => {
              setDraftUserIds(values)
              setDraftTokenIds([])
            }}
            placeholder={t('Filter users')}
            emptyText={t('No user found.')}
            showChevron
            selectedSummary={userSummary}
            maxVisibleChips={2}
          />
          <MultiSelect
            options={tokenOptions}
            selected={draftTokenIds}
            onChange={setDraftTokenIds}
            placeholder={t('Filter tokens')}
            emptyText={t('No token found.')}
            showChevron
            selectedSummary={tokenSummary}
            renderOption={(option) => (
              <span className='flex min-w-0 flex-1 items-center justify-between gap-3'>
                <span className='truncate'>{option.label}</span>
                {option.trailingLabel && (
                  <span className='text-muted-foreground shrink-0 truncate text-xs'>
                    {option.trailingLabel}
                  </span>
                )}
              </span>
            )}
            maxVisibleChips={2}
          />
          <Button
            type='button'
            size='sm'
            className='h-9'
            disabled={!filtersDirty || isLoading}
            onClick={handleApplyFilters}
          >
            {t('Apply')}
          </Button>
        </div>
      </div>

      <div className='grid gap-3'>
        <div className='overflow-hidden rounded-lg border'>
          <div className='flex w-full items-center gap-2 border-b px-3 py-2 sm:px-5 sm:py-3'>
            <KeyRound className='text-muted-foreground/60 size-4' />
            <div className='text-sm font-semibold'>
              {t('Token Consumption Ranking')}
            </div>
          </div>
          <div className='h-[300px] p-1.5 sm:h-96 sm:p-2'>
            {isLoading ? (
              <Skeleton className='h-full w-full' />
            ) : (
              themeReady && (
                <VChart
                  key={`token-rank-${chartKey}`}
                  spec={{
                    ...rankSpec,
                    theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                    background: 'transparent',
                  }}
                  option={VCHART_OPTION}
                />
              )
            )}
          </div>
        </div>

        <div className='overflow-hidden rounded-lg border'>
          <div className='flex w-full items-center gap-2 border-b px-3 py-2 sm:px-5 sm:py-3'>
            <KeyRound className='text-muted-foreground/60 size-4' />
            <div className='text-sm font-semibold'>
              {t('Token Consumption Trend')}
            </div>
          </div>
          <div className='h-[300px] p-1.5 sm:h-96 sm:p-2'>
            {isLoading ? (
              <Skeleton className='h-full w-full' />
            ) : (
              themeReady && (
                <VChart
                  key={`token-trend-${chartKey}`}
                  spec={{
                    ...trendSpec,
                    theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                    background: 'transparent',
                  }}
                  option={VCHART_OPTION}
                />
              )
            )}
          </div>
        </div>

        <div className='overflow-hidden rounded-lg border'>
          <div className='flex w-full items-center gap-2 border-b px-3 py-2 sm:px-5 sm:py-3'>
            <KeyRound className='text-muted-foreground/60 size-4' />
            <div className='text-sm font-semibold'>
              {t('Token Usage Details')}
            </div>
          </div>
          {isLoading ? (
            <div className='p-3'>
              <Skeleton className='h-48 w-full' />
            </div>
          ) : (
            <StaticDataTable
              data={tokenAnalytics?.items ?? []}
              columns={columns}
              getRowKey={(row) => row.token_id}
              emptyContent={t('No data available')}
              tableClassName='table-fixed'
            />
          )}
        </div>
      </div>
    </div>
  )
}
