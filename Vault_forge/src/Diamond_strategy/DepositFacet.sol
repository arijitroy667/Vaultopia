// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiamondStorage.sol";
import "./Modifiers.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

interface ILido {
    function submit(address _referral) external payable returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);
}

interface IWstETH {
    function wrap(uint256 _stETHAmount) external returns (uint256);

    function unwrap(uint256 _wstETHAmount) external returns (uint256);

    function getStETHByWstETH(
        uint256 _wstETHAmount
    ) external view returns (uint256);

    function getWstETHByStETH(
        uint256 _stETHAmount
    ) external view returns (uint256);
}

interface IUSDC is IERC20 {
    function decimals() external view returns (uint8);

    function approve(address spender, uint256 amount) external returns (bool);
}

interface ISwapContract {
    function swapExactUSDCForETH(
        uint amountIn,
        address to
    ) external returns (uint amountOut);

    function getETHAmountOut(
        uint usdcAmountIn
    ) external pure returns (uint ethAmountOut);
}

interface IReceiver {
    function batchStakeWithLido(
        bytes32 batchId,
        uint256 amountToStake
    ) external payable returns (uint256);

    function getStakedBalance(address user) external view returns (uint256);
}

contract DepositFacet is Modifiers {
    using SafeERC20 for IERC20;

    // Error definitions
    error ZeroAmount();
    error DepositsPaused();
    error MinimumDepositNotMet();
    error EmergencyShutdown();
    error NoSharesMinted();
    error SwapContractNotSet();
    error UnauthorizedCaller();
    error AmountTooSmall();
    error USDCApprovalFailed();
    error NoETHReceived();
    error BatchAlreadyProcessed();
    error ReceiverContractNotSet();
    error LidoContractNotSet();
    error WstETHContractNotSet();

    // Events
    event Deposit(
        address indexed sender,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );
    event StakeInitiated(
        address indexed user,
        uint256 amount,
        uint256 unlockTime
    );
    event SwapInitiated(
        address indexed user,
        uint256 stakedAmount,
        uint256 unlockTime
    );
    event WstETHBalanceUpdated(
        address indexed user,
        uint256 stakedUSDC,
        uint256 wstETHReceived
    );
    event DebugLog(string message, uint256 value);
    event DepositFailed(address indexed user, uint256 amount, string reason);
    event BatchRecoveryInitiated(bytes32 indexed batchId);

    function deposit(
        uint256 assets,
        address receiver
    ) external nonReentrantVault returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Validations
        if (assets == 0) revert ZeroAmount();
        if (ds.depositsPaused) revert DepositsPaused();
        if (assets < DiamondStorage.MIN_DEPOSIT_AMOUNT)
            revert MinimumDepositNotMet();
        if (ds.emergencyShutdown) revert EmergencyShutdown();
        
        // Calculate shares
        uint256 shares = previewDeposit(assets);
        if (shares == 0) revert NoSharesMinted();

        // Register new user if needed
        if (!ds.isExistingUser[receiver]) {
            ds.userAddresses.push(receiver);
            ds.isExistingUser[receiver] = true;
        }

        // Calculate staking portion (40%)
        uint256 amountToStake = (assets * DiamondStorage.STAKED_PORTION) / 100;

        // Update state
        ds.userDeposits[receiver] += assets;
        ds.balances[receiver] += shares;
        ds.totalAssets += assets;
        ds.totalShares += shares;
        ds.depositTimestamps[receiver] = block.timestamp;

        // Transfer assets from user to vault
        IERC20(ds.ASSET_TOKEN_ADDRESS).safeTransferFrom(
            msg.sender,
            address(this),
            assets
        );

        // Automatically initiate staking for 40%
        if (amountToStake > 0) {
            safeTransferAndSwap(receiver, amountToStake);
        }

        emit Deposit(msg.sender, receiver, assets, shares);
        return shares;
    }

    // Add to DepositFacet
    function simplifiedDeposit(
        uint256 assets,
        address receiver
    ) external nonReentrantVault returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        // Basic validations only
        if (assets == 0) revert ZeroAmount();
        if (assets < DiamondStorage.MIN_DEPOSIT_AMOUNT)
            revert MinimumDepositNotMet();

        // Calculate shares
        uint256 shares = previewDeposit(assets);
        if (shares == 0) revert NoSharesMinted();

        // Update state
        ds.userDeposits[receiver] += assets;
        ds.balances[receiver] += shares;
        ds.totalAssets += assets;
        ds.totalShares += shares;

        // Transfer assets from user to vault
        IERC20(ds.ASSET_TOKEN_ADDRESS).safeTransferFrom(
            msg.sender,
            address(this),
            assets
        );

        emit Deposit(msg.sender, receiver, assets, shares);

        return shares;
    }

    function safeTransferAndSwap(
        address beneficiary,
        uint256 amountToStake
    ) public nonReentrantVault returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        if (ds.receiverContract == address(0)) revert ReceiverContractNotSet();
        if (ds.lidoContract == address(0)) revert LidoContractNotSet();
        if (ds.wstETHAddress == address(0)) revert WstETHContractNotSet();
        if (ds.swapContract == address(0)) revert SwapContractNotSet();
        if (amountToStake == 0) revert AmountTooSmall();

        bytes32 batchId = keccak256(
            abi.encodePacked(block.timestamp, beneficiary, amountToStake)
        );

        // Create batch entry before updating state
        ds.stakeBatches[batchId].push(beneficiary);

        // Execute swap for staking
        IUSDC usdc = IUSDC(ds.ASSET_TOKEN_ADDRESS);
        bool success = usdc.approve(ds.swapContract, amountToStake);
        if (!success) revert USDCApprovalFailed();

        // Update state - will be reverted if swap fails
        ds.totalStakedValue += amountToStake;
        ds.stakedPortions[beneficiary] += amountToStake;

        uint256 ethReceived;
        try
            ISwapContract(ds.swapContract).swapExactUSDCForETH(
                amountToStake,
                ds.receiverContract // Send ETH directly to receiver
            )
        returns (uint256 receivedEth) {
            if (receivedEth == 0) revert NoETHReceived();
            ethReceived = receivedEth;
            emit DebugLog("ETH received from swap", ethReceived);
        } catch Error(string memory reason) {
            // Revert state changes
            ds.totalStakedValue -= amountToStake;
            ds.stakedPortions[beneficiary] -= amountToStake;

            // Reset approval
            usdc.approve(ds.swapContract, 0);

            emit DepositFailed(beneficiary, amountToStake, reason);
            revert(string(abi.encodePacked("Swap failed: ", reason)));
        } catch (bytes memory) {
            // Revert state changes
            ds.totalStakedValue -= amountToStake;
            ds.stakedPortions[beneficiary] -= amountToStake;

            // Reset approval
            usdc.approve(ds.swapContract, 0);

            emit DepositFailed(
                beneficiary,
                amountToStake,
                "Low-level swap error"
            );
            revert("Swap failed: unexpected error");
        }

        // Store the amount of ETH being sent for this user
        ds.pendingEthStakes[beneficiary] = ethReceived;

        if (ds.processedBatches[batchId]) revert BatchAlreadyProcessed();

        // Call receiver with batch ID - no need to send ETH as it's already sent by the swap
        uint256 wstETHReceived;
        try
            IReceiver(ds.receiverContract).batchStakeWithLido{value: 0}(
                batchId,
                ethReceived
            )
        returns (uint256 receivedWstETH) {
            wstETHReceived = receivedWstETH;
        } catch Error(string memory reason) {
            // Revert state changes
            ds.totalStakedValue -= amountToStake;
            ds.stakedPortions[beneficiary] -= amountToStake;
            ds.pendingEthStakes[beneficiary] = 0;

            // Reset approval
            usdc.approve(ds.swapContract, 0);

            emit DepositFailed(beneficiary, amountToStake, reason);
            revert(string(abi.encodePacked("Staking failed: ", reason)));
        } catch (bytes memory) {
            // Revert state changes
            ds.totalStakedValue -= amountToStake;
            ds.stakedPortions[beneficiary] -= amountToStake;
            ds.pendingEthStakes[beneficiary] = 0;

            // Reset approval
            usdc.approve(ds.swapContract, 0);

            emit DepositFailed(
                beneficiary,
                amountToStake,
                "Low-level staking error"
            );
            revert("Staking failed: unexpected error");
        }

        // Mark batch as processed
        ds.processedBatches[batchId] = true;

        // Calculate user's share and update state
        uint256 userShare = wstETHReceived;
        ds.userWstETHBalance[beneficiary] += userShare;

        ds.userStakedDeposits[beneficiary].push(
            DiamondStorage.StakedDeposit({
                amount: amountToStake,
                timestamp: block.timestamp,
                wstETHAmount: userShare,
                withdrawn: false
            })
        );

        // Clear pending stake
        ds.pendingEthStakes[beneficiary] = 0;

        // Emit events
        emit DebugLog("wstETH received", wstETHReceived);
        emit SwapInitiated(
            beneficiary,
            amountToStake,
            block.timestamp + DiamondStorage.LOCK_PERIOD
        );
        emit WstETHBalanceUpdated(beneficiary, amountToStake, wstETHReceived);
        emit StakeInitiated(
            beneficiary,
            amountToStake,
            block.timestamp + DiamondStorage.LOCK_PERIOD
        );

        // Reset approval
        usdc.approve(ds.swapContract, 0);

        return userShare;
    }

    function recoverStuckBatch(bytes32 batchId) external onlyOwner {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        ds.processedBatches[batchId] = false;
        emit BatchRecoveryInitiated(batchId);
    }

    // Helper functions moved to ViewFacet
    function previewDeposit(uint256 assets) public view returns (uint256) {
        if (assets == 0) revert ZeroAmount();
        return convertToShares(assets);
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        if (ds.totalAssets == 0 || ds.totalShares == 0) {
            return assets;
        }
        return (assets * ds.totalShares) / ds.totalAssets;
    }

    function maxDeposit(address receiver) public view returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        uint256 deposited = ds.userDeposits[receiver];
        return
            deposited >= DiamondStorage.MAX_DEPOSIT_PER_USER
                ? 0
                : DiamondStorage.MAX_DEPOSIT_PER_USER - deposited;
    }

    function checkContractSetup()
        external
        view
        returns (
            bool swapContractSet,
            bool receiverContractSet,
            bool lidoContractSet,
            bool wstEthContractSet,
            uint256 usdcBalance
        )
    {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();

        return (
            ds.swapContract != address(0),
            ds.receiverContract != address(0),
            ds.lidoContract != address(0),
            ds.wstETHAddress != address(0),
            IERC20(ds.ASSET_TOKEN_ADDRESS).balanceOf(address(this))
        );
    }
}
