// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./Interfaces.sol";

// This contract holds shared storage variables to avoid inheritance issues
abstract contract VaultStorage is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    struct StakedDeposit {
        uint256 amount;
        uint256 timestamp;
        uint256 wstETHAmount;
        bool withdrawn;
    }

    // Constants
    uint256 public constant MAX_DEPOSIT_PER_USER = 4999 * 1e6;
    uint256 public constant TIMELOCK_DURATION = 2 days;
    uint256 public constant LOCK_PERIOD = 30 days;
    uint256 public constant STAKED_PORTION = 40; // 40%
    uint256 public constant LIQUID_PORTION = 60; // 60%
    uint256 public constant INSTANT_WITHDRAWAL_LIMIT = 60;
    uint256 public constant UPDATE_INTERVAL = 1 days;
    uint256 public constant PERFORMANCE_FEE = 300; // 3%
    uint256 public constant MIN_DEPOSIT_AMOUNT = 100 * 1e6; // 100 USDC minimum
    uint256 public constant DEPOSIT_TIMELOCK = 1 hours;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MINIMUM_FEE = 1e6; // 1 USDC minimum fee
    uint256 public constant AUTO_WITHDRAWAL_SLIPPAGE = 950; // 95% of original stake
    uint256 public constant MAX_USERS_PER_UPDATE = 20; // Process 20 users at a time

    // State variables
    uint256 public totalAssets; 
    uint256 public totalShares;
    uint256 public lastUpdateTime;
    uint256 public lastDailyUpdate;
    uint256 public totalStakedValue;
    uint256 public accumulatedFees;
    uint256 public lastProcessedUserIndex;
    bool public emergencyShutdown;
    bool public depositsPaused;

    // Address variables
    address public owner;
    address[] internal userAddresses;
    address public immutable ASSET_TOKEN_ADDRESS;
    address public swapContract;
    address public feeCollector;
    address public lidoWithdrawalAddress;
    address public wstETHAddress;
    address public receiverContract;
    IUSDC public immutable USDC;
    IERC20 public immutable asset;
    uint8 internal immutable _decimals;

    // Mappings
    mapping(bytes32 => uint256) public pendingOperations;
    mapping(address => uint256) public stakedPortions; 
    mapping(address => uint256) public userDeposits;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public depositTimestamps;
    mapping(address => uint256) public lockedAssets;
    mapping(address => bool) internal isExistingUser;
    mapping(address => uint256) public userWstETHBalance;
    mapping(address => bool) public withdrawalInProgress;
    mapping(address => uint256) public withdrawalRequestIds;
    mapping(address => uint256) public largeDepositUnlockTime;
    mapping(address => uint256) public pendingEthStakes;
    mapping(bytes32 => address[]) public stakeBatches;
    mapping(bytes32 => bool) public processedBatches;
    mapping(address => StakedDeposit[]) public userStakedDeposits;

    // Events
    event Deposit(
        address indexed sender,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );
    event Withdraw(
        address indexed sender,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );
    event LockedAssetsUpdated(address indexed user, uint256 amount);
    event WithdrawalRequested(
        address indexed user,
        uint256 amount,
        uint256 unlockTime
    );
    event StakedPortionLocked(
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
    event FeeCollectorUpdated(address indexed newFeeCollector);
    event PerformanceFeeCollected(address indexed user, uint256 fee);
    event EmergencyShutdownToggled(bool enabled);
    event WithdrawalFromLidoInitiated(
        address indexed user,
        uint256 wstETHAmount
    );
    event LidoWithdrawalCompleted(address indexed user, uint256 ethReceived);
    event FeesCollected(uint256 amount);
    event StakedAssetsReturned(address indexed user, uint256 usdcReceived);
    event StakeInitiated(
        address indexed user,
        uint256 amount,
        uint256 unlockTime
    );
    event WithdrawalProcessed(
        address indexed user,
        uint256 ethReceived,
        uint256 usdcReceived,
        uint256 fee,
        uint256 sharesMinted
    );
    event WithdrawalInitiationFailed(address indexed user);
    event WithdrawalProcessingFailed(address indexed user, uint256 requestId);
    event DailyUpdatePartial(
        uint256 startIndex,
        uint256 endIndex,
        uint256 totalUsers
    );
    event DailyUpdatePerformed(uint256 timestamp);

    // Custom errors
    error NoWithdrawalInProgress();
    error WithdrawalNotReady();
    error SlippageTooHigh(uint256 received, uint256 expected);
    error NoSharesToMint();
    error InvalidAmount();
    
    constructor(address _assetToken) {
        ASSET_TOKEN_ADDRESS = _assetToken;
        asset = IERC20(_assetToken);
        USDC = IUSDC(_assetToken);
        _decimals = USDC.decimals();
    }

    // Modifiers
    modifier onlyContract() {
        require(msg.sender == address(this), "Only contract can call");
        _;
    }
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }
    
    modifier onlyAuthorizedOperator() {
        require(
            msg.sender == owner || msg.sender == address(this),
            "Not authorized"
        );
        _;
    }
}