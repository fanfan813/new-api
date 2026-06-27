package service

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFormatSensitiveAlertTime(t *testing.T) {
	now := time.Date(2026, 6, 28, 10, 9, 8, 123*int(time.Millisecond), time.FixedZone("CST", 8*60*60))

	assert.Equal(t, "2026-06-28 10:09:08:123", formatSensitiveAlertTime(now))
}

func TestIsSensitiveIgnoredToken(t *testing.T) {
	t.Setenv("SENSITIVE_ALERT_IGNORED_TOKEN_NAMES", "alpha, beta ,陈越")

	assert.True(t, IsSensitiveIgnoredToken("alpha"))
	assert.True(t, IsSensitiveIgnoredToken("beta"))
	assert.True(t, IsSensitiveIgnoredToken("陈越"))
	assert.False(t, IsSensitiveIgnoredToken("gamma"))
	assert.False(t, IsSensitiveIgnoredToken(""))
}

func TestSensitiveAlertWebhookTimeout(t *testing.T) {
	t.Setenv("SENSITIVE_ALERT_WEBHOOK_TIMEOUT_SECONDS", "7")
	assert.Equal(t, 7*time.Second, SensitiveAlertWebhookTimeout())

	t.Setenv("SENSITIVE_ALERT_WEBHOOK_TIMEOUT_SECONDS", "0")
	assert.Equal(t, 5*time.Second, SensitiveAlertWebhookTimeout())
}

func TestPostSensitiveAlertWebhookSendsLarkTextPayload(t *testing.T) {
	var request larkTextWebhookPayload
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "application/json", r.Header.Get("Content-Type"))
		require.NoError(t, common.DecodeJson(r.Body, &request))
		_, _ = w.Write([]byte(`{"code":0,"msg":"success"}`))
	}))
	defer server.Close()

	err := postSensitiveAlertWebhook(t.Context(), server.URL, SensitiveAlertPayload{
		Time:      "2026-06-28 20:10:00:123",
		TokenName: `fanfan"1`,
		Model:     "gpt-5.5",
		Path:      "/v1/responses",
		Words:     []string{"股票", "大A"},
		Question:  "测试 股票\n第二行",
	})

	require.NoError(t, err)
	assert.Equal(t, "text", request.MsgType)
	assert.Contains(t, request.Content.Text, `time="2026-06-28 20:10:00:123"`)
	assert.Contains(t, request.Content.Text, `token="fanfan\"1"`)
	assert.Contains(t, request.Content.Text, `model="gpt-5.5"`)
	assert.Contains(t, request.Content.Text, `path="/v1/responses"`)
	assert.Contains(t, request.Content.Text, `words="股票,大A"`)
	assert.Contains(t, request.Content.Text, `question="测试 股票\n第二行"`)
}

func TestPostSensitiveAlertWebhookRejectsLarkBusinessError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"code":19002,"msg":"params error, msg_type need"}`))
	}))
	defer server.Close()

	err := postSensitiveAlertWebhook(t.Context(), server.URL, SensitiveAlertPayload{})

	require.Error(t, err)
	assert.True(t, strings.Contains(err.Error(), "19002"))
	assert.True(t, strings.Contains(err.Error(), "msg_type need"))
}
