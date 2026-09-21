// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// UNAUDITED SKETCH -- not deployed to any network. Compiled and checked
/// against real OpenZeppelin Contracts v5 (not stubbed/reimplemented) via
/// `npm run compile` in this package; not run against a live or test EVM
/// (this sandbox's egress policy blocks the Foundry installer -- documented
/// in packages/contracts/README.md, same honesty rule as the AWS Terraform
/// stack's "written and fmt-checked, never applied" status).
///
/// Mirrors, facet-for-facet, the off-chain services already built and
/// tested in apps/api: SyndicationService.bind(), ClaimsService.decide(),
/// SettlementProvider. Nothing here replaces those -- this is the on-chain
/// leg a future StablecoinSettlementProvider would call into.

enum TriggerMode {
    ATTESTATION, // Stage 1: Neo-Lloyds' backend signs off that a claim was approved.
    ORACLE       // Stage 2 (per-bundle, not platform-wide): an independent oracle network
                 // must confirm the claim before any payout -- chosen by the participant,
                 // not inferred from bundle size.
}

enum BundleStatus {
    NONE,
    LOCKED,
    RELEASED,
    RETURNED
}

struct Bundle {
    address token; // the stablecoin, e.g. USDC -- which token is still an open decision (design doc §05)
    uint256 lockedAmount;
    address[] participants;
    uint256[] allocationBps; // mirrors StoredSyndication's Allocation[] -- must sum to 10_000
    TriggerMode triggerMode; // set once at lock time, immutable after
    BundleStatus status;
    uint64 coverageExpiresAt;
}

/// Diamond storage pattern (EIP-2535 convention, same one diamond-2-hardhat
/// uses): a single struct at a fixed, namespaced storage slot, shared by
/// every facet, so adding facets later never collides with existing state.
library VaultStorage {
    bytes32 internal constant STORAGE_SLOT = keccak256("neo-lloyds.vault.storage.v1");

    struct Layout {
        mapping(bytes32 => Bundle) bundles;
        address governance; // controls diamondCut, fee parameters -- same trust question flagged in chat, not resolved here
        address relayer; // the only address allowed to call lockCapital() -- our backend's registered relayer
        address attestationSigner; // Stage-1 trust root for ATTESTATION mode
        address oracleAdapter; // Stage-2 adapter for ORACLE mode -- unset until a network is chosen
        uint16 baseSettlementFeeBps; // same fee concept SettlementService already computes off-chain
        uint16 oraclePremiumBps; // added on top of baseSettlementFeeBps for ORACLE-mode bundles only
        bool reentrancyLocked; // shared reentrancy guard -- a regular OZ ReentrancyGuard's storage
            // layout doesn't fit the Diamond pattern's shared-storage-across-facets model, so the
            // lock lives in the same namespaced struct every facet already reads/writes through.
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }
}
