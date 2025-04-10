// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StakingController.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract Yield_Bull is StakingController {
    using Math for uint256;

    constructor(
        address _lidoWithdrawal,
        address _wstETH,
        address _receiver,
        address _swapContract
    ) VaultStorage(0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238) {
        require(
            _lidoWithdrawal != address(0),
            "Invalid Lido withdrawal address"
        );
        require(_wstETH != address(0), "Invalid wstETH address");
        require(_receiver != address(0), "Invalid receiver address");
        require(_swapContract != address(0), "Invalid swap contract address");

        lidoWithdrawalAddress = _lidoWithdrawal;
        wstETHAddress = _wstETH;
        receiverContract = _receiver;
        swapContract = _swapContract;
        feeCollector = msg.sender;
        owner = msg.sender;
        lastDailyUpdate = block.timestamp;
    }

    function deposit(
        uint256 assets,
        address receiver
    ) public nonReentrant returns (uint256 shares) {
        require(assets > 0, "Deposit amount must be greater than zero");
        require(!depositsPaused, "Deposits are paused");
        require(assets >= MIN_DEPOSIT_AMOUNT, "Deposit amount too small");
        require(!emergencyShutdown, "Deposits suspended");

        shares = previewDeposit(assets);
        require(shares > 0, "Zero shares minted");

        if (assets > totalAssets / 10) {
            // If deposit is > 10% of total assets
            require(
                largeDepositUnlockTime[msg.sender] != 0 &&
                    block.timestamp >= largeDepositUnlockTime[msg.sender],
                "Large deposit must be queued"
            );
            delete largeDepositUnlockTime[msg.sender];
        }

        if (!isExistingUser[receiver]) {
            userAddresses.push(receiver);
            isExistingUser[receiver] = true;
        }

        // Calculate portions
        uint256 amountToStake = (assets * STAKED_PORTION) / 100;

        // Get expected ETH output with 1% slippage tolerance
        uint256 expectedEth = ISwapContract(swapContract).getETHAmountOut(
            amountToStake
        );
        uint256 minExpectedEth = (expectedEth * 99) / 100;

        // Update state
        userDeposits[receiver] += assets;
        balances[receiver] += shares;
        totalAssets += assets;
        totalShares += shares;
        depositTimestamps[receiver] = block.timestamp;

        // Transfer assets from user to vault
        asset.safeTransferFrom(msg.sender, address(this), assets);

        // Automatically initiate staking for 40%
        if (amountToStake > 0) {
            safeTransferAndSwap(minExpectedEth, receiver, amountToStake);
        }

        emit Deposit(msg.sender, receiver, assets, shares);
        emit StakeInitiated(
            receiver,
            amountToStake,
            block.timestamp + LOCK_PERIOD
        );

        return shares;
    }

    function performDailyUpdate() external nonReentrant onlyContract {
        require(
            block.timestamp >= lastDailyUpdate + UPDATE_INTERVAL,
            "Too soon to update"
        );

        uint256 startIndex = lastProcessedUserIndex;
        uint256 endIndex = Math.min(
            startIndex + MAX_USERS_PER_UPDATE,
            userAddresses.length
        );
        bool updateComplete = endIndex >= userAddresses.length;

        // Process a limited batch of users
        for (uint256 i = startIndex; i < endIndex; i++) {
            address user = userAddresses[i];

            // Check if user has staked assets that may need processing
            if (userWstETHBalance[user] > 0) {
                // Don't use global depositTimestamps - rely on individual deposit timestamps
                if (!withdrawalInProgress[user]) {
                    // Try to initiate withdrawals for eligible deposits
                    try this.safeInitiateWithdrawal(user) {
                        // Success: withdrawal initiated
                    } catch {
                        // Failed but continue with other users
                        emit WithdrawalInitiationFailed(user);
                    }
                }

                // Check for pending withdrawals that are ready
                if (withdrawalInProgress[user]) {
                    uint256 requestId = withdrawalRequestIds[user];
                    bool isWithdrawalReady = ILidoWithdrawal(
                        lidoWithdrawalAddress
                    ).isWithdrawalFinalized(requestId);

                    if (isWithdrawalReady) {
                        try this.safeProcessCompletedWithdrawal(user) {
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
        lastProcessedUserIndex = updateComplete ? 0 : endIndex;

        // Only update timestamp when we've processed all users
        if (updateComplete) {
            // Cleanup any expired locked assets
            _recalculateLockedAssets();
            lastDailyUpdate = block.timestamp;
            emit DailyUpdatePerformed(block.timestamp);
        } else {
            emit DailyUpdatePartial(startIndex, endIndex, userAddresses.length);
        }
    }

    function isUpdateNeeded() public view returns (bool) {
        return block.timestamp >= lastDailyUpdate + UPDATE_INTERVAL;
    }

    function triggerDailyUpdate() external onlyOwner {
        require(
            block.timestamp >= lastDailyUpdate + UPDATE_INTERVAL,
            "Too soon to update"
        );

        // Call performDailyUpdate through the contract itself
        this.performDailyUpdate();
    }

    function exchangeRate() public view returns (uint256) {
        if (totalShares == 0) {
            return 1e6;
        }
        // Include both liquid and staked assets
        uint256 totalValue = totalAssets + totalStakedValue;
        return (totalValue * 1e6) / totalShares;
    }

    function queueOperation(bytes32 operationId) internal {
        pendingOperations[operationId] = block.timestamp + TIMELOCK_DURATION;
    }

    function getWithdrawalStatus(
        address user
    )
        external
        view
        returns (bool isInProgress, uint256 requestId, bool isFinalized)
    {
        isInProgress = withdrawalInProgress[user];
        requestId = withdrawalRequestIds[user];
        isFinalized = requestId > 0
            ? ILidoWithdrawal(lidoWithdrawalAddress).isWithdrawalFinalized(
                requestId
            )
            : false;
    }

    function updateWstETHBalance(address user, uint256 amount) external {
        require(
            msg.sender == swapContract || msg.sender == owner,
            "Not authorized"
        );
        userWstETHBalance[user] += amount;
        emit WstETHBalanceUpdated(user, amount, userWstETHBalance[user]);
    }

    function getUnlockTime(
        address user
    ) public view returns (uint256[] memory) {
        // Get the user's deposits
        StakedDeposit[] storage deposits = userStakedDeposits[user];

        // Count active (non-withdrawn) deposits
        uint256 activeCount = 0;
        for (uint256 i = 0; i < deposits.length; i++) {
            if (!deposits[i].withdrawn) {
                activeCount++;
            }
        }

        // Create array for unlock times
        uint256[] memory unlockTimes = new uint256[](activeCount);

        // Populate array with unlock times for active deposits
        uint256 index = 0;
        for (uint256 i = 0; i < deposits.length; i++) {
            if (!deposits[i].withdrawn) {
                unlockTimes[index] = deposits[i].timestamp + LOCK_PERIOD;
                index++;
            }
        }

        // Sort array from nearest to farthest (simple bubble sort)
        for (uint256 i = 0; i < unlockTimes.length; i++) {
            for (uint256 j = i + 1; j < unlockTimes.length; j++) {
                if (unlockTimes[j] < unlockTimes[i]) {
                    uint256 temp = unlockTimes[i];
                    unlockTimes[i] = unlockTimes[j];
                    unlockTimes[j] = temp;
                }
            }
        }

        return unlockTimes;
    }

    function getNearestUnlockTime(address user) public view returns (uint256) {
        uint256[] memory times = getUnlockTime(user);
        if (times.length == 0) return 0;
        return times[0]; // Return earliest maturity date
    }

    function getWithdrawableAmount(address user) public view returns (uint256) {
        uint256 totalUserBalance = convertToAssets(balances[user]);

        // If user has no balance, nothing to withdraw
        if (totalUserBalance == 0) return 0;

        // Get all user's staked deposits
        StakedDeposit[] storage deposits = userStakedDeposits[user];

        // For users with no staked deposits, check global timestamp
        if (deposits.length == 0) {
            bool isLocked = block.timestamp <
                depositTimestamps[user] + LOCK_PERIOD;
            return
                isLocked
                    ? (totalUserBalance * LIQUID_PORTION) / 100
                    : totalUserBalance;
        }

        // Track matured and unmatured portions
        uint256 maturedValue = 0;
        uint256 unmaturedValue = 0;

        // Calculate the value of matured/unmatured deposits
        for (uint256 i = 0; i < deposits.length; i++) {
            if (!deposits[i].withdrawn) {
                if (block.timestamp >= deposits[i].timestamp + LOCK_PERIOD) {
                    maturedValue += deposits[i].amount;
                } else {
                    unmaturedValue += deposits[i].amount;
                }
            }
        }

        // Calculate total staked value
        uint256 userTotalStaked = maturedValue + unmaturedValue;

        // If all deposits are mature or no deposits exist, everything is withdrawable
        if (userTotalStaked == 0 || unmaturedValue == 0) {
            return totalUserBalance;
        }

        // Calculate withdrawable portion of unmatured deposits (60%)
        uint256 withdrawableFromUnmatured = (unmaturedValue * LIQUID_PORTION) /
            100;

        // Total withdrawable value is matured deposits + withdrawable portion of unmatured
        uint256 totalWithdrawableValue = maturedValue +
            withdrawableFromUnmatured;

        // Calculate ratio using proper USDC decimals (1e6)
        uint256 withdrawableRatio = (totalWithdrawableValue * 1e6) /
            userTotalStaked;

        // Apply the ratio to total balance
        return (totalUserBalance * withdrawableRatio) / 1e6;
    }

    function getLockedAmount(address user) public view returns (uint256) {
        uint256 withdrawable = getWithdrawableAmount(user);
        uint256 totalUserBalance = convertToAssets(balances[user]);

        // Prevent underflow if withdrawable exceeds balance for any reason
        return
            withdrawable >= totalUserBalance
                ? 0
                : totalUserBalance - withdrawable;
    }

    function getTotalStakedAssets() public view returns (uint256) {
        uint256 totalStaked = 0;

        // Iterate through all users
        for (uint256 i = 0; i < userAddresses.length; i++) {
            address user = userAddresses[i];

            // Get all of this user's staked deposits
            StakedDeposit[] storage deposits = userStakedDeposits[user];

            // Sum up all non-withdrawn deposits
            for (uint256 j = 0; j < deposits.length; j++) {
                if (!deposits[j].withdrawn) {
                    totalStaked += deposits[j].amount;
                }
            }
        }

        // Verify consistency with totalStakedValue state variable
        require(
            totalStaked == totalStakedValue ||
                (totalStaked == 0 && totalStakedValue == 0),
            "Staked accounting mismatch"
        );

        return totalStaked;
    }

    function updateLockedAssets() internal {
        uint256 currentTime = block.timestamp;
        if (currentTime >= lastUpdateTime + 1 days) {
            // Update locked assets daily
            _recalculateLockedAssets();
            lastUpdateTime = currentTime;
        }
    }

    function _recalculateLockedAssets() internal {
        for (uint256 i = 0; i < userAddresses.length; i++) {
            address user = userAddresses[i];

            // Get all user's deposits
            StakedDeposit[] storage deposits = userStakedDeposits[user];

            // Reset the user's staked portions and recalculate
            uint256 stillLockedAmount = 0;

            // Check each deposit individually
            for (uint256 j = 0; j < deposits.length; j++) {
                // Only consider deposits that haven't been withdrawn yet
                if (!deposits[j].withdrawn) {
                    // If deposit is still locked, count it towards locked amount
                    if (block.timestamp < deposits[j].timestamp + LOCK_PERIOD) {
                        stillLockedAmount += deposits[j].amount;
                    }
                }
            }

            // Update user's locked assets with what's still locked
            lockedAssets[user] = stillLockedAmount;

            // If we're using stakedPortions for accounting elsewhere, update it
            // but only for locked assets (not matured but unwithdrawn assets)
            stakedPortions[user] = stillLockedAmount;

            // Emit event for significant changes
            if (stillLockedAmount != lockedAssets[user]) {
                emit LockedAssetsUpdated(user, stillLockedAmount);
            }
        }
    }

    // Admin functions

    function setLidoWithdrawalAddress(
        address _lidoWithdrawal
    ) external onlyOwner {
        require(_lidoWithdrawal != address(0), "Invalid address");
        lidoWithdrawalAddress = _lidoWithdrawal;
    }

    function setWstETHAddress(address _wstETH) external onlyOwner {
        require(_wstETH != address(0), "Invalid address");
        wstETHAddress = _wstETH;
    }

    function setReceiverContract(address _receiver) external onlyOwner {
        require(_receiver != address(0), "Invalid address");
        receiverContract = _receiver;
    }

    function setSwapContract(address _swapContract) external onlyOwner {
        require(_swapContract != address(0), "Invalid address");
        swapContract = _swapContract;
    }

    function toggleEmergencyShutdown() external onlyOwner {
        emergencyShutdown = !emergencyShutdown;
        emit EmergencyShutdownToggled(emergencyShutdown);
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "Invalid address");
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(_feeCollector);
    }

    function collectAccumulatedFees() external {
        require(msg.sender == feeCollector, "Only fee collector");
        require(accumulatedFees > 0, "No fees to collect");

        uint256 feesToCollect = accumulatedFees;
        accumulatedFees = 0;

        asset.safeTransfer(feeCollector, feesToCollect);
        emit FeesCollected(feesToCollect);
    }
}
