package reasoning

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateEffortLimit(t *testing.T) {
	t.Setenv(maxEffortEnv, "medium")
	t.Setenv(ignoredTokenNamesEnv, "alex, fanfan1")

	tests := []struct {
		name          string
		tokenName     string
		effort        string
		blocked       bool
		expectedLabel string
	}{
		{name: "lower effort", tokenName: "normal", effort: "low"},
		{name: "same effort", tokenName: "normal", effort: "medium"},
		{name: "higher effort", tokenName: "normal", effort: "high", blocked: true, expectedLabel: "高（high）"},
		{name: "case and whitespace", tokenName: "normal", effort: " XHIGH ", blocked: true, expectedLabel: "超高（xhigh）"},
		{name: "whitelisted token", tokenName: "alex", effort: "max"},
		{name: "unknown provider effort", tokenName: "normal", effort: "provider-specific"},
		{name: "internal request", tokenName: "", effort: "max"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateEffortLimit(tt.tokenName, tt.effort)
			if !tt.blocked {
				require.NoError(t, err)
				return
			}

			var limitErr *LimitExceededError
			require.ErrorAs(t, err, &limitErr)
			assert.Equal(t, "medium", limitErr.Maximum)
			assert.Contains(t, limitErr.Error(), "中等（medium）")
			assert.Contains(t, limitErr.Error(), tt.expectedLabel)
		})
	}
}

func TestNewLimitExceededAPIError(t *testing.T) {
	err := NewLimitExceededAPIError(&LimitExceededError{Requested: "high", Maximum: "medium"})

	require.NotNil(t, err)
	assert.Equal(t, 400, err.StatusCode)
	openAIError := err.ToOpenAIError()
	assert.Equal(t, limitExceededErrorCode, openAIError.Code)
	assert.Equal(t, "invalid_request_error", openAIError.Type)
}
