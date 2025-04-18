// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiamondStorage.sol";
import "./Modifiers.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

interface IUSDC is IERC20 {
    function decimals() external view returns (uint8);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface ISwapContract {
    function swapExactUSDCForETH(
        uint amountIn,
        uint amountOutMin,
        address to,
        uint deadline
    ) external returns (uint amountOut);
    
    function getETHAmountOut(
        uint usdcAmountIn
    ) external view returns (uint ethAmountOut);
}

interface IReceiver {
    function batchStakeWithLido(
        bytes32 batchId
    ) external payable returns (uint256);
}

contract DepositFacet is Modifiers {
    using SafeERC20 for IERC20;

    // Error definitions
    error ZeroAmount();
    error DepositsPaused();
    error MinimumDepositNotMet();
    error EmergencyShutdown();
    error NoSharesMinted();
    error LargeDepositNotTimelocked();
    error DepositAlreadyQueued();
    
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

    function deposit(
        uint256 assets,
        address receiver
    ) external nonReentrantVault returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        
        // Validations
        if (assets == 0) revert ZeroAmount();
        if (ds.depositsPaused) revert DepositsPaused();
        if (assets < DiamondStorage.MIN_DEPOSIT_AMOUNT) revert MinimumDepositNotMet();
        if (ds.emergencyShutdown) revert EmergencyShutdown();
        
        // Calculate shares
        uint256 shares = previewDeposit(assets);
        if (shares == 0) revert NoSharesMinted();
        
        // Check for large deposits that need timelock
        if (assets > ds.totalAssets / 10) {
            if (
                ds.largeDepositUnlockTime[msg.sender] == 0 ||
                block.timestamp < ds.largeDepositUnlockTime[msg.sender]
            ) revert LargeDepositNotTimelocked();
            
            delete ds.largeDepositUnlockTime[msg.sender];
        }
        
        // Register new user if needed
        if (!ds.isExistingUser[receiver]) {
            ds.userAddresses.push(receiver);
            ds.isExistingUser[receiver] = true;
        }
        
        // Calculate staking portion (40%)
        uint256 amountToStake = (assets * DiamondStorage.STAKED_PORTION) / 100;
        
        // Get expected ETH with 1% slippage tolerance
        uint256 expectedEth = ISwapContract(ds.swapContract).getETHAmountOut(amountToStake);
        uint256 minExpectedEth = (expectedEth * 99) / 100;
        
        // Update state
        ds.userDeposits[receiver] += assets;
        ds.balances[receiver] += shares;
        ds.totalAssets += assets;
        ds.totalShares += shares;
        ds.depositTimestamps[receiver] = block.timestamp;
        
        // Transfer assets from user to vault
        IERC20(ds.ASSET_TOKEN_ADDRESS).safeTransferFrom(msg.sender, address(this), assets);
        
        // Automatically initiate staking for 40%
        if (amountToStake > 0) {
            safeTransferAndSwap(minExpectedEth, receiver, amountToStake);
        }
        
        emit Deposit(msg.sender, receiver, assets, shares);
        emit StakeInitiated(
            receiver,
            amountToStake,
            block.timestamp + DiamondStorage.LOCK_PERIOD
        );
        
        return shares;
    }
    
    function safeTransferAndSwap(
        uint256 amountOutMin,
        address beneficiary,
        uint256 amountToStake
    ) public nonReentrantVault returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        
        require(ds.swapContract != address(0), "Swap contract not set");
        require(
            msg.sender == ds.owner || msg.sender == address(this),
            "Unauthorized"
        );
        require(amountToStake > 0, "Amount too small");

        bytes32 batchId = keccak256(
            abi.encodePacked(block.timestamp, beneficiary, amountToStake)
        );

        ds.totalStakedValue += amountToStake;
        ds.stakedPortions[beneficiary] += amountToStake;

        // Execute swap for staking
        IUSDC usdc = IUSDC(ds.ASSET_TOKEN_ADDRESS);
        bool success = usdc.approve(ds.swapContract, amountToStake);
        require(success, "USDC approval failed");

        // Calculate deadline (5 minutes from now)
        uint256 deadline = block.timestamp + 300;

        // First transfer USDC to the swap contract
        usdc.transferFrom(address(this), ds.swapContract, amountToStake);

        // Call the swap function with receiver contract as the ETH recipient
        uint256 ethReceived = ISwapContract(ds.swapContract).swapExactUSDCForETH(
            amountToStake,
            amountOutMin,
            ds.receiverContract, // Send ETH directly to receiver
            deadline
        );

        require(ethReceived > 0, "No ETH received from swap");

        // Store the amount of ETH being sent for this user
        ds.pendingEthStakes[beneficiary] = ethReceived;

        // Add user to current batch
        ds.stakeBatches[batchId].push(beneficiary);

        // Call receiver with batch ID - no need to send ETH as it's already sent by the swap
        uint256 wstETHReceived = IReceiver(ds.receiverContract).batchStakeWithLido{
            value: 0
        }(batchId);

        require(!ds.processedBatches[batchId], "Batch already processed");
        ds.processedBatches[batchId] = true;

        // Calculate user's share
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

    function queueLargeDeposit() external {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        if (ds.largeDepositUnlockTime[msg.sender] != 0) revert DepositAlreadyQueued();
        ds.largeDepositUnlockTime[msg.sender] = block.timestamp + DiamondStorage.DEPOSIT_TIMELOCK;
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
}