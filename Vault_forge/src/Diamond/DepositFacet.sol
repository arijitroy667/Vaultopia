// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiamondStorage.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

// Interface definitions
interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

interface IUSDC is IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
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

// Custom errors
error DepositsPaused();
error EmergencyShutdown();
error ZeroAmount();
error MinimumDepositNotMet();
error LargeDepositNotTimelocked();
error NoSharesMinted();
error USDCApprovalFailed();
error NoETHReceived();
error SwapContractNotSet();
error AmountTooSmall();
error BatchAlreadyProcessed();
error DepositAlreadyQueued();

contract DepositFacet is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using Math for uint256;

    // Storage constants
    uint256 private constant MAX_DEPOSIT_PER_USER = 4999 * 1e6;
    uint256 private constant MIN_DEPOSIT_AMOUNT = 100 * 1e6; 
    uint256 private constant STAKED_PORTION = 40; 
    uint256 private constant LOCK_PERIOD = 30 days;
    uint256 private constant DEPOSIT_TIMELOCK = 1 hours;

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
    ) external nonReentrant returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        
        // Validations
        if (assets == 0) revert ZeroAmount();
        if (ds.depositsPaused) revert DepositsPaused();
        if (assets < MIN_DEPOSIT_AMOUNT) revert MinimumDepositNotMet();
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
        uint256 amountToStake = (assets * STAKED_PORTION) / 100;
        
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
            block.timestamp + LOCK_PERIOD
        );
        
        return shares;
    }
    
    // Helper functions
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
            deposited >= MAX_DEPOSIT_PER_USER
                ? 0
                : MAX_DEPOSIT_PER_USER - deposited;
    }
    
    function safeTransferAndSwap(
        uint256 amountOutMin,
        address beneficiary,
        uint256 amountToStake
    ) internal returns (uint256) {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        
        if (ds.swapContract == address(0)) revert SwapContractNotSet();
        if (amountToStake == 0) revert AmountTooSmall();
        
        bytes32 batchId = keccak256(
            abi.encodePacked(block.timestamp, beneficiary, amountToStake)
        );
        
        ds.totalStakedValue += amountToStake;
        ds.stakedPortions[beneficiary] += amountToStake;
        
        // Execute swap for staking
        IUSDC usdc = IUSDC(ds.ASSET_TOKEN_ADDRESS);
        bool success = usdc.approve(ds.swapContract, amountToStake);
        if (!success) revert USDCApprovalFailed();
        
        // Calculate deadline (5 minutes from now)
        uint256 deadline = block.timestamp + 300;
        
        // Transfer USDC to swap contract
        usdc.transferFrom(address(this), ds.swapContract, amountToStake);
        
        // Call swap function
        uint256 ethReceived = ISwapContract(ds.swapContract).swapExactUSDCForETH(
            amountToStake,
            amountOutMin,
            ds.receiverContract,
            deadline
        );
        
        if (ethReceived == 0) revert NoETHReceived();
        
        // Store ETH amount for this user
        ds.pendingEthStakes[beneficiary] = ethReceived;
        
        // Add user to current batch
        ds.stakeBatches[batchId].push(beneficiary);
        
        // Call receiver with batch ID
        uint256 wstETHReceived = IReceiver(ds.receiverContract).batchStakeWithLido{
            value: 0
        }(batchId);
        
        if (ds.processedBatches[batchId]) revert BatchAlreadyProcessed();
        ds.processedBatches[batchId] = true;
        
        // Calculate user's share
        uint256 userShare = wstETHReceived;
        ds.userWstETHBalance[beneficiary] += userShare;
        
        // Create staked deposit record
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
            block.timestamp + LOCK_PERIOD
        );
        
        emit WstETHBalanceUpdated(beneficiary, amountToStake, wstETHReceived);
        
        // Reset approval
        usdc.approve(ds.swapContract, 0);
        
        return userShare;
    }
    
    function queueLargeDeposit() external {
        DiamondStorage.VaultState storage ds = DiamondStorage.getStorage();
        if (ds.largeDepositUnlockTime[msg.sender] != 0) revert DepositAlreadyQueued();
        ds.largeDepositUnlockTime[msg.sender] = block.timestamp + DEPOSIT_TIMELOCK;
    }
}