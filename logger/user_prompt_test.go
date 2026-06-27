package logger

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFormatUserPromptLogLine(t *testing.T) {
	now := time.Date(2026, 6, 27, 22, 9, 42, 420*int(time.Millisecond), time.FixedZone("CST", 8*60*60))

	line := formatUserPromptLogLine(now, UserPromptLogEntry{
		TokenName:       "fanfan1",
		Model:           "gpt-5.5",
		ReasoningEffort: "high",
		Path:            "/v1/responses",
		Question:        "第一行\n第二行\t带 \"quote\"",
	})

	assert.Equal(t, `2026-06-27 22:09:42.420 token="fanfan1" model="gpt-5.5" reasoning_effort="high" path="/v1/responses" question="第一行\n第二行\t带 \"quote\""`, line)
}

func TestShouldSkipUserPromptLogLockedDeduplicatesWithinWindow(t *testing.T) {
	userPromptLogState.Lock()
	defer userPromptLogState.Unlock()
	userPromptLogState.dedupSeen = nil

	now := time.Date(2026, 6, 27, 22, 9, 42, 0, time.UTC)
	entry := UserPromptLogEntry{
		TokenName:       "fanfan1",
		Model:           "gpt-5.5",
		ReasoningEffort: "high",
		Path:            "/v1/responses",
		Question:        "同一个问题",
	}

	require.False(t, shouldSkipUserPromptLogLocked(entry, now, time.Minute))
	require.True(t, shouldSkipUserPromptLogLocked(entry, now.Add(30*time.Second), time.Minute))
	require.False(t, shouldSkipUserPromptLogLocked(entry, now.Add(61*time.Second), time.Minute))

	anotherQuestion := entry
	anotherQuestion.Question = "另一个问题"
	require.False(t, shouldSkipUserPromptLogLocked(anotherQuestion, now.Add(62*time.Second), time.Minute))
}
