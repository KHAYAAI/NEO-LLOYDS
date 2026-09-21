// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TriggerMode} from "./VaultTypes.sol";

/// UNAUDITED SKETCH -- see VaultTypes.sol for the compile/test status note.
///
/// Implements the pricing decision made in chat: oracle-mode bundles pay a
/// premium on top of the standard settlement fee, because independent
/// verification genuinely costs more to run and pricing it the same as
/// attestation would mean attestation-mode customers quietly subsidise it.
/// `oraclePremiumBps` is a real, separate parameter from the base fee (not
/// baked in as a fixed multiplier) specifically so it can be set to
/// (real oracle-network cost + a modest margin) once that cost is known --
/// nothing here invents a number.
library PricingLib {
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// The fee rate that applies to a bundle, in basis points. Oracle mode
    /// is strictly base + premium, never less than attestation mode --
    /// trust-minimization costs more, it never costs less.
    function settlementFeeBps(
        TriggerMode mode,
        uint16 baseFeeBps,
        uint16 oraclePremiumBps
    ) internal pure returns (uint256) {
        if (mode == TriggerMode.ORACLE) {
            return uint256(baseFeeBps) + uint256(oraclePremiumBps);
        }
        return baseFeeBps;
    }

    /// The actual fee amount owed on a given settlement amount, at a given
    /// bps rate. Mirrors the same integer-minor-units, no-floating-point
    /// discipline `packages/domain/src/money.ts` already enforces off-chain.
    function feeAmount(uint256 amountMinor, uint256 feeBps) internal pure returns (uint256) {
        return (amountMinor * feeBps) / BPS_DENOMINATOR;
    }
}
