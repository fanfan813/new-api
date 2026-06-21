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
import { cn } from '@/lib/utils'
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
import { YcMultiSelect } from '@/components/yc-multi-select'
import { getYcTokenAnalytics } from '@/features/yc-token-analytics/api'
import {
  getDefaultDays,
  getSavedGranularity,
  saveGranularity,
} from '@/features/dashboard/lib'
import type {
  YcTokenAnalyticsItem,
  YcTokenAnalyticsTokenOption,
} from '@/features/yc-token-analytics/types'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'

let themeManagerPromise: Promise<
  (typeof import('@visactor/vchart'))['ThemeManager']
> | null = null

const TOP_TOKEN_LIMIT_OPTIONS = [5, 10, 20, 50]
const TOKEN_UNIT_OPTIONS = ['K', 'M'] as const
const TOKEN_CHART_METRIC_OPTIONS = ['quota', 'tokens'] as const
const TOKEN_CHART_COLORS = [
  '#1664FF',
  '#1AC6FF',
  '#FF8A00',
  '#3CC780',
  '#7442D4',
  '#FFC400',
  '#304D77',
  '#B48DEB',
  '#009DB5',
  '#FF6B6B',
]
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
type TokenChartMetric = (typeof TOKEN_CHART_METRIC_OPTIONS)[number]
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

function YcTokenUnitSwitch({
  value,
  onChange,
  label,
}: {
  value: TokenUnit
  onChange: (value: TokenUnit) => void
  label: string
}) {
  return (
    <div className='bg-muted text-muted-foreground inline-flex h-9 shrink-0 items-center rounded-lg p-1 text-xs font-medium'>
      <span className='px-2 whitespace-nowrap'>{label}</span>
      <div className='relative grid h-7 w-20 grid-cols-2 rounded-md'>
        <span
          className={cn(
            'bg-background shadow-xs absolute inset-y-0 left-0 w-1/2 rounded-md transition-transform duration-200 ease-out',
            value === 'M' && 'translate-x-full'
          )}
          aria-hidden='true'
        />
        {TOKEN_UNIT_OPTIONS.map((unit) => (
          <button
            key={unit}
            type='button'
            className={cn(
              'relative z-10 flex items-center justify-center rounded-md text-xs font-semibold transition-colors duration-200',
              value === unit
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            aria-pressed={value === unit}
            onClick={() => onChange(unit)}
          >
            {unit}
          </button>
        ))}
      </div>
    </div>
  )
}

function YcTokenMetricSwitch({
  value,
  onChange,
  quotaLabel,
  tokensLabel,
}: {
  value: TokenChartMetric
  onChange: (value: TokenChartMetric) => void
  quotaLabel: string
  tokensLabel: string
}) {
  const options = [
    { value: 'quota' as const, label: quotaLabel },
    { value: 'tokens' as const, label: tokensLabel },
  ]

  return (
    <div className='bg-muted text-muted-foreground inline-flex h-9 shrink-0 items-center rounded-lg p-1 text-xs font-medium'>
      <div className='relative grid h-7 w-28 grid-cols-2 rounded-md'>
        <span
          className={cn(
            'bg-background shadow-xs absolute inset-y-0 left-0 w-1/2 rounded-md transition-transform duration-200 ease-out',
            value === 'tokens' && 'translate-x-full'
          )}
          aria-hidden='true'
        />
        {options.map((option) => (
          <button
            key={option.value}
            type='button'
            className={cn(
              'relative z-10 flex items-center justify-center rounded-md text-xs font-semibold transition-colors duration-200',
              value === option.value
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
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

export function YcTokenCharts() {
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
  const [chartMetric, setChartMetric] = useState<TokenChartMetric>('quota')
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [selectedTokenIds, setSelectedTokenIds] = useState<string[]>([])
  const [draftUserIds, setDraftUserIds] = useState<string[]>([])
  const [draftTokenIds, setDraftTokenIds] = useState<string[]>([])
  const [disabledChartTokens, setDisabledChartTokens] = useState<string[]>([])
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
      'yc-token-analytics',
      timeRange,
      topTokenLimit,
      selectedUserIds,
      selectedTokenIds,
    ],
    queryFn: () =>
      getYcTokenAnalytics({
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
        (option: YcTokenAnalyticsTokenOption) => ({
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

  const tokenLegendItems = useMemo(() => {
    const seen = new Set<string>()
    return (tokenAnalytics?.items ?? []).reduce<string[]>((items, item) => {
      const token = item.token_name || `#${item.token_id}`
      if (!seen.has(token)) {
        seen.add(token)
        items.push(token)
      }
      return items
    }, [])
  }, [tokenAnalytics?.items])

  const handleSelectChartToken = useCallback((token: string | null) => {
    if (token === null) {
      setDisabledChartTokens((current) =>
        current.length === 0 ? tokenLegendItems : []
      )
      return
    }

    setDisabledChartTokens((current) =>
      current.includes(token)
        ? current.filter((item) => item !== token)
        : [...current, token]
    )
  }, [tokenLegendItems])

  const chartColorMap = useMemo(
    () =>
      Object.fromEntries(
        tokenLegendItems.map((token, index) => [
          token,
          TOKEN_CHART_COLORS[index % TOKEN_CHART_COLORS.length],
        ])
      ),
    [tokenLegendItems]
  )

  useEffect(() => {
    if (disabledChartTokens.length === 0) return

    const available = new Set(tokenLegendItems)
    const next = disabledChartTokens.filter((token) => available.has(token))
    if (next.length !== disabledChartTokens.length) {
      setDisabledChartTokens(next)
    }
  }, [disabledChartTokens, tokenLegendItems])

  const rankSpec = useMemo(() => {
    const metricLabel =
      chartMetric === 'quota' ? t('Quota') : t('Token Amount')
    const values = (tokenAnalytics?.items ?? [])
      .map((item) => ({
        Token: item.token_name || `#${item.token_id}`,
        User: item.username,
        Usage: chartMetric === 'quota' ? item.quota : item.token_used,
        TokenUsed: item.token_used,
      }))
      .filter(
        (item) =>
          disabledChartTokens.length === 0 ||
          !disabledChartTokens.includes(item.Token)
      )
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
        key: metricLabel,
        value:
          chartMetric === 'quota'
            ? formatQuota(Number(datum.Usage) || 0)
            : formatTokenAmount(Number(datum.Usage) || 0, tokenUnit),
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
      legends: { visible: false },
      color: { specified: chartColorMap },
      title: {
        visible: false,
        text: t('Token Consumption Ranking'),
      },
      axes: [
        { orient: 'bottom', type: 'band' },
        {
          orient: 'left',
          type: 'linear',
          title: { visible: false },
          label: {
            formatMethod: (value: number | string) =>
              chartMetric === 'quota'
                ? formatQuota(Number(value) || 0)
                : formatTokenAmount(Number(value) || 0, tokenUnit),
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
              key: metricLabel,
              value: (datum: RankDatum) =>
                chartMetric === 'quota'
                  ? formatQuota(Number(datum.Usage) || 0)
                  : formatTokenAmount(Number(datum.Usage) || 0, tokenUnit),
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
  }, [
    chartColorMap,
    chartMetric,
    disabledChartTokens,
    t,
    tokenAnalytics?.items,
    tokenUnit,
  ])

  const trendSpec = useMemo(() => {
    const values = (tokenAnalytics?.trend ?? [])
      .map((item) => ({
        Time: formatChartTime(item.created_at, timeGranularity),
        Token: item.token_name || `#${item.token_id}`,
        Usage: chartMetric === 'quota' ? item.quota : item.token_used,
      }))
      .filter(
        (item) =>
          disabledChartTokens.length === 0 ||
          !disabledChartTokens.includes(item.Token)
      )
    return {
      type: 'area',
      data: [{ id: 'trendData', values }],
      xField: 'Time',
      yField: 'Usage',
      seriesField: 'Token',
      stack: true,
      legends: { visible: false },
      color: { specified: chartColorMap },
      title: {
        visible: false,
        text: t('Token Consumption Trend'),
      },
      axes: [
        { orient: 'bottom', type: 'band' },
        {
          orient: 'left',
          type: 'linear',
          title: { visible: false },
          label: {
            formatMethod: (value: number | string) =>
              chartMetric === 'quota'
                ? formatQuota(Number(value) || 0)
                : formatTokenAmount(Number(value) || 0, tokenUnit),
          },
        },
      ],
      tooltip: {
        dimension: {
          updateContent: (items: { key: string; value: number }[]) =>
            items.map((item) => ({
              ...item,
              value:
                chartMetric === 'quota'
                  ? formatQuota(Number(item.value) || 0)
                  : formatTokenAmount(Number(item.value) || 0, tokenUnit),
            })),
        },
      },
    }
  }, [
    chartColorMap,
    chartMetric,
    disabledChartTokens,
    t,
    timeGranularity,
    tokenAnalytics?.trend,
    tokenUnit,
  ])

  const columns = useMemo<StaticDataTableColumn<YcTokenAnalyticsItem>[]>(
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
    chartMetric,
    tokenUnit,
    resolvedTheme,
    customization.preset,
    disabledChartTokens.join(',') || 'all',
  ].join('-')

  const allChartTokensSelected = disabledChartTokens.length === 0
  const chartLegend = tokenLegendItems.length > 0 && (
    <div className='flex flex-wrap items-center gap-1.5 border-t px-3 py-2 sm:px-5'>
      <Button
        type='button'
        variant='ghost'
        size='sm'
        className={cn(
          'border-border/70 h-7 shrink-0 border px-2.5 text-xs',
          allChartTokensSelected && 'bg-muted text-foreground'
        )}
        aria-pressed={allChartTokensSelected}
        onClick={() => handleSelectChartToken(null)}
      >
        {t('All')}
      </Button>
      {tokenLegendItems.map((token) => {
        const selected = !disabledChartTokens.includes(token)
        return (
          <Button
            key={token}
            type='button'
            variant='ghost'
            size='sm'
            className={cn(
              'border-border/70 h-7 min-w-0 max-w-[180px] shrink-0 gap-1.5 border px-2 text-xs',
              selected && 'bg-muted text-foreground',
              !selected && 'opacity-60'
            )}
            aria-pressed={selected}
            onClick={() => handleSelectChartToken(token)}
          >
            <span
              className='size-2.5 shrink-0 rounded-full'
              style={{ backgroundColor: chartColorMap[token] }}
            />
            <span className='truncate'>{token}</span>
          </Button>
        )
      })}
    </div>
  )

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
      <div className='bg-background before:bg-background sticky top-0 z-50 -mt-1 flex flex-col gap-2 border-b pt-3 pb-2 shadow-sm before:absolute before:inset-x-0 before:-top-4 before:h-4 sm:-mt-1.5 sm:pt-3.5 lg:flex-row lg:items-start'>
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

          <YcTokenUnitSwitch
            value={tokenUnit}
            onChange={setTokenUnit}
            label={t('Unit')}
          />

          {isLoading && (
            <Loader2 className='text-muted-foreground size-4 animate-spin' />
          )}
        </div>

        <div className='grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:w-[520px] lg:flex-none'>
          <YcMultiSelect
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
          <YcMultiSelect
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
            <div className='min-w-0 text-sm font-semibold'>
              {t('Token Consumption Ranking')}
            </div>
            <YcTokenMetricSwitch
              value={chartMetric}
              onChange={setChartMetric}
              quotaLabel={t('Quota')}
              tokensLabel={t('Tokens')}
            />
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
          {!isLoading && chartLegend}
        </div>

        <div className='overflow-hidden rounded-lg border'>
          <div className='flex w-full items-center gap-2 border-b px-3 py-2 sm:px-5 sm:py-3'>
            <KeyRound className='text-muted-foreground/60 size-4' />
            <div className='min-w-0 text-sm font-semibold'>
              {t('Token Consumption Trend')}
            </div>
            <YcTokenMetricSwitch
              value={chartMetric}
              onChange={setChartMetric}
              quotaLabel={t('Quota')}
              tokensLabel={t('Tokens')}
            />
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
          {!isLoading && chartLegend}
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
