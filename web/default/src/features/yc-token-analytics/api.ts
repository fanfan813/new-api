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
import { api } from '@/lib/api'
import type { YcTokenAnalyticsData } from './types'

export async function getYcTokenAnalytics(params: {
  start_timestamp: number
  end_timestamp: number
  limit?: number
  user_ids?: number[]
  token_ids?: number[]
}) {
  const searchParams = new URLSearchParams({
    start_timestamp: String(params.start_timestamp),
    end_timestamp: String(params.end_timestamp),
  })
  if (params.limit) searchParams.set('limit', String(params.limit))
  for (const id of params.user_ids ?? []) {
    searchParams.append('user_ids', String(id))
  }
  for (const id of params.token_ids ?? []) {
    searchParams.append('token_ids', String(id))
  }

  const res = await api.get<{ success: boolean; data: YcTokenAnalyticsData }>(
    `/api/data/yc-tokens?${searchParams.toString()}`
  )
  return res.data
}
