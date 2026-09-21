// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Bundle, BundleStatus, TriggerMode, VaultStorage} from "./VaultTypes.sol";
import {VaultReentrancyGuard} from "./VaultReentrancyGuard.sol";

/// UNAUDITED SKETCH -- see VaultTypes.sol.
///
/// Mirrors SyndicationService.bind() (apps/api/src/syndication/syndication.service.ts):
/// called by our backend's registered relayer the moment a syndication
/// binds off-chain, so the on-chain lock and the off-chain ledger row are
/// created together, not independently.
contract SyndicationVaultFacet is VaultReentrancyGuard {
    using SafeERC20 for IERC20;

    event CapitalLocked(bytes32 indexed syndicationId, address indexed token, uint256 totalAmount, TriggerMode mode);
    event GovernanceUpdated(address indexed previousGovernance, address indexed newGovernance);
    event RelayerRotated(address indexed previousRelayer, address indexed newRelayer);

    error NotGovernance();
    error NotRelayer();
    error LengthMismatch();
    error AllocationsIncomplete(uint256 totalBps);
    error AlreadyLocked(bytes32 syndicationId);
    error NoParticipants();

    modifier onlyGovernance() {
        if (msg.sender != VaultStorage.layout().governance) revert NotGovernance();
        _;
    }

    modifier onlyRelayer() {
        if (msg.sender != VaultStorage.layout().relayer) revert NotRelayer();
        _;
    }

    /// One-time setup. In a real Diamond deployment this would be called
    /// through the diamond's own init pattern; kept as a plain function
    /// here since this package has no deployment tooling yet (no Foundry
    /// available in this sandbox -- see README.md).
    function initializeGovernance(address governance) external {
        VaultStorage.Layout storage s = VaultStorage.layout();
        require(s.governance == address(0), "already initialized");
        s.governance = governance;
        emit GovernanceUpdated(address(0), governance);
    }

    /// The relayer (who may call lockCapital) is a distinct role from the
    /// attestationSigner in ClaimTriggerFacet (whose signature authorises a
    /// payout) -- rotating one must never silently rotate the other, even
    /// though both start out governance-controlled.
    function setRelayer(address relayer) external onlyGovernance {
        VaultStorage.Layout storage s = VaultStorage.layout();
        emit RelayerRotated(s.relayer, relayer);
        s.relayer = relayer;
    }

    /// `requestOracle[i]` is participant i's own declared preference for
    /// this bundle -- the on-chain analog of a capital provider's
    /// `acceptedCustodyModels` choice (packages/domain/src/marketplace.ts):
    /// never inferred from amount, always the provider's own stated
    /// requirement. If any participant asks for ORACLE mode, the whole
    /// bundle uses it -- the most protective request governs, never
    /// diluted by co-participants who didn't ask for it.
    function lockCapital(
        bytes32 syndicationId,
        address token,
        address[] calldata participants,
        uint256[] calldata amounts,
        uint256[] calldata allocationBps,
        bool[] calldata requestOracle,
        uint64 coverageExpiresAt
    ) external nonReentrant onlyRelayer {
        VaultStorage.Layout storage s = VaultStorage.layout();

        if (participants.length == 0) revert NoParticipants();
        if (
            participants.length != amounts.length ||
            amounts.length != allocationBps.length ||
            allocationBps.length != requestOracle.length
        ) revert LengthMismatch();

        if (s.bundles[syndicationId].status != BundleStatus.NONE) revert AlreadyLocked(syndicationId);

        uint256 totalBps;
        uint256 totalAmount;
        TriggerMode mode = TriggerMode.ATTESTATION;
        for (uint256 i = 0; i < participants.length; i++) {
            totalBps += allocationBps[i];
            totalAmount += amounts[i];
            if (requestOracle[i]) mode = TriggerMode.ORACLE;
        }
        // Mirrors bindAllocations() throwing INCOMPLETE_ALLOCATION off-chain
        // (packages/domain/src/syndication.ts) -- the on-chain leg enforces
        // the identical invariant, it does not trust the caller to have
        // already checked it.
        if (totalBps != 10_000) revert AllocationsIncomplete(totalBps);

        s.bundles[syndicationId] = Bundle({
            token: token,
            lockedAmount: totalAmount,
            participants: participants,
            allocationBps: allocationBps,
            triggerMode: mode,
            status: BundleStatus.LOCKED,
            coverageExpiresAt: coverageExpiresAt
        });

        IERC20 asset = IERC20(token);
        for (uint256 i = 0; i < participants.length; i++) {
            asset.safeTransferFrom(participants[i], address(this), amounts[i]);
        }

        emit CapitalLocked(syndicationId, token, totalAmount, mode);
    }

    function getBundle(bytes32 syndicationId) external view returns (Bundle memory) {
        return VaultStorage.layout().bundles[syndicationId];
    }
}
