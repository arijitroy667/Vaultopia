// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// USDC interface
interface IUSDC is IERC20 {
    function decimals() external view returns (uint8);
}

// Lido withdrawal interface
interface ILidoWithdrawal {
    function requestWithdrawals(
        uint256[] calldata amounts,
        address recipient
    ) external returns (uint256[] memory requestIds);

    function claimWithdrawals(uint256[] calldata requestIds) external;

    function isWithdrawalFinalized(
        uint256 requestId
    ) external view returns (bool);
}

// Wrapped stETH interface
interface IWstETH {
    function wrap(uint256 _stETHAmount) external returns (uint256);

    function unwrap(uint256 _wstETHAmount) external returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);
}

// Receiver contract interface
interface IReceiver {
    function batchStakeWithLido(
        bytes32 batchId
    ) external payable returns (uint256);

    function claimWithdrawalFromLido(
        uint256 requestId,
        address user,
        uint256 minUSDCExpected
    ) external returns (uint256);
}

// Swap contract interface
interface ISwapContract {
    // Convert USDC to ETH with slippage protection and destination address
    function swapExactUSDCForETH(
        uint amountIn,
        uint amountOutMin,
        address to,
        uint deadline
    ) external returns (uint amountOut);

    // Convert ETH to USDC with slippage protection and destination address
    function swapExactETHForUSDC(
        uint amountOutMin,
        address to,
        uint deadline
    ) external payable returns (uint amountOut);

    // Get quote for ETH amount from USDC input
    function getETHAmountOut(
        uint usdcAmountIn
    ) external view returns (uint ethAmountOut);

    // Get quote for USDC amount from ETH input
    function getUSDCAmountOut(
        uint ethAmountIn
    ) external view returns (uint usdcAmountOut);
}
