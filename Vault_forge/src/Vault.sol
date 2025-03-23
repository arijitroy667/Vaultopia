// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title Yield_Bull
 * @dev An ERC4626-compliant vault implementation with deposit limits per user
 */
contract Yield_Bull is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;
    address public swapContract;
    uint256 public lastUpdateTime;
    address public feeCollector;
    bool public emergencyShutdown;
    bool public depositsPaused;
    address public owner;
    address[] private userAddresses;

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
    event WithdrawalRequested(address indexed user, uint256 amount, uint256 unlockTime);
    event StakedPortionLocked(address indexed user, uint256 amount, uint256 unlockTime);
    event SwapInitiated(uint256 amount, uint256 minAmountOut);
    event EmergencyShutdownToggled(bool enabled);
    event FeeCollectorUpdated(address indexed newFeeCollector);

    // State variables
    address public immutable ASSET_TOKEN_ADDRESS =
        0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    uint256 public constant MAX_DEPOSIT_PER_USER = 4999 * 1e6;
    uint256 public constant TIMELOCK_DURATION = 2 days;
    mapping(bytes32 => uint256) public pendingOperations;
    mapping(address => uint256) public stakedPortions; // Track 40% staked amount per user
    mapping(address => uint256) public userDeposits;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public depositTimestamps;
    mapping(address => uint256) public lockedAssets;
    mapping(address => bool) private isExistingUser;

    uint256 public totalAssets; // Total assets in the vault
    uint256 public totalShares; // Total shares issued by the vault

    uint256 public constant LOCK_PERIOD = 30 days;
    uint256 public constant INSTANT_WITHDRAWAL_LIMIT = 60;

    IERC20 public immutable asset;
    uint8 private immutable _decimals;

    constructor() {
        asset = IERC20(ASSET_TOKEN_ADDRESS);
        _decimals = IERC20Metadata(ASSET_TOKEN_ADDRESS).decimals();
         owner = msg.sender;
    }

    /**
     * @dev Returns the exchange rate between shares and assets
     * @return The exchange rate (assets per share) multiplied by 1e18 for precision
     */
    function exchangeRate() public view returns (uint256) {
        if (totalShares == 0) {
            return 1e18; // Initial exchange rate: 1 share = 1 asset
        }
        return (totalAssets * 1e18) / totalShares;
    }

    function queueOperation(bytes32 operationId) internal {
        pendingOperations[operationId] = block.timestamp + TIMELOCK_DURATION;
    }
    /**
     * @dev Converts a given amount of assets to shares
     * @param assets The amount of assets to convert
     * @return shares The equivalent amount of shares
     */
    function convertToShares(
        uint256 assets
    ) public view returns (uint256 shares) {
        if (totalAssets == 0 || totalShares == 0) {
            return assets; // Initial conversion: 1:1
        }
        return (assets * totalShares) / totalAssets;
    }

    /**
     * @dev Converts a given amount of shares to assets
     * @param shares The amount of shares to convert
     * @return assets The equivalent amount of assets
     */
    function convertToAssets(
        uint256 shares
    ) public view returns (uint256 assets) {
        if (totalShares == 0) {
            return shares; // Initial conversion: 1:1
        }
        return (shares * totalAssets) / totalShares;
    }

    /**
     * @dev Returns the maximum amount of assets that can be deposited by a specific receiver
     * @param receiver The address that will receive the shares
     * @return maxAssets The maximum amount of assets that can be deposited
     */
    function maxDeposit(
        address receiver
    ) public view returns (uint256 maxAssets) {
        uint256 deposited = userDeposits[receiver];
        return
            deposited >= MAX_DEPOSIT_PER_USER
                ? 0
                : MAX_DEPOSIT_PER_USER - deposited;
    }

    /**
     * @dev Previews the amount of shares that would be minted for a given deposit amount
     * @param assets The amount of assets to deposit
     * @return shares The amount of shares that would be minted
     */
    function previewDeposit(
        uint256 assets
    ) public view returns (uint256 shares) {
        require(assets > 0, "Deposit amount must be greater than zero");
        return convertToShares(assets);
    }

    /**
     * @dev Deposits assets and mints shares to receiver
     * @param assets The amount of assets to deposit
     * @param receiver The address that will receive the shares
     * @return shares The amount of shares minted
     */
    function deposit(
        uint256 assets,
        address receiver
    ) public nonReentrant returns (uint256 shares) {
        require(assets > 0, "Deposit amount must be greater than zero");

        uint256 maxDepositable = maxDeposit(receiver);
        require(maxDepositable >= assets, "Deposit exceeds limit");

        shares = previewDeposit(assets);
        require(shares > 0, "Zero shares minted");
        
         if (!isExistingUser[receiver]) {
            userAddresses.push(receiver);
            isExistingUser[receiver] = true;
        }

        // Calculate and track staked portion (40%)
        uint256 stakedPortion = (assets * 40) / 100;
        stakedPortions[receiver] += stakedPortion;

        // Update state
        userDeposits[receiver] += assets;
        balances[receiver] += shares;
        totalAssets += assets;
        totalShares += shares;
        depositTimestamps[receiver] = block.timestamp;
        lockedAssets[receiver] += stakedPortion; // Only lock the staked portion


        // Transfer assets from user to vault
        asset.safeTransferFrom(msg.sender, address(this), assets);

        emit Deposit(msg.sender, receiver, assets, shares);
        emit LockedAssetsUpdated(receiver, lockedAssets[receiver]);
        return shares;
    }

    function toggleDeposits() external {
        require(msg.sender == owner, "Not authorized");
        depositsPaused = !depositsPaused;
    }

    /**
     * @dev Returns the maximum amount of shares that can be minted for a specific receiver
     * @param receiver The address that will receive the shares
     * @return maxShares The maximum amount of shares that can be minted
     */
    function maxMint(address receiver) public view returns (uint256 maxShares) {
        uint256 maxAssets = maxDeposit(receiver);
        return convertToShares(maxAssets);
    }

    /**
     * @dev Previews the amount of assets that would be required for a given mint amount
     * @param shares The amount of shares to mint
     * @return assets The amount of assets required
     */
    function previewMint(uint256 shares) public view returns (uint256 assets) {
        require(shares > 0, "Shares must be greater than zero");
        return convertToAssets(shares);
    }

    /**
     * @dev Mints shares to receiver by depositing assets
     * @param shares The amount of shares to mint
     * @param receiver The address that will receive the shares
     * @return assets The amount of assets deposited
     */
    function mint(
        uint256 shares,
        address receiver
    ) public nonReentrant returns (uint256 assets) {
        require(shares > 0, "Shares must be greater than zero");
        require(shares <= maxMint(receiver), "Shares exceed limit");

        assets = previewMint(shares);
        require(assets > 0, "Zero assets required");

        // Update state
        userDeposits[receiver] += assets;
        balances[receiver] += shares;
        totalAssets += assets;
        totalShares += shares;

        // Transfer assets from user to vault
        asset.safeTransferFrom(msg.sender, address(this), assets);

        emit Deposit(msg.sender, receiver, assets, shares);
        return assets;
    }

    /**
     * @dev Returns the maximum amount of assets that can be withdrawn by a specific owner
     * @param owner The address of the owner
     * @return maxAssets The maximum amount of assets that can be withdrawn
     */
    function maxWithdraw(
        address owner
    ) public view returns (uint256 maxAssets) {
        uint256 totalAssets = convertToAssets(balances[owner]);
        if (block.timestamp < depositTimestamps[owner] + LOCK_PERIOD) {
            return (totalAssets * INSTANT_WITHDRAWAL_LIMIT) / 100;
        }
        return totalAssets;
    }

    /**
     * @dev Previews the amount of shares that would be burned for a given withdrawal amount
     * @param assets The amount of assets to withdraw
     * @return shares The amount of shares that would be burned
     */
    function previewWithdraw(
        uint256 assets
    ) public view returns (uint256 shares) {
        require(assets > 0, "Assets must be greater than zero");
        shares = convertToShares(assets);
        return shares > 0 ? shares : 1; // Ensure at least 1 share is burned
    }

    /**
     * @dev Withdraws assets to receiver by burning shares from owner
     * @param assets The amount of assets to withdraw
     * @param receiver The address that will receive the assets
     * @param owner The address whose shares will be burned
     * @return shares The amount of shares burned
     */
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public nonReentrant returns (uint256 shares) {
        require(assets > 0, "Assets must be greater than zero");
        require(receiver != address(0), "Invalid receiver");
        require(!emergencyShutdown || msg.sender == owner, "Withdrawals suspended");

        // Calculate available assets
        uint256 stakedAmount = stakedPortions[owner];
        uint256 depositTime = depositTimestamps[owner];
        bool isLocked = block.timestamp < depositTime + LOCK_PERIOD;
        
        if (isLocked) {
        // During lock period, only allow withdrawal of unstaked portion
        uint256 availableBalance = convertToAssets(balances[owner]) - stakedAmount;
        require(assets <= availableBalance, "Cannot withdraw staked portion during lock period");
        }

        shares = previewWithdraw(assets);
        require(shares <= balances[owner], "Insufficient shares");

        // Update locked assets
        if (isLocked) {
            require(lockedAmount >= assets, "Exceeds unlocked amount");
            lockedAssets[owner] -= assets;
            emit LockedAssetsUpdated(owner, lockedAssets[owner]);
        }

        // Verify authorization
        if (msg.sender != owner) {
            // Implement authorization check (e.g., allowance mechanism)
            revert("Not authorized");
        }

        require(shares <= balances[owner], "Insufficient shares");

        // Update state before transfer to prevent reentrancy attacks
        balances[owner] -= shares;
        totalShares -= shares;
        totalAssets -= assets;

        if (!isLocked) {
            // Reset staked portion after lock period
            stakedPortions[owner] = 0;
        }

        // Transfer assets from vault to receiver
        asset.safeTransfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
        return shares;
    }

    /**
     * @dev Returns the maximum amount of shares that can be redeemed by a specific owner
     * @param owner The address of the owner
     * @return maxShares The maximum amount of shares that can be redeemed
     */
    function maxRedeem(address owner) public view returns (uint256 maxShares) {
        return balances[owner];
    }

    /**
     * @dev Previews the amount of assets that would be received for a given redemption amount
     * @param shares The amount of shares to redeem
     * @return assets The amount of assets that would be received
     */
    function previewRedeem(
        uint256 shares
    ) public view returns (uint256 assets) {
        require(shares > 0, "Shares must be greater than zero");
        assets = convertToAssets(shares);
        return assets > 0 ? assets : 1; // Ensure at least 1 asset is returned
    }

    /**
     * @dev Redeems shares from owner and sends assets to receiver
     * @param shares The amount of shares to redeem
     * @param receiver The address that will receive the assets
     * @param owner The address whose shares will be burned
     * @return assets The amount of assets sent to receiver
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public nonReentrant returns (uint256 assets) {
        require(shares > 0, "Shares must be greater than zero");
        require(receiver != address(0), "Invalid receiver");
        require(shares <= balances[owner], "Insufficient shares");

        // Verify authorization
        if (msg.sender != owner) {
            // Implement authorization check (e.g., allowance mechanism)
            revert("Not authorized");
        }

        assets = previewRedeem(shares);
        require(assets > 0, "Assets must be greater than zero");

        // Update state before transfer to prevent reentrancy attacks
        balances[owner] -= shares;
        totalShares -= shares;
        totalAssets -= assets;

        // Transfer assets from vault to receiver
        asset.safeTransfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
        return assets;
    }

    /**
     * @dev Returns the total number of shares issued by the vault
     * @return The total supply of shares
     */
    function totalSupply() public view returns (uint256) {
        return totalShares;
    }

    /**
     * @dev Returns the balance of shares for a specific owner
     * @param owner The address of the owner
     * @return The balance of shares
     */
    function balanceOf(address owner) public view returns (uint256) {
        return balances[owner];
    }

    function setSwapContract(address _swapContract) external {
        require(msg.sender == owner, "Not authorized"); // Add this line
        require(_swapContract != address(0), "Invalid address"); // Add this line
        swapContract = _swapContract;
    }

    // In your Vault contract
function safeTransferAndSwap(uint256 amountOutMin) external returns (uint256) {
    require(swapContract != address(0), "Swap contract not set");
    require(msg.sender == owner || msg.sender == address(this), "Unauthorized");
    require(amountOutMin > 0, "Slippage protection: minimum output amount must be set");
    // Calculate 40% of the vault's USDC balance
    uint256 usdcBalance = USDC.balanceOf(address(this));
    uint256 availableForSwap = (usdcBalance * 40) / 100;
    require(availableForSwap > 0, "Amount too small");
    
    // Ensure we're not touching locked assets
    uint256 totalLockedAssets = getTotalLockedAssets();
    require(usdcBalance - availableForSwap >= totalLockedAssets, "Would affect locked assets");
     uint256 amountToTransfer = availableForSwap;
    // First approve the swap contract to take the USDC directly
    USDC.approve(swapContract, amountToTransfer);
    
    // Call the function that both takes the USDC and performs the swap
    interface ISwapContract {
        function takeAndSwapUSDC(uint256 amount, uint256 amountOutMin) external returns (uint256);
    }
    
    uint256 result = ISwapContract(swapContract).takeAndSwapUSDC(amountToTransfer, amountOutMin);
    emit SwapInitiated(amountToTransfer, amountOutMin);
    // Reset approval to zero after swap is complete
    USDC.approve(swapContract, 0);
    
    return result;
}

    function getUnlockTime(address user) public view returns (uint256) {
        uint256 depositTime = depositTimstamps[user];
        if (depositTime == 0) return 0;
        return depositTime + LOCK_PERIOD;
    }

    function getWithdrawableAmount(address user) public view returns (uint256) {
        uint256 totalBalance = convertToAssets(balances[user]);
        if (block.timestamp >= depositTimestamps[user] + LOCK_PERIOD) {
            return totalBalance;
        }
        return totalBalance - stakedPortions[user]; // Only unstaked portion
    }

    function getLockedAmount(address user) public view returns (uint256) {
        if (block.timestamp >= depositTimestamps[user] + LOCK_PERIOD) {
            return 0;
        }
        return stakedPortions[user]; // Return staked portion
    }

    function getTotalLockedAssets() internal view returns (uint256) {
         uint256 totalStaked = 0;
        for (uint256 i = 0; i < userAddresses.length; i++) {
            address user = userAddresses[i];
            if (block.timestamp < depositTimestamps[user] + LOCK_PERIOD) {
                totalStaked += stakedPortions[user];
            }
        }
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
    // Add implementation
    for (uint256 i = 0; i < userAddresses.length; i++) {
        address user = userAddresses[i];
        if (block.timestamp >= depositTimestamps[user] + LOCK_PERIOD) {
            stakedPortions[user] = 0;
            lockedAssets[user] = 0;
        }
    }
    }

    function toggleEmergencyShutdown() external {
        require(msg.sender == owner, "Not authorized");
        emergencyShutdown = !emergencyShutdown;
        emit EmergencyShutdownToggled(emergencyShutdown);
    }

    function setFeeCollector(address _feeCollector) external {
        require(msg.sender == owner, "Not authorized");
        require(_feeCollector != address(0), "Invalid address");
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(_feeCollector);
    }

}
