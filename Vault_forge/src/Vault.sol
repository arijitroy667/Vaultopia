// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

// Updated OpenZeppelin imports
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswap/v3-periphery/contracts/libraries/PositionKey.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

/**
 * @title Yield_Bull
 * @dev An ERC4626-compliant vault implementation with deposit limits per user
 */
contract Yield_Bull is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    string public name = "Yield Bull Vault";
    string public symbol = "YBV";

    function decimals() public view returns (uint8) {
        return _decimals;
    }

    // Add transfer and allowance functionality if needed

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

    // State variables
    address public immutable ASSET_TOKEN_ADDRESS =
        0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    uint256 public constant MAX_DEPOSIT_PER_USER = 499 * 1e6;

    mapping(address => uint256) public userDeposits;
    mapping(address => uint256) public balances;

    uint256 public totalAssets; // Total assets in the vault
    uint256 public totalShares; // Total shares issued by the vault

    IERC20 public immutable asset;
    uint8 private immutable _decimals;

    // Uniswap V3 contracts
    IUniswapV3Factory public immutable uniswapFactory;
    INonfungiblePositionManager public immutable positionManager;

    // Pair configuration
    address public immutable pairToken; // Token to pair with the asset
    uint24 public immutable poolFee; // Fee tier for the pool (e.g., 0.3% = 3000)

    // Position tracking
    mapping(uint256 => bool) public activePositions; // Tracking NFT position IDs
    uint256[] public positionIds; // Array of position IDs

    constructor(
        address _pairToken,
        uint24 _poolFee,
        address _uniswapFactory,
        address _positionManager
    ) {
        asset = IERC20(ASSET_TOKEN_ADDRESS);
        _decimals = IERC20Metadata(ASSET_TOKEN_ADDRESS).decimals();

        pairToken = _pairToken;
        poolFee = _poolFee;
        uniswapFactory = IUniswapV3Factory(_uniswapFactory);
        positionManager = INonfungiblePositionManager(_positionManager);

        // Approve position manager to spend tokens
        IERC20(ASSET_TOKEN_ADDRESS).approve(
            _positionManager,
            type(uint256).max
        );
        IERC20(_pairToken).approve(_positionManager, type(uint256).max);
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

    function createPosition(
        uint256 amount,
        int24 tickLower,
        int24 tickUpper
    ) internal returns (uint256 positionId) {
        // Calculate the amount of pair token to use (can be adjusted based on strategy)
        uint256 pairTokenAmount = calculatePairTokenAmount(amount);

        // Prepare parameters for position creation
        INonfungiblePositionManager.MintParams memory params = INonfungiblePositionManager
            .MintParams({
                token0: address(asset) < pairToken ? address(asset) : pairToken,
                token1: address(asset) < pairToken ? pairToken : address(asset),
                fee: poolFee,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: address(asset) < pairToken
                    ? amount
                    : pairTokenAmount,
                amount1Desired: address(asset) < pairToken
                    ? pairTokenAmount
                    : amount,
                amount0Min: 0, // Set minimum based on slippage tolerance
                amount1Min: 0, // Set minimum based on slippage tolerance
                recipient: address(this),
                deadline: block.timestamp + 300 // 5 minutes
            });

        // Create the position
        (positionId, , , ) = positionManager.mint(params);

        // Track the position
        activePositions[positionId] = true;
        positionIds.push(positionId);

        return positionId;
    }

    function collectFees(
        uint256 positionId
    ) internal returns (uint256 collected0, uint256 collected1) {
        // Prepare parameters for fee collection
        INonfungiblePositionManager.CollectParams
            memory params = INonfungiblePositionManager.CollectParams({
                tokenId: positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            });

        // Collect fees
        (collected0, collected1) = positionManager.collect(params);

        return (collected0, collected1);
    }

    function removeLiquidity(
        uint256 positionId
    ) internal returns (uint256 amount0, uint256 amount1) {
        // Get position info
        (, , , , , , , uint128 liquidity, , , , ) = positionManager.positions(
            positionId
        );

        // Prepare parameters for liquidity removal
        INonfungiblePositionManager.DecreaseLiquidityParams
            memory params = INonfungiblePositionManager
                .DecreaseLiquidityParams({
                    tokenId: positionId,
                    liquidity: liquidity,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp + 300
                });

        // Remove liquidity
        (amount0, amount1) = positionManager.decreaseLiquidity(params);

        // Collect the tokens
        collectFees(positionId);

        return (amount0, amount1);
    }

    function harvestAll() public onlyOwner {
        uint256 assetBalanceBefore = asset.balanceOf(address(this));
        uint256 pairTokenBalanceBefore = IERC20(pairToken).balanceOf(
            address(this)
        );

        // Process all positions
        for (uint256 i = 0; i < positionIds.length; i++) {
            uint256 positionId = positionIds[i];
            if (activePositions[positionId]) {
                collectFees(positionId);
            }
        }

        // Calculate harvested amounts
        uint256 harvestedAsset = asset.balanceOf(address(this)) -
            assetBalanceBefore;
        uint256 harvestedPairToken = IERC20(pairToken).balanceOf(
            address(this)
        ) - pairTokenBalanceBefore;

        // Swap harvested pair token to asset if needed
        if (harvestedPairToken > 0) {
            uint256 additionalAsset = swapToAsset(harvestedPairToken);
            harvestedAsset += additionalAsset;
        }

        // Update totalAssets with harvested amount
        totalAssets += harvestedAsset;
    }

    function calculatePairTokenAmount(
        uint256 assetAmount
    ) internal view returns (uint256) {
        address pool = uniswapFactory.getPool(
            address(asset),
            pairToken,
            poolFee
        );
        require(pool != address(0), "Pool does not exist");

        // Get the current price from the pool
        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3Pool(pool).slot0();

        // Calculate price from sqrtPriceX96
        uint256 price;
        if (address(asset) < pairToken) {
            // asset is token0, pairToken is token1
            // price = (sqrtPriceX96 * sqrtPriceX96) / 2^192
            price = (uint256(sqrtPriceX96) * uint256(sqrtPriceX96)) >> 192;
        } else {
            // pairToken is token0, asset is token1
            // price = 2^192 / (sqrtPriceX96 * sqrtPriceX96)
            price =
                (1 << 192) /
                (uint256(sqrtPriceX96) * uint256(sqrtPriceX96));
        }

        // Calculate equivalent amount of pair token
        return
            (assetAmount * price) /
            (10 ** uint256(IERC20Metadata(address(asset)).decimals()));
    }

    function swapToAsset(uint256 pairTokenAmount) internal returns (uint256) {
        // Approve the router to spend pair tokens
        IERC20(pairToken).approve(address(swapRouter), pairTokenAmount);

        // Set up the parameters for the swap
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
            .ExactInputSingleParams({
                tokenIn: pairToken,
                tokenOut: address(asset),
                fee: poolFee,
                recipient: address(this),
                deadline: block.timestamp + 300,
                amountIn: pairTokenAmount,
                amountOutMinimum: 0, // Consider implementing slippage protection
                sqrtPriceLimitX96: 0
            });

        // Execute the swap
        uint256 amountOut = swapRouter.exactInputSingle(params);
        return amountOut;
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

        // Update state
        userDeposits[receiver] += assets;
        balances[receiver] += shares;

        // Transfer assets from user to vault
        asset.safeTransferFrom(msg.sender, address(this), assets);

        // Deploy some percentage of the assets to Uniswap V3
        uint256 deployAmount = (assets * deploymentRatio) / 10000; // deploymentRatio is a percentage with 2 decimals
        if (deployAmount > 0) {
            // Use a strategy for tick range calculation
            (int24 tickLower, int24 tickUpper) = calculateTickRange();
            createPosition(deployAmount, tickLower, tickUpper);
        }

        totalAssets += assets;
        totalShares += shares;

        emit Deposit(msg.sender, receiver, assets, shares);
        return shares;
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
        return convertToAssets(balanceOf(owner));
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

        shares = previewWithdraw(assets);
        require(shares > 0, "Shares must be greater than zero");

        // Verify authorization
        if (msg.sender != owner) {
            revert("Not authorized");
        }

        require(shares <= balances[owner], "Insufficient shares");

        // Update state before transfer
        balances[owner] -= shares;
        totalShares -= shares;
        totalAssets -= assets;

        // Check if we need to withdraw from Uniswap positions
        uint256 availableAssets = asset.balanceOf(address(this));
        if (availableAssets < assets) {
            uint256 neededAssets = assets - availableAssets;
            withdrawFromPositions(neededAssets);
        }

        // Transfer assets from vault to receiver
        asset.safeTransfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
        return shares;
    }

    function calculateTickRange()
        internal
        view
        returns (int24 tickLower, int24 tickUpper)
    {
        // Get current price from the pool
        address pool = uniswapFactory.getPool(
            address(asset),
            pairToken,
            poolFee
        );
        require(pool != address(0), "Pool does not exist");

        // Example strategy: Provide liquidity within ±5% of the current price
        // This is a placeholder for a more sophisticated strategy
        int24 tickSpacing = IUniswapV3Pool(pool).tickSpacing();

        // Get current tick
        (, int24 currentTick, , , , , ) = IUniswapV3Pool(pool).slot0();

        // Calculate tick range
        tickLower = currentTick - 10 * tickSpacing;
        tickUpper = currentTick + 10 * tickSpacing;

        // Ensure ticks are properly spaced
        tickLower = (tickLower / tickSpacing) * tickSpacing;
        tickUpper = (tickUpper / tickSpacing) * tickSpacing;

        return (tickLower, tickUpper);
    }

    function withdrawFromPositions(uint256 neededAssets) internal {
        uint256 withdrawnAssets = 0;
        uint256 i = 0;

        while (withdrawnAssets < neededAssets && i < positionIds.length) {
            uint256 positionId = positionIds[i];
            if (activePositions[positionId]) {
                // Remove liquidity
                (uint256 amount0, uint256 amount1) = removeLiquidity(
                    positionId
                );

                // Calculate how much of the asset we got
                uint256 assetAmount = address(asset) < pairToken
                    ? amount0
                    : amount1;
                withdrawnAssets += assetAmount;

                // Convert the pair token to asset if needed
                uint256 pairTokenAmount = address(asset) < pairToken
                    ? amount1
                    : amount0;
                if (pairTokenAmount > 0) {
                    uint256 additionalAsset = swapToAsset(pairTokenAmount);
                    withdrawnAssets += additionalAsset;
                }

                // Mark position as inactive
                activePositions[positionId] = false;
            }
            i++;
        }

        require(withdrawnAssets >= neededAssets, "Insufficient liquidity");
    }

    function rebalance() external onlyOwner {
        // Harvest all fees first
        harvestAll();

        // Close all positions
        for (uint256 i = 0; i < positionIds.length; i++) {
            uint256 positionId = positionIds[i];
            if (activePositions[positionId]) {
                removeLiquidity(positionId);
                activePositions[positionId] = false;
            }
        }

        // Clear position tracking
        delete positionIds;

        // Calculate how much to deploy
        uint256 deployAmount = (totalAssets * deploymentRatio) / 10000;

        // Create new positions with updated parameters
        if (deployAmount > 0) {
            (int24 tickLower, int24 tickUpper) = calculateTickRange();
            createPosition(deployAmount, tickLower, tickUpper);
        }
    }

    address public owner;
    uint256 public deploymentRatio = 8000; // 80% by default

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    function setDeploymentRatio(uint256 _ratio) external onlyOwner {
        require(_ratio <= 10000, "Invalid ratio");
        deploymentRatio = _ratio;
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
}
