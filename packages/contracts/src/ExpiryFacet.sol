// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Bundle, BundleStatus, VaultStorage} from "./VaultTypes.sol";
import {VaultReentrancyGuard} from "./VaultReentrancyGuard.sol";

/// UNAUDITED SKETCH -- see VaultTypes.sol.
///
/// The far more common path than ClaimTriggerFacet: coverage runs its full
/// term with no approved claim, and locked capital returns to its
/// participants automatically. Mirrors a syndication simply never having a
/// claim advance past its coverage period off-chain -- no bespoke
/// "cancel" flow needed, this is the default outcome.
contract ExpiryFacet is VaultReentrancyGuard {
    using SafeERC20 for IERC20;

    event CapitalReturned(bytes32 indexed syndicationId, uint256 totalAmount);

    error BundleNotLocked(bytes32 syndicationId);
    error CoverageStillActive(uint64 expiresAt, uint256 currentTime);

    function returnCapital(bytes32 syndicationId) external nonReentrant {
        VaultStorage.Layout storage s = VaultStorage.layout();
        Bundle storage bundle = s.bundles[syndicationId];

        if (bundle.status != BundleStatus.LOCKED) revert BundleNotLocked(syndicationId);
        if (block.timestamp < bundle.coverageExpiresAt) {
            revert CoverageStillActive(bundle.coverageExpiresAt, block.timestamp);
        }

        bundle.status = BundleStatus.RETURNED;

        IERC20 asset = IERC20(bundle.token);
        for (uint256 i = 0; i < bundle.participants.length; i++) {
            uint256 share = (bundle.lockedAmount * bundle.allocationBps[i]) / 10_000;
            if (share > 0) asset.safeTransfer(bundle.participants[i], share);
        }

        emit CapitalReturned(syndicationId, bundle.lockedAmount);
    }
}
