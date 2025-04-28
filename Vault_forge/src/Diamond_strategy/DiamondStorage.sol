// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

//import "../../../lib/openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

library DiamondStorage {
    uint256 constant MAX_DEPOSIT_PER_USER = 4999 * 1e6;
    uint256 constant TIMELOCK_DURATION = 2 days;
    uint256 constant LOCK_PERIOD = 30 days;
    uint256 constant STAKED_PORTION = 40; // 40%
    uint256 constant LIQUID_PORTION = 60; // 60%
    uint256 constant INSTANT_WITHDRAWAL_LIMIT = 60;
    uint256 constant UPDATE_INTERVAL = 1 days;
    uint256 constant PERFORMANCE_FEE = 300; // 3%
    uint256 constant MIN_DEPOSIT_AMOUNT = 1 * 1e6; // 1 USDC minimum
    uint256 constant DEPOSIT_TIMELOCK = 1 hours;
    uint256 constant FEE_DENOMINATOR = 10000;
    uint256 constant MINIMUM_FEE = 1e6; // 1 USDC minimum fee
    uint256 constant AUTO_WITHDRAWAL_SLIPPAGE = 950; // 95% of original stake as minimum
    uint256 constant MAX_USERS_PER_UPDATE = 20; // Process 20 users at a time

    struct StakedDeposit {
        uint256 amount;
        uint256 timestamp;
        uint256 wstETHAmount;
        bool withdrawn;
    }

    struct VaultState {
        // State variables
        uint256 totalAssets; // Total assets in the vault
        uint256 totalShares; // Total shares issued by the vault
        uint256 totalStakedValue;
        uint256 lastUpdateTime;
        uint256 lastDailyUpdate;
        uint256 accumulatedFees;
        uint256 lastProcessedUserIndex;
        bool emergencyShutdown;
        bool depositsPaused;
        // Addresses
        address owner;
        address[] userAddresses;
        address ASSET_TOKEN_ADDRESS;
        address swapContract;
        address feeCollector;
        address lidoWithdrawalAddress;
        address wstETHAddress;
        address receiverContract;
        // Mappings
        mapping(address => uint256) stakedPortions;
        mapping(address => uint256) userDeposits;
        mapping(address => uint256) balances;
        mapping(address => uint256) depositTimestamps;
        mapping(address => uint256) lockedAssets;
        mapping(address => bool) isExistingUser;
        mapping(address => uint256) userWstETHBalance;
        mapping(address => bool) withdrawalInProgress;
        mapping(bytes4 => bool) supportedInterfaces;
        mapping(bytes32 => uint256) pendingOperations;
        mapping(address => uint256) withdrawalRequestIds;
        mapping(address => uint256) largeDepositUnlockTime;
        mapping(address => uint256) pendingEthStakes;
        mapping(bytes32 => address[]) stakeBatches;
        mapping(bytes32 => bool) processedBatches;
        mapping(address => StakedDeposit[]) userStakedDeposits;
    }

    bytes32 constant DIAMOND_STORAGE_POSITION =
        keccak256("diamond.standard.vault.storage");

    function getStorage() internal pure returns (VaultState storage ds) {
        bytes32 position = DIAMOND_STORAGE_POSITION;
        assembly {
            ds.slot := position
        }
    }
}
