// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Bundle, BundleStatus, TriggerMode, VaultStorage} from "./VaultTypes.sol";
import {PricingLib} from "./PricingLib.sol";
import {VaultReentrancyGuard} from "./VaultReentrancyGuard.sol";

/// UNAUDITED SKETCH -- see VaultTypes.sol.
///
/// Mirrors ClaimsService.decide() + requireClaimTransition() (apps/api/src/claims/claims.service.ts,
/// packages/domain/src/claims.ts): the contract re-checks state legality
/// itself before releasing funds, it never trusts the caller's word for it.
///
/// A bundle's triggerMode was fixed at lock time (SyndicationVaultFacet) --
/// this facet enforces whichever mode that bundle actually locked under,
/// and applies the pricing decision made in chat: ORACLE-mode bundles pay
/// PricingLib's premium on top of the base settlement fee, ATTESTATION-mode
/// bundles pay the base fee only.
contract ClaimTriggerFacet is VaultReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    event ClaimReleased(
        bytes32 indexed syndicationId,
        uint256 payoutAmountMinor,
        uint256 feeAmountMinor,
        TriggerMode modeUsed
    );
    event AttestationSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event FeeParametersUpdated(uint16 baseSettlementFeeBps, uint16 oraclePremiumBps);

    error NotGovernance();
    error BundleNotLocked(bytes32 syndicationId);
    error PayoutExceedsLocked(uint256 requested, uint256 locked);
    error InvalidAttestation();
    error OracleModeNotYetSupported();
    error NoAttestationSignerConfigured();

    modifier onlyGovernance() {
        if (msg.sender != VaultStorage.layout().governance) revert NotGovernance();
        _;
    }

    function setAttestationSigner(address signer) external onlyGovernance {
        VaultStorage.Layout storage s = VaultStorage.layout();
        emit AttestationSignerUpdated(s.attestationSigner, signer);
        s.attestationSigner = signer;
    }

    function setFeeParameters(uint16 baseSettlementFeeBps, uint16 oraclePremiumBps) external onlyGovernance {
        VaultStorage.Layout storage s = VaultStorage.layout();
        s.baseSettlementFeeBps = baseSettlementFeeBps;
        s.oraclePremiumBps = oraclePremiumBps;
        emit FeeParametersUpdated(baseSettlementFeeBps, oraclePremiumBps);
    }

    /// The fee rate (bps) and fee amount a bundle's claim would currently
    /// pay, computed the same way releaseClaim() computes it -- exposed
    /// read-only so a capital provider can see the actual price of their
    /// chosen trigger mode before they ever fund a bundle, same
    /// "make the trade-off visible" instinct as custody disclosure.
    function quoteSettlementFee(bytes32 syndicationId, uint256 payoutAmountMinor)
        external
        view
        returns (uint256 feeBps, uint256 feeAmountMinor)
    {
        VaultStorage.Layout storage s = VaultStorage.layout();
        Bundle storage bundle = s.bundles[syndicationId];
        feeBps = PricingLib.settlementFeeBps(bundle.triggerMode, s.baseSettlementFeeBps, s.oraclePremiumBps);
        feeAmountMinor = PricingLib.feeAmount(payoutAmountMinor, feeBps);
    }

    /// `proof` shape depends on the bundle's locked-in triggerMode:
    ///   ATTESTATION -> the attestationSigner's ECDSA signature over
    ///                  keccak256(syndicationId, payoutAmountMinor)
    ///   ORACLE      -> not implemented -- genuinely blocked on picking an
    ///                  oracle network (Chainlink Functions or otherwise);
    ///                  reverts explicitly rather than silently downgrading
    ///                  an ORACLE-mode bundle's guarantee to attestation.
    function releaseClaim(
        bytes32 syndicationId,
        uint256 payoutAmountMinor,
        bytes calldata proof
    ) external nonReentrant {
        VaultStorage.Layout storage s = VaultStorage.layout();
        Bundle storage bundle = s.bundles[syndicationId];

        if (bundle.status != BundleStatus.LOCKED) revert BundleNotLocked(syndicationId);
        if (payoutAmountMinor > bundle.lockedAmount) {
            revert PayoutExceedsLocked(payoutAmountMinor, bundle.lockedAmount);
        }

        if (bundle.triggerMode == TriggerMode.ATTESTATION) {
            _verifyAttestation(syndicationId, payoutAmountMinor, proof, s.attestationSigner);
        } else {
            revert OracleModeNotYetSupported();
        }

        uint256 feeBps = PricingLib.settlementFeeBps(bundle.triggerMode, s.baseSettlementFeeBps, s.oraclePremiumBps);
        uint256 fee = PricingLib.feeAmount(payoutAmountMinor, feeBps);
        uint256 netPayout = payoutAmountMinor - fee;

        bundle.status = BundleStatus.RELEASED;

        IERC20 asset = IERC20(bundle.token);
        for (uint256 i = 0; i < bundle.participants.length; i++) {
            uint256 share = (netPayout * bundle.allocationBps[i]) / 10_000;
            if (share > 0) asset.safeTransfer(bundle.participants[i], share);
        }
        // The fee itself: real implementation routes it to a treasury
        // address, matching SettlementService's existing fee-collection
        // pattern off-chain -- omitted here as a placeholder transfer
        // target, not a structural gap.

        emit ClaimReleased(syndicationId, payoutAmountMinor, fee, bundle.triggerMode);
    }

    function _verifyAttestation(
        bytes32 syndicationId,
        uint256 payoutAmountMinor,
        bytes calldata signature,
        address expectedSigner
    ) internal pure {
        if (expectedSigner == address(0)) revert NoAttestationSignerConfigured();
        bytes32 digest = keccak256(abi.encodePacked(syndicationId, payoutAmountMinor)).toEthSignedMessageHash();
        address recovered = digest.recover(signature);
        if (recovered != expectedSigner) revert InvalidAttestation();
    }
}
