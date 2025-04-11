// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BaseVault.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

abstract contract StakingController is BaseVault {
    using SafeMath for uint256;
    using Math for uint256;

    constructor(address _assetToken) BaseVault(_assetToken) {}

    function calculateFee(uint256 yield) internal pure returns (uint256) {
        if (yield == 0) return 0;

        uint256 fee = yield.mul(PERFORMANCE_FEE).div(FEE_DENOMINATOR);

        // Don't charge minimum fee if yield is too small
        if (yield <= MINIMUM_FEE) {
            return yield;
        }

        return Math.min(fee, yield);
    }

    function processCompletedWithdrawals(
        address user,
        uint256 minUSDCExpected
    )
        public
        nonReentrant
        onlyAuthorizedOperator
        returns (uint256 sharesMinted, uint256 usdcReceived)
    {
        // Input validation
        if (!withdrawalInProgress[user]) revert NoWithdrawalInProgress();
        if (user == address(0)) revert InvalidAmount();
        if (minUSDCExpected == 0) revert InvalidAmount();

        uint256 requestId = withdrawalRequestIds[user];
        uint256 withdrawnAmount = 0;
        uint256 withdrawnWstETH = 0;
        for (uint256 i = 0; i < userStakedDeposits[user].length; i++) {
            if (userStakedDeposits[user][i].withdrawn) {
                withdrawnWstETH += userStakedDeposits[user][i].wstETHAmount;
                withdrawnAmount += userStakedDeposits[user][i].amount;
            }
        }

        // Only reduce by the amount being withdrawn, not zeroing everything
        stakedPortions[user] -= withdrawnAmount;
        userWstETHBalance[user] -= withdrawnWstETH;

        // Check withdrawal status
        if (
            !ILidoWithdrawal(lidoWithdrawalAddress).isWithdrawalFinalized(
                requestId
            )
        ) {
            revert WithdrawalNotReady();
        }

        // Clear withdrawal state first
        withdrawalInProgress[user] = false;
        delete withdrawalRequestIds[user];

        // Get USDC through Receiver → Swap path
        usdcReceived = IReceiver(receiverContract).claimWithdrawalFromLido(
            requestId,
            user,
            minUSDCExpected
        );

        if (usdcReceived < minUSDCExpected)
            revert SlippageTooHigh(usdcReceived, minUSDCExpected);

        // Calculate and handle fees
        uint256 yield = usdcReceived > withdrawnAmount
            ? usdcReceived - withdrawnAmount
            : 0;
        uint256 fee = calculateFee(yield);
        uint256 userAmount = usdcReceived - fee;

        // Update fee accounting if applicable
        if (fee > 0) {
            accumulatedFees = accumulatedFees.add(fee);
            emit PerformanceFeeCollected(user, fee);
        }

        // Calculate and mint shares
        sharesMinted = convertToShares(userAmount);
        if (sharesMinted == 0) revert NoSharesToMint();

        // Update global state
        totalStakedValue = totalStakedValue.sub(withdrawnAmount);
        totalAssets = totalAssets.add(userAmount);
        totalShares = totalShares.add(sharesMinted);
        balances[user] = balances[user].add(sharesMinted);

        // Emit events
        emit WithdrawalProcessed(
            user,
            0, // We don't track ethReceived in Vault anymore
            usdcReceived,
            fee,
            sharesMinted
        );
        emit StakedAssetsReturned(user, userAmount);
        emit LidoWithdrawalCompleted(user, 0);

        return (sharesMinted, userAmount);
    }

    function safeProcessCompletedWithdrawal(
        address user
    ) external onlyContract returns (bool) {
        // Calculate withdrawn amount
        uint256 withdrawnAmount = 0;
        for (uint256 i = 0; i < userStakedDeposits[user].length; i++) {
            if (userStakedDeposits[user][i].withdrawn) {
                withdrawnAmount += userStakedDeposits[user][i].amount;
            }
        }

        // Calculate minimum expected USDC with slippage protection
        uint256 minExpectedUSDC = (withdrawnAmount * AUTO_WITHDRAWAL_SLIPPAGE) /
            1000;

        // Process the withdrawal by calling your existing function
        processCompletedWithdrawals(user, minExpectedUSDC);
        return true;
    }

    function safeInitiateWithdrawal(
        address user
    ) external onlyContract returns (bool) {
        // Individual deposits are checked within initiateAutomaticWithdrawal
        initiateAutomaticWithdrawal(user);
        return true;
    }

    function initiateAutomaticWithdrawal(address user) internal {
        require(userWstETHBalance[user] > 0, "No wstETH to withdraw");

        uint256 totalWstETHToWithdraw = 0;
        uint256 totalAmountWithdrawn = 0;

        for (uint256 i = 0; i < userStakedDeposits[user].length; i++) {
            if (
                !userStakedDeposits[user][i].withdrawn &&
                block.timestamp >=
                userStakedDeposits[user][i].timestamp + LOCK_PERIOD
            ) {
                totalWstETHToWithdraw += userStakedDeposits[user][i]
                    .wstETHAmount;
                totalAmountWithdrawn += userStakedDeposits[user][i].amount;
                userStakedDeposits[user][i].withdrawn = true;
            }
        }

        // Only proceed if there's something to withdraw
        require(totalWstETHToWithdraw > 0, "No eligible deposits to withdraw");

        uint256 wstETHAmount = totalWstETHToWithdraw;
        withdrawalInProgress[user] = true;

        // First unwrap wstETH to stETH
        IWstETH(wstETHAddress).approve(
            lidoWithdrawalAddress,
            totalWstETHToWithdraw
        );
        uint256 stETHAmount = IWstETH(wstETHAddress).unwrap(
            totalWstETHToWithdraw
        );

        // Request withdrawal from Lido
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = stETHAmount;
        uint256[] memory requestIds = ILidoWithdrawal(lidoWithdrawalAddress)
            .requestWithdrawals(amounts, receiverContract);

        withdrawalRequestIds[user] = requestIds[0];
        emit WithdrawalFromLidoInitiated(user, wstETHAmount);
    }

    function safeTransferAndSwap(
        uint256 amountOutMin,
        address beneficiary,
        uint256 amountToStake
    ) public nonReentrant returns (uint256) {
        require(swapContract != address(0), "Swap contract not set");
        require(
            msg.sender == owner || msg.sender == address(this),
            "Unauthorized"
        );
        require(amountToStake > 0, "Amount too small");

        bytes32 batchId = keccak256(
            abi.encodePacked(block.timestamp, beneficiary, amountToStake)
        );

        totalStakedValue += amountToStake;
        stakedPortions[beneficiary] += amountToStake;

        // Execute swap for staking
        bool success = USDC.approve(swapContract, amountToStake);
        require(success, "USDC approval failed");

        // Calculate deadline (5 minutes from now)
        uint256 deadline = block.timestamp + 300;

        // Transfer USDC to the swap contract
        USDC.transferFrom(address(this), swapContract, amountToStake);

        // Call the swap function with receiver contract as the ETH recipient
        uint256 ethReceived = ISwapContract(swapContract).swapExactUSDCForETH(
            amountToStake,
            amountOutMin,
            receiverContract,
            deadline
        );

        require(ethReceived > 0, "No ETH received from swap");

        // Store the amount of ETH being sent for this user
        pendingEthStakes[beneficiary] = ethReceived;

        // Add user to current batch
        stakeBatches[batchId].push(beneficiary);

        // Call receiver with batch ID
        uint256 wstETHReceived = IReceiver(receiverContract).batchStakeWithLido{
            value: 0
        }(batchId);

        require(!processedBatches[batchId], "Batch already processed");
        processedBatches[batchId] = true;

        // Calculate user's share
        uint256 userShare = wstETHReceived;
        userWstETHBalance[beneficiary] += userShare;

        userStakedDeposits[beneficiary].push(
            StakedDeposit({
                amount: amountToStake,
                timestamp: block.timestamp,
                wstETHAmount: userShare,
                withdrawn: false
            })
        );

        // Clear pending stake
        pendingEthStakes[beneficiary] = 0;

        emit SwapInitiated(
            beneficiary,
            amountToStake,
            block.timestamp + LOCK_PERIOD
        );
        emit WstETHBalanceUpdated(beneficiary, amountToStake, wstETHReceived);
        emit StakeInitiated(
            beneficiary,
            amountToStake,
            block.timestamp + LOCK_PERIOD
        );

        // Reset approval
        USDC.approve(swapContract, 0);

        return userShare;
    }
}
