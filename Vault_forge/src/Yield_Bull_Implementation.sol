// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StakingController.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./Errors.sol";

contract Yield_Bull_Implementation is StakingController {
    using Math for uint256;
    using SafeERC20 for IERC20;

    // Storage slot for initialized flag
    bytes32 private constant INITIALIZED_SLOT = keccak256("proxy.initialized");

    constructor() StakingController(address(0)) {
        // The actual initialization happens in the initialize function
        // This constructor only exists to satisfy the inheritance requirements
    }

    // Add this function to initialize storage variables normally set in the VaultStorage constructor
    function _initializeVaultStorage(address _assetToken) internal {
        // These would normally be set in the VaultStorage constructor
        // but need to be set manually when using a proxy

        // We can't set immutables through a proxy, so we need to use storage variables instead
        bytes32 assetTokenAddressSlot = keccak256("ASSET_TOKEN_ADDRESS_SLOT");
        bytes32 assetSlot = keccak256("ASSET_SLOT");
        bytes32 usdcSlot = keccak256("USDC_SLOT");
        bytes32 decimalsSlot = keccak256("DECIMALS_SLOT");

        // Store values in specific storage slots
        assembly {
            sstore(assetTokenAddressSlot, _assetToken)
        }

        // Initialize regular contract state
        asset = IERC20(_assetToken);
        USDC = IUSDC(_assetToken);
        _decimals = USDC.decimals();
    }

    // Replace constructor with initializer
    function initialize(
        address _assetToken,
        address _lidoWithdrawal,
        address _wstETH,
        address _receiver,
        address _swapContract
    ) external {
        // Check if already initialized
        bytes32 initializedSlot = INITIALIZED_SLOT;
        bool initialized;
        assembly {
            initialized := sload(initializedSlot)
        }
        require(!initialized, "Already initialized");

        // Set initialized flag
        assembly {
            sstore(initializedSlot, true)
        }

        // Initialize VaultStorage first
        _initializeVaultStorage(_assetToken);

        // Continue with initialization
        if (_lidoWithdrawal == address(0)) revert InvalidAddress();
        if (_wstETH == address(0)) revert InvalidAddress();
        if (_receiver == address(0)) revert InvalidAddress();
        if (_swapContract == address(0)) revert InvalidAddress();

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
        if (assets == 0) revert ZeroAmount();
        if (depositsPaused) revert DepositsPaused();
        if (assets < MIN_DEPOSIT_AMOUNT) revert ZeroAmount();
        if (emergencyShutdown) revert EmergencyActive();

        shares = previewDeposit(assets);
        if (shares == 0) revert ZeroAmount();

        if (assets > totalAssets / 10) {
            // If deposit is > 10% of total assets
            if (
                largeDepositUnlockTime[msg.sender] == 0 ||
                block.timestamp < largeDepositUnlockTime[msg.sender]
            ) revert InvalidDeadline();
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
        if (block.timestamp <= lastDailyUpdate + UPDATE_INTERVAL)
            revert InvalidDeadline();

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

    function isUpdateNeeded() public view returns (bool) {
        return block.timestamp >= lastDailyUpdate + UPDATE_INTERVAL;
    }

    function triggerDailyUpdate() external onlyOwner {
        if (block.timestamp <= lastDailyUpdate + UPDATE_INTERVAL)
            revert InvalidDeadline();

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
        if (msg.sender != swapContract && msg.sender != owner)
            revert NotAuthorized();
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

    // Remaining view functions moved to VaultLens for optimization
    // Only core functionality here

    // Admin functions
    function setLidoWithdrawalAddress(
        address _lidoWithdrawal
    ) external onlyOwner {
        if (_lidoWithdrawal == address(0)) revert InvalidAddress();
        lidoWithdrawalAddress = _lidoWithdrawal;
    }

    function setWstETHAddress(address _wstETH) external onlyOwner {
        if (_wstETH == address(0)) revert InvalidAddress();
        wstETHAddress = _wstETH;
    }

    function setReceiverContract(address _receiver) external onlyOwner {
        if (_receiver == address(0)) revert InvalidAddress();
        receiverContract = _receiver;
    }

    function setSwapContract(address _swapContract) external onlyOwner {
        if (_swapContract == address(0)) revert InvalidAddress();
        swapContract = _swapContract;
    }

    function toggleEmergencyShutdown() external onlyOwner {
        emergencyShutdown = !emergencyShutdown;
        emit EmergencyShutdownToggled(emergencyShutdown);
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        if (_feeCollector == address(0)) revert InvalidAddress();
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(_feeCollector);
    }

    function collectAccumulatedFees() external {
        if (msg.sender != feeCollector) revert NotAuthorized();
        if (accumulatedFees == 0) revert ZeroAmount();

        uint256 feesToCollect = accumulatedFees;
        accumulatedFees = 0;

        asset.safeTransfer(feeCollector, feesToCollect);
        emit FeesCollected(feesToCollect);
    }
}
