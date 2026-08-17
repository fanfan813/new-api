package reasoning

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/types"
)

const (
	maxEffortEnv           = "REASONING_EFFORT_MAX"
	ignoredTokenNamesEnv   = "REASONING_EFFORT_IGNORED_TOKEN_NAMES"
	limitExceededErrorCode = "reasoning_effort_not_allowed"
)

var (
	effortRanks = map[string]int{
		"none":    0,
		"minimal": 1,
		"low":     2,
		"medium":  3,
		"high":    4,
		"xhigh":   5,
		"max":     6,
	}
	effortChineseNames = map[string]string{
		"none":    "关闭",
		"minimal": "最低",
		"low":     "低",
		"medium":  "中等",
		"high":    "高",
		"xhigh":   "超高",
		"max":     "最高",
	}
	invalidMaxEffortLogged sync.Map
)

// LimitExceededError indicates that a non-whitelisted token requested a
// reasoning level above the configured maximum.
type LimitExceededError struct {
	Requested string
	Maximum   string
}

func (e *LimitExceededError) Error() string {
	if e == nil {
		return "reasoning effort exceeds configured maximum"
	}
	return fmt.Sprintf(
		"当前令牌最高支持“%s（%s）”推理等级，本次请求为“%s（%s）”，请降低推理等级后重试",
		effortChineseNames[e.Maximum],
		e.Maximum,
		effortChineseNames[e.Requested],
		e.Requested,
	)
}

func AsLimitExceededError(err error) (*LimitExceededError, bool) {
	var target *LimitExceededError
	if !errors.As(err, &target) {
		return nil, false
	}
	return target, true
}

func NewLimitExceededAPIError(err *LimitExceededError) *types.NewAPIError {
	message := "reasoning effort exceeds configured maximum"
	if err != nil {
		message = err.Error()
	}
	return types.WithOpenAIError(types.OpenAIError{
		Message: message,
		Type:    "invalid_request_error",
		Code:    limitExceededErrorCode,
	}, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
}

// ValidateEffortLimit leaves absent and unknown provider-specific levels to
// the existing protocol validation. Only known ordered levels are restricted.
func ValidateEffortLimit(tokenName, requestedEffort string) error {
	// Internal operations such as channel tests do not carry an API token name
	// and must not inherit end-user token restrictions.
	if strings.TrimSpace(tokenName) == "" {
		return nil
	}
	maximum, maximumRank, enabled := configuredMaximumEffort()
	if !enabled || IsEffortLimitIgnoredToken(tokenName) {
		return nil
	}

	requested := strings.ToLower(strings.TrimSpace(requestedEffort))
	requestedRank, known := effortRanks[requested]
	if !known || requestedRank <= maximumRank {
		return nil
	}
	return &LimitExceededError{Requested: requested, Maximum: maximum}
}

func IsEffortLimitIgnoredToken(tokenName string) bool {
	tokenName = strings.TrimSpace(tokenName)
	if tokenName == "" {
		return false
	}
	for _, ignored := range strings.Split(common.GetEnvOrDefaultString(ignoredTokenNamesEnv, ""), ",") {
		if strings.TrimSpace(ignored) == tokenName {
			return true
		}
	}
	return false
}

func configuredMaximumEffort() (string, int, bool) {
	maximum := strings.ToLower(strings.TrimSpace(common.GetEnvOrDefaultString(maxEffortEnv, "")))
	if maximum == "" {
		return "", 0, false
	}
	maximumRank, valid := effortRanks[maximum]
	if !valid {
		if _, loaded := invalidMaxEffortLogged.LoadOrStore(maximum, struct{}{}); !loaded {
			common.SysError(fmt.Sprintf("invalid %s value %q; reasoning effort limit is disabled", maxEffortEnv, maximum))
		}
		return "", 0, false
	}
	return maximum, maximumRank, true
}
