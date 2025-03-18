// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./interfaces/IUniswapV3Pool.sol";
import "./interfaces/ICurvePool.sol";
import "./Vault.sol";

contract LiquidityProvisionStrategy is Ownable, ReentrancyGuard {
    IVault public vault;
    IERC20 public usdc;

    // Pool configurations
    address public uniswapV3Pool;
    address public curvePool;

    // Allocation percentages (basis points: 10000 = 100%)
    uint256 public uniswapAllocation = 5000; // 50%
    uint256 public curveAllocation = 5000; // 50%

    event Harvested(uint256 amount);
    event Deposited(uint256 amount);
    event Withdrawn(uint256 amount);
    event Rebalanced();

    constructor(
        address _vault,
        address _usdc,
        address _uniswapPool,
        address _curvePool
    ) {
        vault = IVault(_vault);
        usdc = IERC20(_usdc);
        uniswapV3Pool = _uniswapPool;
        curvePool = _curvePool;
    }

    // Core strategy functions
    function deposit() external onlyVault nonReentrant {
        uint256 balance = usdc.balanceOf(address(this));

        // Distribute funds according to allocation
        uint256 uniAmount = (balance * uniswapAllocation) / 10000;
        uint256 curveAmount = balance - uniAmount;

        // Add liquidity to Uniswap
        _addLiquidityUniswap(uniAmount);

        // Add liquidity to Curve
        _addLiquidityCurve(curveAmount);

        emit Deposited(balance);
    }

    function withdraw(
        uint256 amount
    ) external onlyVault nonReentrant returns (uint256) {
        // Calculate how much to withdraw from each pool
        uint256 uniAmount = (amount * uniswapAllocation) / 10000;
        uint256 curveAmount = amount - uniAmount;

        // Remove liquidity from pools
        _removeLiquidityUniswap(uniAmount);
        _removeLiquidityCurve(curveAmount);

        // Return the withdrawn funds to the vault
        uint256 actualWithdrawn = usdc.balanceOf(address(this));
        usdc.transfer(address(vault), actualWithdrawn);

        emit Withdrawn(actualWithdrawn);
        return actualWithdrawn;
    }

    function harvest() external nonReentrant returns (uint256) {
        // Collect fees from all positions
        uint256 feesUniswap = _collectFeesUniswap();
        uint256 feesCurve = _collectFeesCurve();

        uint256 totalHarvested = feesUniswap + feesCurve;

        // Send harvested fees back to vault
        if (totalHarvested > 0) {
            usdc.transfer(address(vault), totalHarvested);
        }

        emit Harvested(totalHarvested);
        return totalHarvested;
    }

    function rebalance() external onlyOwnerOrKeeper {
        // Logic to adjust positions based on market conditions
        // This could involve changing ranges in Uniswap V3
        // or moving between different Curve pools

        emit Rebalanced();
    }

    // Helper functions would be implemented here
    function _addLiquidityUniswap(uint256 amount) internal {
        // Implementation for adding liquidity to Uniswap
    }

    function _addLiquidityCurve(uint256 amount) internal {
        // Implementation for adding liquidity to Curve
    }

    function _removeLiquidityUniswap(
        uint256 amount
    ) internal returns (uint256) {
        // Implementation for removing liquidity from Uniswap
    }

    function _removeLiquidityCurve(uint256 amount) internal returns (uint256) {
        // Implementation for removing liquidity from Curve
    }

    function _collectFeesUniswap() internal returns (uint256) {
        // Implementation for collecting fees from Uniswap positions
    }

    function _collectFeesCurve() internal returns (uint256) {
        // Implementation for collecting fees from Curve positions
    }

    // Access control modifier
    modifier onlyVault() {
        require(msg.sender == address(vault), "Only vault can call");
        _;
    }

    modifier onlyOwnerOrKeeper() {
        // Logic to allow certain addresses to call rebalance
        _;
    }
}
