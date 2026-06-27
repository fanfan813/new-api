package middleware

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExtractUserPromptLogPayloadChatSkipsNonUserAndTools(t *testing.T) {
	body := []byte(`{
		"model": "gpt-test",
		"messages": [
			{"role": "system", "content": "system prompt"},
			{"role": "user", "content": "first question"},
			{"role": "assistant", "content": "assistant answer"},
			{"role": "tool", "tool_call_id": "call_1", "content": "tool result"},
			{"role": "user", "tool_call_id": "call_2", "content": "synthetic tool message"},
			{"role": "user", "content": "latest question"}
		]
	}`)

	payload, ok := ExtractUserPromptLogPayload("/v1/chat/completions", body, 500)

	require.True(t, ok)
	assert.Equal(t, "gpt-test", payload.Model)
	assert.Equal(t, "latest question", payload.Question)
}

func TestExtractUserPromptLogPayloadChatOnlyTextParts(t *testing.T) {
	body := []byte(`{
		"messages": [
			{"role": "user", "content": [
				{"type": "text", "text": "text part 1"},
				{"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
				{"type": "file", "file": {"file_data": "base64"}},
				{"type": "text", "text": "text part 2"}
			]}
		]
	}`)

	payload, ok := ExtractUserPromptLogPayload("/v1/chat/completions", body, 500)

	require.True(t, ok)
	assert.Equal(t, "text part 1\ntext part 2", payload.Question)
}

func TestExtractUserPromptLogPayloadCompletionsStringPrompt(t *testing.T) {
	body := []byte(`{"model":"legacy","prompt":["one", {"ignored": true}, "two"]}`)

	payload, ok := ExtractUserPromptLogPayload("/v1/completions", body, 500)

	require.True(t, ok)
	assert.Equal(t, "legacy", payload.Model)
	assert.Equal(t, "one\ntwo", payload.Question)
}

func TestExtractUserPromptLogPayloadResponsesSkipsToolOutput(t *testing.T) {
	body := []byte(`{
		"model": "gpt-responses",
		"reasoning_effort": "high",
		"instructions": "do not log this",
		"input": [
			{"role": "developer", "content": "developer instruction"},
			{"role": "user", "content": [
				{"type": "input_text", "text": "old user text"},
				{"type": "input_image", "image_url": "data:image/png;base64,abc"}
			]},
			{"type": "function_call_output", "call_id": "call_1", "output": "tool output"},
			{"role": "user", "content": [{"type": "input_text", "text": "好的"}]}
		]
	}`)

	payload, ok := ExtractUserPromptLogPayload("/v1/responses", body, 500)

	require.True(t, ok)
	assert.Equal(t, "gpt-responses", payload.Model)
	assert.Equal(t, "high", payload.ReasoningEffort)
	assert.Equal(t, "好的", payload.Question)
}

func TestExtractUserPromptLogPayloadResponsesUsesLatestUserTextOnly(t *testing.T) {
	body := []byte(`{
		"model": "gpt-responses",
		"input": [
			{"role": "user", "content": [{"type": "input_text", "text": "历史问题包含 股票"}]},
			{"role": "assistant", "content": [{"type": "output_text", "text": "历史回答"}]},
			{"role": "user", "content": [{"type": "input_text", "text": "好的"}]}
		]
	}`)

	payload, ok := ExtractUserPromptLogPayload("/v1/responses", body, 500)

	require.True(t, ok)
	assert.Equal(t, "好的", payload.Question)
}

func TestExtractUserPromptLogPayloadResponsesReadsNestedReasoningEffort(t *testing.T) {
	body := []byte(`{
		"model": "gpt-responses",
		"reasoning": {"effort": "medium"},
		"input": [{"role": "user", "content": [{"type": "input_text", "text": "嵌套推理等级"}]}]
	}`)

	payload, ok := ExtractUserPromptLogPayload("/v1/responses", body, 500)

	require.True(t, ok)
	assert.Equal(t, "medium", payload.ReasoningEffort)
	assert.Equal(t, "嵌套推理等级", payload.Question)
}

func TestExtractUserPromptLogPayloadResponsesReadsReasoningEffortFromModelSuffix(t *testing.T) {
	body := []byte(`{
		"model": "gpt-5.5-high",
		"input": [{"role": "user", "content": [{"type": "input_text", "text": "模型后缀推理等级"}]}]
	}`)

	payload, ok := ExtractUserPromptLogPayload("/v1/responses", body, 500)

	require.True(t, ok)
	assert.Equal(t, "high", payload.ReasoningEffort)
	assert.Equal(t, "模型后缀推理等级", payload.Question)
}

func TestExtractUserPromptLogPayloadResponsesSkipsSystemContextBlocks(t *testing.T) {
	body := []byte(`{
		"model": "gpt-responses",
		"input": [
			{"role": "user", "content": [{"type": "input_text", "text": "真实用户问题"}]},
			{"role": "user", "content": [{"type": "input_text", "text": "<environment_context>\n  <cwd>D:\\hongniu_no1</cwd>\n</environment_context>"}]}
		]
	}`)

	payload, ok := ExtractUserPromptLogPayload("/v1/responses", body, 500)

	require.True(t, ok)
	assert.Equal(t, "gpt-responses", payload.Model)
	assert.Equal(t, "真实用户问题", payload.Question)
}

func TestExtractUserPromptLogPayloadTruncatesByRune(t *testing.T) {
	body := []byte(`{"messages":[{"role":"user","content":"你好世界abc"}]}`)

	payload, ok := ExtractUserPromptLogPayload("/v1/chat/completions", body, 4)

	require.True(t, ok)
	assert.Equal(t, "你好世界", payload.Question)
}

func TestExtractUserPromptLogPayloadReturnsFalseWithoutText(t *testing.T) {
	body := []byte(`{"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,abc"}}]}]}`)

	payload, ok := ExtractUserPromptLogPayload("/v1/chat/completions", body, 500)

	require.False(t, ok)
	assert.Empty(t, strings.TrimSpace(payload.Question))
}
