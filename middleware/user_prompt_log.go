package middleware

import (
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/reasoning"
	"github.com/gin-gonic/gin"
)

type userPromptRequest struct {
	Model           string               `json:"model,omitempty"`
	ReasoningEffort string               `json:"reasoning_effort,omitempty"`
	Reasoning       *userPromptReasoning `json:"reasoning,omitempty"`
	Messages        []userPromptMessage  `json:"messages,omitempty"`
	Prompt          any                  `json:"prompt,omitempty"`
	Input           any                  `json:"input,omitempty"`
}

type userPromptReasoning struct {
	Effort string `json:"effort,omitempty"`
}

type userPromptMessage struct {
	Role       string `json:"role,omitempty"`
	Content    any    `json:"content,omitempty"`
	ToolCalls  any    `json:"tool_calls,omitempty"`
	ToolCallID string `json:"tool_call_id,omitempty"`
}

func UserPromptLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !logger.IsUserPromptLogEnabled() || c.Request.Method != http.MethodPost {
			c.Next()
			return
		}

		path := c.Request.URL.Path
		payload, ok := ExtractUserPromptLogPayload(path, mustReadBodyBytes(c), logger.UserPromptLogMaxChars())
		if ok {
			// 用户问题日志包含敏感输入，仅写入单独文件；写入失败不能影响正常 relay 请求。
			_ = logger.WriteUserPromptLog(logger.UserPromptLogEntry{
				RequestID:       c.GetString(common.RequestIdKey),
				TokenName:       c.GetString("token_name"),
				Path:            path,
				Model:           payload.Model,
				ReasoningEffort: payload.ReasoningEffort,
				Question:        payload.Question,
			})
		}

		c.Next()
	}
}

func mustReadBodyBytes(c *gin.Context) []byte {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil
	}
	body, err := storage.Bytes()
	if err != nil {
		return nil
	}
	return body
}

type UserPromptLogPayload struct {
	Model           string
	ReasoningEffort string
	Question        string
}

func ExtractUserPromptLogPayload(path string, body []byte, maxChars int) (UserPromptLogPayload, bool) {
	if !isUserPromptLogPath(path) || len(body) == 0 {
		return UserPromptLogPayload{}, false
	}

	var request userPromptRequest
	if err := common.Unmarshal(body, &request); err != nil {
		return UserPromptLogPayload{}, false
	}

	var parts []string
	switch path {
	case "/v1/chat/completions":
		parts = append(parts, extractChatUserTexts(request.Messages)...)
	case "/v1/completions":
		parts = append(parts, extractStringValues(request.Prompt)...)
	case "/v1/responses", "/v1/responses/compact":
		parts = append(parts, extractResponsesInputUserTexts(request.Input)...)
	}

	question := truncateRunes(joinUserPromptParts(parts), maxChars)
	return UserPromptLogPayload{
		Model:           request.Model,
		ReasoningEffort: extractUserPromptReasoningEffort(request),
		Question:        question,
	}, question != ""
}

func isUserPromptLogPath(path string) bool {
	switch path {
	case "/v1/chat/completions", "/v1/completions", "/v1/responses", "/v1/responses/compact":
		return true
	default:
		return false
	}
}

func extractChatUserTexts(messages []userPromptMessage) []string {
	for i := len(messages) - 1; i >= 0; i-- {
		message := messages[i]
		if message.Role != "user" || message.ToolCalls != nil || message.ToolCallID != "" {
			continue
		}
		// Chat/Responses 请求通常会携带历史消息。用户问题日志只记录本轮
		// 最后一条真实 user 输入，避免把历史上下文或工具结果写入日志。
		parts := extractTextContent(message.Content, "text")
		if len(parts) > 0 {
			return parts
		}
	}
	return nil
}

func extractResponsesInputUserTexts(input any) []string {
	switch value := input.(type) {
	case string:
		return []string{value}
	case []any:
		for i := len(value) - 1; i >= 0; i-- {
			parts := extractResponsesInputItemUserTexts(value[i])
			if len(parts) > 0 {
				return parts
			}
		}
		return nil
	case map[string]any:
		return extractResponsesInputItemUserTexts(value)
	default:
		return nil
	}
}

func extractResponsesInputItemUserTexts(item any) []string {
	itemMap, ok := item.(map[string]any)
	if !ok {
		return nil
	}

	role, _ := itemMap["role"].(string)
	if role != "user" {
		return nil
	}
	return extractTextContent(itemMap["content"], "input_text", "text")
}

func extractTextContent(content any, allowedTypes ...string) []string {
	switch value := content.(type) {
	case string:
		if shouldLogUserPromptText(value) {
			return []string{value}
		}
		return nil
	case []any:
		parts := make([]string, 0, len(value))
		for _, item := range value {
			itemMap, ok := item.(map[string]any)
			if !ok || !isAllowedTextType(itemMap["type"], allowedTypes) {
				continue
			}
			if text, ok := itemMap["text"].(string); ok && shouldLogUserPromptText(text) {
				parts = append(parts, text)
			}
		}
		return parts
	default:
		return nil
	}
}

func extractStringValues(value any) []string {
	switch v := value.(type) {
	case string:
		if shouldLogUserPromptText(v) {
			return []string{v}
		}
		return nil
	case []any:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			if text, ok := item.(string); ok && shouldLogUserPromptText(text) {
				parts = append(parts, text)
			}
		}
		return parts
	default:
		return nil
	}
}

func isAllowedTextType(value any, allowedTypes []string) bool {
	contentType, ok := value.(string)
	if !ok {
		return false
	}
	for _, allowedType := range allowedTypes {
		if contentType == allowedType {
			return true
		}
	}
	return false
}

func extractUserPromptReasoningEffort(request userPromptRequest) string {
	if request.ReasoningEffort != "" {
		return request.ReasoningEffort
	}
	if request.Reasoning != nil && request.Reasoning.Effort != "" {
		return request.Reasoning.Effort
	}
	effort, _ := reasoning.ParseOpenAIReasoningEffortFromModelSuffix(request.Model)
	return effort
}

func shouldLogUserPromptText(text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return false
	}

	// Codex/Responses 请求可能把运行环境、开发者指令、工具说明等包装成
	// user input_text 一并发送。它们不是用户问题，日志里应继续向前找真实输入。
	systemContextPrefixes := []string{
		"<environment_context>",
		"<developer",
		"<system",
		"<skills_instructions>",
		"<plugins_instructions>",
		"<permissions instructions>",
		"<collaboration_mode>",
	}
	for _, prefix := range systemContextPrefixes {
		if strings.HasPrefix(trimmed, prefix) {
			return false
		}
	}
	return true
}

func joinUserPromptParts(parts []string) string {
	trimmed := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			trimmed = append(trimmed, part)
		}
	}
	return strings.Join(trimmed, "\n")
}

func truncateRunes(text string, maxChars int) string {
	if maxChars <= 0 {
		maxChars = 500
	}
	runes := []rune(text)
	if len(runes) <= maxChars {
		return text
	}
	return string(runes[:maxChars])
}
