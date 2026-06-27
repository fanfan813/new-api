package logger

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const userPromptLogTimeFormat = "2006-01-02 15:04:05"

type UserPromptLogEntry struct {
	Time            string `json:"time"`
	RequestID       string `json:"request_id,omitempty"`
	TokenName       string `json:"token_name,omitempty"`
	Path            string `json:"path,omitempty"`
	Model           string `json:"model,omitempty"`
	ReasoningEffort string `json:"reasoning_effort,omitempty"`
	Question        string `json:"question"`
}

var userPromptLogState = struct {
	sync.Mutex
	date      string
	file      *os.File
	dedupSeen map[string]time.Time
}{}

func IsUserPromptLogEnabled() bool {
	return common.GetEnvOrDefaultBool("RELAY_USER_PROMPT_LOG_ENABLED", false)
}

func UserPromptLogMaxChars() int {
	maxChars := common.GetEnvOrDefault("RELAY_USER_PROMPT_LOG_MAX_CHARS", 500)
	if maxChars <= 0 {
		return 500
	}
	return maxChars
}

func UserPromptLogDedupDuration() time.Duration {
	seconds := common.GetEnvOrDefault("RELAY_USER_PROMPT_LOG_DEDUP_SECONDS", 0)
	if seconds <= 0 {
		return 0
	}
	return time.Duration(seconds) * time.Second
}

func WriteUserPromptLog(entry UserPromptLogEntry) error {
	if !IsUserPromptLogEnabled() {
		return nil
	}
	if *common.LogDir == "" || entry.Question == "" {
		return nil
	}

	now := time.Now()
	line := formatUserPromptLogLine(now, entry)
	date := now.Format("20060102")
	userPromptLogState.Lock()
	defer userPromptLogState.Unlock()

	if shouldSkipUserPromptLogLocked(entry, now, UserPromptLogDedupDuration()) {
		return nil
	}
	if userPromptLogState.file == nil || userPromptLogState.date != date {
		if err := rotateUserPromptLogLocked(date); err != nil {
			return err
		}
	}
	_, err := fmt.Fprintf(userPromptLogState.file, "%s\n", line)
	return err
}

func rotateUserPromptLogLocked(date string) error {
	if userPromptLogState.file != nil {
		_ = userPromptLogState.file.Close()
		userPromptLogState.file = nil
	}
	logPath := filepath.Join(*common.LogDir, fmt.Sprintf("user-prompts-%s.log", date))
	file, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	userPromptLogState.date = date
	userPromptLogState.file = file
	return nil
}

func shouldSkipUserPromptLogLocked(entry UserPromptLogEntry, now time.Time, dedupDuration time.Duration) bool {
	if dedupDuration <= 0 {
		return false
	}
	if userPromptLogState.dedupSeen == nil {
		userPromptLogState.dedupSeen = make(map[string]time.Time)
	}

	// 去重只针对同一实例进程内的短时间重复请求；跨实例/重启后不保留状态。
	for key, seenAt := range userPromptLogState.dedupSeen {
		if now.Sub(seenAt) > dedupDuration {
			delete(userPromptLogState.dedupSeen, key)
		}
	}

	key := userPromptLogDedupKey(entry)
	if seenAt, ok := userPromptLogState.dedupSeen[key]; ok && now.Sub(seenAt) <= dedupDuration {
		return true
	}
	userPromptLogState.dedupSeen[key] = now
	return false
}

func userPromptLogDedupKey(entry UserPromptLogEntry) string {
	return strings.Join([]string{
		entry.TokenName,
		entry.Model,
		entry.ReasoningEffort,
		entry.Path,
		entry.Question,
	}, "\x00")
}

func formatUserPromptLogLine(now time.Time, entry UserPromptLogEntry) string {
	return fmt.Sprintf(`%s.%03d token="%s" model="%s" reasoning_effort="%s" path="%s" question="%s"`,
		now.Format(userPromptLogTimeFormat),
		now.Nanosecond()/int(time.Millisecond),
		escapeUserPromptLogValue(entry.TokenName),
		escapeUserPromptLogValue(entry.Model),
		escapeUserPromptLogValue(entry.ReasoningEffort),
		escapeUserPromptLogValue(entry.Path),
		escapeUserPromptLogValue(entry.Question),
	)
}

func escapeUserPromptLogValue(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	value = strings.ReplaceAll(value, "\r\n", `\n`)
	value = strings.ReplaceAll(value, "\n", `\n`)
	value = strings.ReplaceAll(value, "\r", `\n`)
	value = strings.ReplaceAll(value, "\t", `\t`)
	return value
}
