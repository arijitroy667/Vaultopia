// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library DiamondStorage {
    bytes32 constant DIAMOND_STORAGE_POSITION = keccak256("diamond.storage.yield.bull");
    
    // Define the StakedDeposit struct used by the contract
    struct StakedDeposit {
        uint256 amount;
        uint256 timestamp;
        uint256 wstETHAmount;
        bool withdrawn;
    }
    
    struct VaultState {
        // Main state variables
        address owner;
        uint256 totalAssets;
        uint256 totalShares;
        uint256 totalStakedValue;
        
        // Asset addresses
        address ASSET_TOKEN_ADDRESS;
        address swapContract;
        address lidoWithdrawalAddress;
        address wstETHAddress;
        address receiverContract;
        address feeCollector;
        
        // Status flags
        bool emergencyShutdown;
        bool depositsPaused;
        
        // Timestamp tracking
        uint256 lastUpdateTime;
        uint256 lastDailyUpdate;
        uint256 lastProcessedUserIndex;
        uint256 accumulatedFees;
        
        // User data
        address[] userAddresses;
        
        // Mappings
        mapping(address => uint256) balances;
        mapping(address => uint256) userDeposits;
        mapping(address => uint256) depositTimestamps;
        mapping(address => uint256) stakedPortions;
        mapping(address => uint256) lockedAssets;
        mapping(address => bool) isExistingUser;
        mapping(address => uint256) userWstETHBalance;
        mapping(address => bool) withdrawalInProgress;
        mapping(address => uint256) withdrawalRequestIds;
        mapping(address => uint256) largeDepositUnlockTime;
        mapping(address => uint256) pendingEthStakes;
        
        // Batch processing
        mapping(bytes32 => address[]) stakeBatches;
        mapping(bytes32 => bool) processedBatches;
        mapping(bytes32 => uint256) pendingOperations;
        
        // Staked deposits tracking
        mapping(address => StakedDeposit[]) userStakedDeposits;
    }
    
    function getStorage() internal pure returns (VaultState storage ds) {
        bytes32 position = DIAMOND_STORAGE_POSITION;
        assembly {
            ds.slot := position
        }
    }
}