package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"github.com/bytedance/gopkg/util/gopool"
)

const sensitiveAlertTimeFormat = "2006-01-02 15:04:05"

type SensitiveAlertPayload struct {
	Time      string   `json:"time"`
	RequestID string   `json:"request_id,omitempty"`
	TokenName string   `json:"token_name,omitempty"`
	Model     string   `json:"model,omitempty"`
	Path      string   `json:"path,omitempty"`
	Words     []string `json:"words,omitempty"`
	Question  string   `json:"question,omitempty"`
}

type larkTextWebhookPayload struct {
	MsgType string                 `json:"msg_type"`
	Content larkTextWebhookContent `json:"content"`
}

type larkTextWebhookContent struct {
	Text string `json:"text"`
}

type larkWebhookResponse struct {
	Code          int    `json:"code"`
	Msg           string `json:"msg"`
	StatusCode    int    `json:"StatusCode"`
	StatusMessage string `json:"StatusMessage"`
}

func SensitiveAlertWebhookEnabled() bool {
	return common.GetEnvOrDefaultBool("SENSITIVE_ALERT_WEBHOOK_ENABLED", false)
}

func SensitiveAlertWebhookURL() string {
	return common.GetEnvOrDefaultString("SENSITIVE_ALERT_WEBHOOK_URL", "")
}

func SensitiveAlertWebhookTimeout() time.Duration {
	seconds := common.GetEnvOrDefault("SENSITIVE_ALERT_WEBHOOK_TIMEOUT_SECONDS", 5)
	if seconds <= 0 {
		seconds = 5
	}
	return time.Duration(seconds) * time.Second
}

func SendSensitiveAlertWebhook(ctx context.Context, payload SensitiveAlertPayload) {
	if !SensitiveAlertWebhookEnabled() || SensitiveAlertWebhookURL() == "" {
		return
	}
	if IsSensitiveIgnoredToken(payload.TokenName) {
		return
	}

	payload.Time = formatSensitiveAlertTime(time.Now())
	gopool.Go(func() {
		webhookCtx, cancel := context.WithTimeout(context.Background(), SensitiveAlertWebhookTimeout())
		defer cancel()
		if err := postSensitiveAlertWebhook(webhookCtx, SensitiveAlertWebhookURL(), payload); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("sensitive alert webhook failed: %s", err.Error()))
		}
	})
}

func postSensitiveAlertWebhook(ctx context.Context, webhookURL string, payload SensitiveAlertPayload) error {
	body, err := common.Marshal(larkTextWebhookPayload{
		MsgType: "text",
		Content: larkTextWebhookContent{
			Text: formatSensitiveAlertText(payload),
		},
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	client := GetHttpClient()
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("unexpected status code %d", resp.StatusCode)
	}
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(respBody))) == 0 {
		return nil
	}
	var webhookResp larkWebhookResponse
	if err := common.Unmarshal(respBody, &webhookResp); err != nil {
		return err
	}
	if webhookResp.Code != 0 {
		msg := webhookResp.Msg
		if msg == "" {
			msg = webhookResp.StatusMessage
		}
		if msg == "" {
			msg = "unknown lark webhook error"
		}
		return fmt.Errorf("lark webhook returned code %d: %s", webhookResp.Code, msg)
	}
	return nil
}

func IsSensitiveIgnoredToken(tokenName string) bool {
	tokenName = strings.TrimSpace(tokenName)
	if tokenName == "" {
		return false
	}
	for _, ignored := range strings.Split(common.GetEnvOrDefaultString("SENSITIVE_ALERT_IGNORED_TOKEN_NAMES", ""), ",") {
		if strings.TrimSpace(ignored) == tokenName {
			return true
		}
	}
	return false
}

func formatSensitiveAlertTime(t time.Time) string {
	return fmt.Sprintf("%s:%03d", t.Format(sensitiveAlertTimeFormat), t.Nanosecond()/int(time.Millisecond))
}

func formatSensitiveAlertText(payload SensitiveAlertPayload) string {
	return fmt.Sprintf(
		`time="%s" token="%s" model="%s" path="%s" words="%s" question="%s"`,
		escapeSensitiveAlertText(payload.Time),
		escapeSensitiveAlertText(payload.TokenName),
		escapeSensitiveAlertText(payload.Model),
		escapeSensitiveAlertText(payload.Path),
		escapeSensitiveAlertText(strings.Join(payload.Words, ",")),
		escapeSensitiveAlertText(payload.Question),
	)
}

func escapeSensitiveAlertText(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	value = strings.ReplaceAll(value, "\r", `\n`)
	value = strings.ReplaceAll(value, "\n", `\n`)
	return value
}
