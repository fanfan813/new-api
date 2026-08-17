package relay

import (
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/reasoning"
)

func newAPIErrorFromParamOverride(err error) *types.NewAPIError {
	if fixedErr, ok := relaycommon.AsParamOverrideReturnError(err); ok {
		return relaycommon.NewAPIErrorFromParamOverride(fixedErr)
	}
	if limitErr, ok := reasoning.AsLimitExceededError(err); ok {
		return reasoning.NewLimitExceededAPIError(limitErr)
	}
	return types.NewError(err, types.ErrorCodeChannelParamOverrideInvalid, types.ErrOptionWithSkipRetry())
}
