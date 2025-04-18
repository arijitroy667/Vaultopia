// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiamondStorage.sol";
import "./Modifiers.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract AdminFacet is Modifiers {
    using SafeERC20 for IERC20;

    // Events
    event FeeCollectorUpdated(address indexed newFeeCollector);
    event EmergencyShutdownToggled(bool enabled);
    event FeesCollected(uint256 amount);
    event DailyUpdatePerformed(uint256 timestamp);
    event DailyUpdatePartial(
        uint256 startIndex,
        uint256 endIndex,
        uint256 totalUsers
    );
    event WithdrawalInitiationFailed(address indexed user);
    event WithdrawalProcessingFailed(address indexed user, uint256 requestId);
    event LockedAssetsUpdated(address indexed user, uint256 amount);

    function setLidoWithdrawalAddress(address _lidoWithdrawal) external onlyOwner {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        require(_lidoWithdrawal != address(0), "Invalid address");
        ds.lidoWithdrawalAddress = _lidoWithdrawal;
    }

    function setWstETHAddress(address _wstETH) external onlyOwner {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        require(_wstETH != address(0), "Invalid address");
        ds.wstETHAddress = _wstETH;
    }

    function setReceiverContract(address _receiver) external onlyOwner {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        require(_receiver != address(0), "Invalid address");
        ds.receiverContract = _receiver;
    }

    function setSwapContract(address _swapContract) external onlyOwner {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        require(_swapContract != address(0), "Invalid address");
        ds.swapContract = _swapContract;
    }
    
    function toggleDeposits() external onlyOwner {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        ds.depositsPaused = !ds.depositsPaused;
    }
    
    function toggleEmergencyShutdown() external onlyOwner {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        ds.emergencyShutdown = !ds.emergencyShutdown;
        emit EmergencyShutdownToggled(ds.emergencyShutdown);
    }
    
    function setFeeCollector(address _feeCollector) external onlyOwner {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        require(_feeCollector != address(0), "Invalid address");
        ds.feeCollector = _feeCollector;
        emit FeeCollectorUpdated(_feeCollector);
    }
    
    function collectAccumulatedFees() external {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        require(msg.sender == ds.feeCollector, "Only fee collector");
        require(ds.accumulatedFees > 0, "No fees to collect");

        uint256 feesToCollect = ds.accumulatedFees;
        ds.accumulatedFees = 0;

        IERC20(ds.ASSET_TOKEN_ADDRESS).safeTransfer(ds.feeCollector, feesToCollect);
        emit FeesCollected(feesToCollect);
    }
    
    function updateWstETHBalance(address user, uint256 amount) external {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        require(
            msg.sender == ds.swapContract || msg.sender == ds.owner,
            "Not authorized"
        );
        ds.userWstETHBalance[user] += amount;
        emit WstETHBalanceUpdated(user, amount, ds.userWstETHBalance[user]);
    }
    
    function performDailyUpdate() external nonReentrantVault onlyContract {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        require(
            block.timestamp >= ds.lastDailyUpdate + ds.UPDATE_INTERVAL,
            "Too soon to update"
        );

        uint256 startIndex = ds.lastProcessedUserIndex;
        uint256 endIndex = Math.min(
            startIndex + ds.MAX_USERS_PER_UPDATE,
            ds.userAddresses.length
        );
        bool updateComplete = endIndex >= ds.userAddresses.length;

        // Process a limited batch of users
        for (uint256 i = startIndex; i < endIndex; i++) {
            address user = ds.userAddresses[i];

            // Check if user has staked assets that may need processing
            if (ds.userWstETHBalance[user] > 0) {
                // Don't use global depositTimestamps - rely on individual deposit timestamps
                if (!ds.withdrawalInProgress[user]) {
                    // Try to initiate withdrawals for eligible deposits
                    try WithdrawFacet(address(this)).safeInitiateWithdrawal(user) {
                        // Success: withdrawal initiated
                    } catch {
                        // Failed but continue with other users
                        emit WithdrawalInitiationFailed(user);
                    }
                }

                // Check for pending withdrawals that are ready
                if (ds.withdrawalInProgress[user]) {
                    uint256 requestId = ds.withdrawalRequestIds[user];
                    bool isWithdrawalReady = ILidoWithdrawal(
                        ds.lidoWithdrawalAddress
                    ).isWithdrawalFinalized(requestId);

                    if (isWithdrawalReady) {
                        try WithdrawFacet(address(this)).safeProcessCompletedWithdrawal(user) {
                            // Success: withdrawal processed
                        } catch {
                            // Failed but continue with other users
                            emit WithdrawalProcessingFailed(user, requestId);
                        }
                    }
                }
            }
        }

        // Update the index for the next batch
        ds.lastProcessedUserIndex = updateComplete ? 0 : endIndex;

        // Only update timestamp when we've processed all users
        if (updateComplete) {
            // Cleanup any expired locked assets
            _recalculateLockedAssets();
            ds.lastDailyUpdate = block.timestamp;
            emit DailyUpdatePerformed(block.timestamp);
        } else {
            emit DailyUpdatePartial(startIndex, endIndex, ds.userAddresses.length);
        }
    }
    
    function triggerDailyUpdate() external onlyOwner {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        require(
            block.timestamp >= ds.lastDailyUpdate + ds.UPDATE_INTERVAL,
            "Too soon to update"
        );

        // Call performDailyUpdate through the contract itself
        AdminFacet(address(this)).performDailyUpdate();
    }
    
    function _recalculateLockedAssets() internal {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        for (uint256 i = 0; i < ds.userAddresses.length; i++) {
            address user = ds.userAddresses[i];

            // Get all user's deposits
            DiamondStorage.StakedDeposit[] storage deposits = ds.userStakedDeposits[user];

            // Reset the user's staked portions and recalculate
            uint256 stillLockedAmount = 0;

            // Check each deposit individually
            for (uint256 j = 0; j < deposits.length; j++) {
                // Only consider deposits that haven't been withdrawn yet
                if (!deposits[j].withdrawn) {
                    // If deposit is still locked, count it towards locked amount
                    if (block.timestamp < deposits[j].timestamp + ds.LOCK_PERIOD) {
                        stillLockedAmount += deposits[j].amount;
                    }
                }
            }

            // Update user's locked assets with what's still locked
            ds.lockedAssets[user] = stillLockedAmount;

            // If we're using stakedPortions for accounting elsewhere, update it
            // but only for locked assets (not matured but unwithdrawn assets)
            ds.stakedPortions[user] = stillLockedAmount;

            // Emit event for significant changes
            if (stillLockedAmount != ds.lockedAssets[user]) {
                emit LockedAssetsUpdated(user, stillLockedAmount);
            }
        }
    }
    
    // Event definition
    event WstETHBalanceUpdated(
        address indexed user,
        uint256 stakedUSDC,
        uint256 wstETHReceived
    );
}