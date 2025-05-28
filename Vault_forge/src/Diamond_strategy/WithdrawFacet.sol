// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiamondStorage.sol";
import "./Modifiers.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

interface ILidoWithdrawal {
    function requestWithdrawals(
        uint256[] calldata amounts,
        address recipient
    ) external returns (uint256[] memory requestIds);

    function isWithdrawalFinalized(
        uint256 requestId
    ) external view returns (bool);
}

interface IWstETH {
    function unwrap(uint256 _wstETHAmount) external returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);
}

interface IReceiver {
    function claimWithdrawalFromLido(
        uint256 requestId,
        address user,
        uint256 minUSDCExpected
    ) external returns (uint256 ethReceived, uint256 usdcReceived); // Return both ETH and USDC amounts
}

contract WithdrawFacet is Modifiers {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // Error definitions
    error EmergencyShutdown();
    error WithdrawalNotReady();
    error SlippageTooHigh(uint256 received, uint256 expected);
    error NoSharesToMint();
    error InvalidAmount();
    error NoWithdrawalInProgress();
    error WithdrawalAlreadyInProgress();
    error AddressNotSet();
    error NoEligibleDeposits();
    error ExternalCallFailed();

    // Events
    event Withdraw(
        address indexed sender,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );
    event WithdrawalFromLidoInitiated(
        address indexed user,
        uint256 wstETHAmount,
        uint256 stETHAmount,
        uint256 timestamp
    );
    event WithdrawalProcessed(
        address indexed user,
        uint256 ethReceived,
        uint256 usdcReceived,
        uint256 fee,
        uint256 sharesMinted
    );
    event StakedAssetsReturned(address indexed user, uint256 usdcReceived);
    event LidoWithdrawalCompleted(address indexed user, uint256 ethReceived);
    event PerformanceFeeCollected(address indexed user, uint256 fee);
    event WithdrawalStateReset(address indexed user);

    function withdraw(
        uint256 assets,
        address receiver,
        address _owner
    ) external nonReentrantVault returns (uint256 shares) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Basic validations
        if (assets == 0) revert InvalidAmount();
        if (receiver == address(0)) revert InvalidAmount();
        if (ds.emergencyShutdown) revert EmergencyShutdown();
        if (msg.sender != _owner) revert("Not authorized");

        // Calculate withdrawable amount
        (
            uint256 withdrawableAmount,
            uint256 remainingLiquidPortion
        ) = calculateWithdrawableAmount(_owner);

        // Ensure user isn't withdrawing more than allowed
        if (assets > withdrawableAmount)
            revert("Amount exceeds unlocked balance");

        // Calculate how much of this withdrawal comes from the liquid portion
        uint256 fromLiquidPortion = assets <= remainingLiquidPortion
            ? assets
            : remainingLiquidPortion;

        // Update used liquid portion tracking
        if (fromLiquidPortion > 0) {
            ds.usedLiquidPortion[_owner] += fromLiquidPortion;
        }

        // Calculate shares to burn
        shares = previewWithdraw(assets);
        if (shares > ds.balances[_owner]) revert("Insufficient shares");

        // Update state (following checks-effects-interactions pattern)
        ds.balances[_owner] -= shares;
        ds.totalShares -= shares;
        ds.totalAssets -= assets;

        // Transfer assets - this is the external interaction
        IERC20(ds.ASSET_TOKEN_ADDRESS).safeTransfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, _owner, assets, shares);
        return shares;
    }

    function processCompletedWithdrawals(
        address user,
        uint256 minUSDCExpected
    )
        external
        nonReentrantVault
        onlyAuthorizedOperator
        returns (uint256 sharesMinted, uint256 usdcReceived)
    {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Input validation
        if (!ds.withdrawalInProgress[user]) revert NoWithdrawalInProgress();
        if (user == address(0)) revert InvalidAmount();
        if (minUSDCExpected == 0) revert InvalidAmount();
        if (ds.lidoWithdrawalAddress == address(0)) revert AddressNotSet();
        if (ds.receiverContract == address(0)) revert AddressNotSet();

        uint256 requestId = ds.withdrawalRequestIds[user];

        // Check withdrawal status first
        if (
            !ILidoWithdrawal(ds.lidoWithdrawalAddress).isWithdrawalFinalized(
                requestId
            )
        ) {
            revert WithdrawalNotReady();
        }

        // Calculate withdrawn amounts
        (
            uint256 withdrawnAmount,
            uint256 withdrawnWstETH
        ) = getWithdrawnAmounts(user);

        if (withdrawnAmount == 0) revert InvalidAmount();

        // Have Receiver claim and process the withdrawal - before state changes
        // Update return type to get both ETH and USDC amounts
        uint256 ethReceived;
        (ethReceived, usdcReceived) = IReceiver(ds.receiverContract)
            .claimWithdrawalFromLido(requestId, user, minUSDCExpected);

        if (usdcReceived < minUSDCExpected)
            revert SlippageTooHigh(usdcReceived, minUSDCExpected);

        // Now that external call succeeded, update state
        ds.withdrawalInProgress[user] = false;
        delete ds.withdrawalRequestIds[user];

        // Only reduce by the amount being withdrawn
        ds.stakedPortions[user] -= withdrawnAmount;
        ds.userWstETHBalance[user] -= withdrawnWstETH;

        // Calculate and handle fees
        uint256 yield = usdcReceived > withdrawnAmount
            ? usdcReceived - withdrawnAmount
            : 0;
        uint256 fee = calculateFee(yield);
        uint256 userAmount = usdcReceived - fee;

        // Update fee accounting
        if (fee > 0) {
            ds.accumulatedFees += fee;
            emit PerformanceFeeCollected(user, fee);
        }

        // Calculate and mint shares
        sharesMinted = convertToShares(userAmount);
        if (sharesMinted == 0) revert NoSharesToMint();

        // Update global state
        ds.totalStakedValue -= withdrawnAmount;
        ds.totalAssets += userAmount;
        ds.totalShares += sharesMinted;
        ds.balances[user] += sharesMinted;

        // Emit events with accurate values
        emit WithdrawalProcessed(
            user,
            ethReceived, // Use actual ETH received
            usdcReceived,
            fee,
            sharesMinted
        );
        emit StakedAssetsReturned(user, userAmount);
        emit LidoWithdrawalCompleted(user, ethReceived); // Use actual ETH received

        return (sharesMinted, userAmount);
    }

    function safeProcessCompletedWithdrawal(
        address user
    ) external onlyContract returns (bool) {
        if (user == address(0)) revert InvalidAmount();

        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Verify withdrawal is in progress
        if (!ds.withdrawalInProgress[user]) revert NoWithdrawalInProgress();

        // Calculate withdrawn amount
        (uint256 withdrawnAmount, ) = getWithdrawnAmounts(user);
        if (withdrawnAmount == 0) revert InvalidAmount();

        // Calculate minimum expected USDC with slippage protection
        uint256 minExpectedUSDC = (withdrawnAmount *
            DiamondStorage.AUTO_WITHDRAWAL_SLIPPAGE) / 1000;

        // Process the withdrawal
        try this.processCompletedWithdrawals(user, minExpectedUSDC) returns (
            uint256,
            uint256
        ) {
            return true;
        } catch {
            // Don't revert the entire transaction if processing fails
            return false;
        }
    }

    function safeInitiateWithdrawal(
        address user
    ) external onlyContract returns (bool) {
        if (user == address(0)) revert InvalidAmount();

        try this.publicInitiateWithdrawal(user) {
            return true;
        } catch {
            return false;
        }
    }

    function calculateEligibleWithdrawalAmounts(
        address user
    )
        internal
        view
        returns (
            uint256 totalWstETH,
            uint256 totalAmount,
            uint256[] memory eligibleIndexes
        )
    {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // First count eligible deposits to size the array correctly
        uint256 eligibleCount = 0;
        for (uint256 i = 0; i < ds.userStakedDeposits[user].length; i++) {
            if (
                !ds.userStakedDeposits[user][i].withdrawn &&
                block.timestamp >=
                ds.userStakedDeposits[user][i].timestamp +
                    DiamondStorage.LOCK_PERIOD
            ) {
                eligibleCount++;
            }
        }

        // Initialize array to track eligible deposit indexes
        eligibleIndexes = new uint256[](eligibleCount);
        uint256 currentIndex = 0;

        // Calculate totals and store eligible indexes
        for (uint256 i = 0; i < ds.userStakedDeposits[user].length; i++) {
            if (
                !ds.userStakedDeposits[user][i].withdrawn &&
                block.timestamp >=
                ds.userStakedDeposits[user][i].timestamp +
                    DiamondStorage.LOCK_PERIOD
            ) {
                totalWstETH += ds.userStakedDeposits[user][i].wstETHAmount;
                totalAmount += ds.userStakedDeposits[user][i].amount;
                eligibleIndexes[currentIndex] = i;
                currentIndex++;
            }
        }

        return (totalWstETH, totalAmount, eligibleIndexes);
    }

    function markDepositsAsWithdrawn(
        address user,
        uint256[] memory eligibleIndexes
    ) internal {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        for (uint256 i = 0; i < eligibleIndexes.length; i++) {
            uint256 depositIndex = eligibleIndexes[i];
            ds.userStakedDeposits[user][depositIndex].withdrawn = true;
        }
    }

    function initiateAutomaticWithdrawal(address user) internal {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Validations remain the same
        if (ds.withdrawalInProgress[user]) revert WithdrawalAlreadyInProgress();
        if (ds.wstETHAddress == address(0)) revert AddressNotSet();
        if (ds.lidoWithdrawalAddress == address(0)) revert AddressNotSet();
        if (ds.receiverContract == address(0)) revert AddressNotSet();
        if (ds.userWstETHBalance[user] == 0) revert("No wstETH to withdraw");

        // Calculate eligible amounts WITHOUT modifying state
        uint256 totalWstETHToWithdraw;
        uint256 totalAmount;
        uint256[] memory eligibleIndexes;
        (
            totalWstETHToWithdraw,
            totalAmount,
            eligibleIndexes
        ) = calculateEligibleWithdrawalAmounts(user);

        // Only proceed if there's something to withdraw
        if (totalWstETHToWithdraw == 0) revert NoEligibleDeposits();

        // External calls that might fail
        bool approveSuccess = IWstETH(ds.wstETHAddress).approve(
            ds.lidoWithdrawalAddress,
            totalWstETHToWithdraw
        );
        if (!approveSuccess) revert ExternalCallFailed();

        uint256 stETHAmount = IWstETH(ds.wstETHAddress).unwrap(
            totalWstETHToWithdraw
        );

        // Request withdrawal from Lido
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = stETHAmount;
        uint256[] memory requestIds = ILidoWithdrawal(ds.lidoWithdrawalAddress)
            .requestWithdrawals(amounts, ds.receiverContract);

        // All external calls succeeded - NOW update state
        ds.withdrawalInProgress[user] = true;
        ds.withdrawalRequestIds[user] = requestIds[0];

        // Mark deposits as withdrawn ONLY after successful processing
        markDepositsAsWithdrawn(user, eligibleIndexes);

        emit WithdrawalFromLidoInitiated(
            user,
            totalWstETHToWithdraw,
            stETHAmount,
            block.timestamp
        );
    }

    // Add status checking function
    function checkWithdrawalStatus(
        address user
    ) external view returns (bool inProgress, bool isFinalized) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        inProgress = ds.withdrawalInProgress[user];

        if (inProgress) {
            uint256 requestId = ds.withdrawalRequestIds[user];
            isFinalized = ILidoWithdrawal(ds.lidoWithdrawalAddress)
                .isWithdrawalFinalized(requestId);
        }

        return (inProgress, isFinalized);
    }

    function resetStuckWithdrawalState(address user) external onlyOwner {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Verify this is actually a stuck state, not in-progress withdrawal
        require(ds.withdrawalInProgress[user], "No withdrawal in progress");
        require(ds.withdrawalRequestIds[user] == 0, "Active request ID exists");

        // Reset state
        ds.withdrawalInProgress[user] = false;

        emit WithdrawalStateReset(user);
    }

    // Helper function to get eligible withdrawal amounts
    function getEligibleWithdrawalAmounts(
        address user
    ) internal returns (uint256 totalWstETH, uint256 totalAmount) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        for (uint256 i = 0; i < ds.userStakedDeposits[user].length; i++) {
            if (
                !ds.userStakedDeposits[user][i].withdrawn &&
                block.timestamp >=
                ds.userStakedDeposits[user][i].timestamp +
                    DiamondStorage.LOCK_PERIOD
            ) {
                totalWstETH += ds.userStakedDeposits[user][i].wstETHAmount;
                totalAmount += ds.userStakedDeposits[user][i].amount;
                ds.userStakedDeposits[user][i].withdrawn = true;
            }
        }

        return (totalWstETH, totalAmount);
    }

    // Helper function to calculate withdrawable amount
    function calculateWithdrawableAmount(
        address user
    )
        internal
        view
        returns (uint256 withdrawable, uint256 remainingLiquidPortion)
    {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Calculate total liquid portion (60% of total deposits)
        uint256 totalLiquidPortion = (ds.userDeposits[user] *
            DiamondStorage.LIQUID_PORTION) / 100;

        // Calculate remaining liquid portion
        remainingLiquidPortion = 0;
        if (totalLiquidPortion > ds.usedLiquidPortion[user]) {
            remainingLiquidPortion =
                totalLiquidPortion -
                ds.usedLiquidPortion[user];
        }

        // Start with remaining liquid portion
        withdrawable = remainingLiquidPortion;

        // Add matured deposits
        for (uint256 i = 0; i < ds.userStakedDeposits[user].length; i++) {
            if (
                !ds.userStakedDeposits[user][i].withdrawn &&
                block.timestamp >=
                ds.userStakedDeposits[user][i].timestamp +
                    DiamondStorage.LOCK_PERIOD
            ) {
                withdrawable += ds.userStakedDeposits[user][i].amount;
            }
        }

        // Cap the withdrawable amount
        uint256 totalBalance = convertToAssets(ds.balances[user]);
        if (withdrawable > totalBalance) {
            withdrawable = totalBalance;
        }
    }

    // Helper function to get withdrawn amounts
    function getWithdrawnAmounts(
        address user
    ) internal view returns (uint256 amount, uint256 wstETH) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        for (uint256 i = 0; i < ds.userStakedDeposits[user].length; i++) {
            if (ds.userStakedDeposits[user][i].withdrawn) {
                wstETH += ds.userStakedDeposits[user][i].wstETHAmount;
                amount += ds.userStakedDeposits[user][i].amount;
            }
        }

        return (amount, wstETH);
    }

    // Utility functions
    function calculateFee(uint256 yield) internal pure returns (uint256) {
        if (yield == 0) return 0;

        uint256 fee = (yield * DiamondStorage.PERFORMANCE_FEE) /
            DiamondStorage.FEE_DENOMINATOR;

        // Don't charge fees for small yields
        if (yield <= DiamondStorage.MINIMUM_FEE) {
            return 0;
        }

        return Math.min(fee, yield);
    }

    function previewWithdraw(
        uint256 assets
    ) public view returns (uint256 shares) {
        if (assets == 0) revert InvalidAmount();

        shares = convertToShares(assets);
        return shares > 0 ? shares : 1; // Ensure at least 1 share is burned
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        if (ds.totalAssets == 0 || ds.totalShares == 0) {
            return assets;
        }
        return (assets * ds.totalShares) / ds.totalAssets;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        if (ds.totalShares == 0) {
            return shares;
        }
        return (shares * ds.totalAssets) / ds.totalShares;
    }

    function publicInitiateWithdrawal(address user) public onlyContract {
        initiateAutomaticWithdrawal(user);
    }

    function initiateWithdrawal() external {
        initiateAutomaticWithdrawal(msg.sender);
    }
}
