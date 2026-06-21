package model

import (
	"sort"
	"time"

	"gorm.io/gorm"
)

type YcTokenAnalyticsItem struct {
	TokenId      int    `json:"token_id"`
	TokenName    string `json:"token_name"`
	UserId       int    `json:"user_id"`
	Username     string `json:"username"`
	Count        int64  `json:"count"`
	Quota        int64  `json:"quota"`
	TokenUsed    int64  `json:"token_used"`
	SuccessCount int64  `json:"success_count"`
	ErrorCount   int64  `json:"error_count"`
	LastUsedAt   int64  `json:"last_used_at"`
}

type YcTokenAnalyticsTrendItem struct {
	TokenId   int    `json:"token_id"`
	TokenName string `json:"token_name"`
	Username  string `json:"username"`
	CreatedAt int64  `json:"created_at"`
	Count     int64  `json:"count"`
	Quota     int64  `json:"quota"`
	TokenUsed int64  `json:"token_used"`
}

type YcTokenAnalyticsUserOption struct {
	Id          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
}

type YcTokenAnalyticsTokenOption struct {
	Id       int    `json:"id"`
	Name     string `json:"name"`
	UserId   int    `json:"user_id"`
	Username string `json:"username"`
}

type YcTokenAnalyticsData struct {
	Items        []YcTokenAnalyticsItem        `json:"items"`
	Trend        []YcTokenAnalyticsTrendItem   `json:"trend"`
	UserOptions  []YcTokenAnalyticsUserOption  `json:"user_options"`
	TokenOptions []YcTokenAnalyticsTokenOption `json:"token_options"`
}

type tokenAnalyticsRawLog struct {
	TokenId          int
	TokenName        string
	Username         string
	CreatedAt        int64
	Quota            int
	PromptTokens     int
	CompletionTokens int
}

func applyYcTokenAnalyticsFilters(tx *gorm.DB, startTime int64, endTime int64, userIds []int, tokenIds []int) *gorm.DB {
	tx = tx.Where("created_at >= ? AND created_at <= ?", startTime, endTime).
		Where("token_id > 0").
		Where("type IN ?", []int{LogTypeConsume, LogTypeError})
	if len(userIds) > 0 {
		tx = tx.Where("user_id IN ?", userIds)
	}
	if len(tokenIds) > 0 {
		tx = tx.Where("token_id IN ?", tokenIds)
	}
	return tx
}

func GetYcTokenAnalytics(startTime int64, endTime int64, userIds []int, tokenIds []int, limit int) (*YcTokenAnalyticsData, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}

	items, err := getYcTokenAnalyticsItems(startTime, endTime, userIds, tokenIds, limit)
	if err != nil {
		return nil, err
	}

	trend, err := getYcTokenAnalyticsTrend(startTime, endTime, userIds, tokenIds, items)
	if err != nil {
		return nil, err
	}

	userOptions, err := getYcTokenAnalyticsUserOptions()
	if err != nil {
		return nil, err
	}

	tokenOptions, err := getYcTokenAnalyticsTokenOptions(userIds)
	if err != nil {
		return nil, err
	}

	return &YcTokenAnalyticsData{
		Items:        items,
		Trend:        trend,
		UserOptions:  userOptions,
		TokenOptions: tokenOptions,
	}, nil
}

func getYcTokenAnalyticsItems(startTime int64, endTime int64, userIds []int, tokenIds []int, limit int) ([]YcTokenAnalyticsItem, error) {
	tx := applyYcTokenAnalyticsFilters(LOG_DB.Model(&Log{}), startTime, endTime, userIds, tokenIds).
		Select(
			"token_id, MAX(token_name) AS token_name, MAX(user_id) AS user_id, MAX(username) AS username, COUNT(*) AS count, SUM(quota) AS quota, SUM(prompt_tokens + completion_tokens) AS token_used, SUM(CASE WHEN type = ? THEN 1 ELSE 0 END) AS success_count, SUM(CASE WHEN type = ? THEN 1 ELSE 0 END) AS error_count, MAX(created_at) AS last_used_at",
			LogTypeConsume,
			LogTypeError,
		).
		Group("token_id").
		Order("quota DESC").
		Limit(limit)

	var items []YcTokenAnalyticsItem
	if err := tx.Scan(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func getYcTokenAnalyticsTrend(startTime int64, endTime int64, userIds []int, tokenIds []int, items []YcTokenAnalyticsItem) ([]YcTokenAnalyticsTrendItem, error) {
	if len(items) == 0 {
		return []YcTokenAnalyticsTrendItem{}, nil
	}

	topTokenIds := make([]int, 0, len(items))
	for _, item := range items {
		topTokenIds = append(topTokenIds, item.TokenId)
	}
	if len(tokenIds) == 0 {
		tokenIds = topTokenIds
	}

	var rows []tokenAnalyticsRawLog
	err := applyYcTokenAnalyticsFilters(LOG_DB.Model(&Log{}), startTime, endTime, userIds, tokenIds).
		Select("token_id, token_name, username, created_at, quota, prompt_tokens, completion_tokens").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	bucketSeconds := int64(24 * time.Hour / time.Second)
	if endTime-startTime <= int64(24*time.Hour/time.Second) {
		bucketSeconds = int64(time.Hour / time.Second)
	}

	type bucketKey struct {
		TokenId   int
		CreatedAt int64
	}
	bucketMap := make(map[bucketKey]*YcTokenAnalyticsTrendItem)
	for _, row := range rows {
		bucket := (row.CreatedAt / bucketSeconds) * bucketSeconds
		key := bucketKey{TokenId: row.TokenId, CreatedAt: bucket}
		item, ok := bucketMap[key]
		if !ok {
			item = &YcTokenAnalyticsTrendItem{
				TokenId:   row.TokenId,
				TokenName: row.TokenName,
				Username:  row.Username,
				CreatedAt: bucket,
			}
			bucketMap[key] = item
		}
		item.Count++
		item.Quota += int64(row.Quota)
		item.TokenUsed += int64(row.PromptTokens + row.CompletionTokens)
	}

	trend := make([]YcTokenAnalyticsTrendItem, 0, len(bucketMap))
	for _, item := range bucketMap {
		trend = append(trend, *item)
	}
	sort.Slice(trend, func(i, j int) bool {
		if trend[i].CreatedAt == trend[j].CreatedAt {
			return trend[i].TokenName < trend[j].TokenName
		}
		return trend[i].CreatedAt < trend[j].CreatedAt
	})

	return trend, nil
}

func getYcTokenAnalyticsUserOptions() ([]YcTokenAnalyticsUserOption, error) {
	var options []YcTokenAnalyticsUserOption
	err := DB.Model(&User{}).
		Select("id, username, display_name").
		Where("username <> ''").
		Order("id DESC").
		Limit(500).
		Scan(&options).Error
	if err != nil {
		return nil, err
	}
	return options, nil
}

func getYcTokenAnalyticsTokenOptions(userIds []int) ([]YcTokenAnalyticsTokenOption, error) {
	tx := DB.Model(&Token{}).
		Select("tokens.id, tokens.name, tokens.user_id, users.username").
		Joins("LEFT JOIN users ON users.id = tokens.user_id").
		Where("tokens.name <> ''").
		Order("tokens.accessed_time DESC").
		Limit(500)
	if len(userIds) > 0 {
		tx = tx.Where("tokens.user_id IN ?", userIds)
	}

	var options []YcTokenAnalyticsTokenOption
	if err := tx.Scan(&options).Error; err != nil {
		return nil, err
	}
	return options, nil
}
