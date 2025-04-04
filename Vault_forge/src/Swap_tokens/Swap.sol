// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./ISwapRouter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IWETH {
    function deposit() external payable;

    function withdraw(uint256 amount) external;

    function transfer(
        address recipient,
        uint256 amount
    ) external returns (bool);

    function approve(address spender, uint256 amount) external returns (bool);

    function balanceOf(address account) external view returns (uint256);
}

contract SwapContract {
    ISwapRouter public immutable swapRouter;
    IERC20 public immutable USDC;
    IWETH public immutable WETH;

    address public immutable vaultContract;
    address public immutable receiverContract;

    uint24 public constant poolFee = 3000; // 0.3% Uniswap fee tier

    // Events for logging
    event SwappedUSDCForETH(uint256 usdcAmount, uint256 ethAmount);
    event SwappedETHForUSDC(uint256 ethAmount, uint256 usdcAmount);
    event SwapFailed(uint256 usdcAmount, string reason);

    constructor(
        address _swapRouter,
        address _usdc,
        address _weth,
        address _vaultContract,
        address _receiverContract
    ) {
        require(_swapRouter != address(0), "Invalid SwapRouter address");
        require(_usdc != address(0), "Invalid USDC address");
        require(_weth != address(0), "Invalid WETH address");
        require(_vaultContract != address(0), "Invalid Vault address");
        require(_receiverContract != address(0), "Invalid Receiver address");

        swapRouter = ISwapRouter(_swapRouter);
        USDC = IERC20(_usdc);
        WETH = IWETH(_weth);
        vaultContract = _vaultContract;
        receiverContract = _receiverContract;
    }

    function takeAndSwapUSDC(
        uint256 amount,
        uint256 amountOutMin
    ) external returns (uint256 amountOut) {
        require(msg.sender == vaultContract, "Only vault can call");
        require(amount > 0, "No USDC to swap");
        // Transfer USDC from vault to this contract
        require(
            USDC.transferFrom(vaultContract, address(this), amount),
            "USDC transfer failed"
        );

        // Approve Uniswap to spend the USDC
        USDC.approve(address(swapRouter), amount);

        try
            swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: address(USDC),
                    tokenOut: address(WETH),
                    fee: poolFee,
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: amount,
                    amountOutMinimum: amountOutMin,
                    sqrtPriceLimitX96: 0
                })
            )
        returns (uint256 _amountOut) {
            amountOut = _amountOut;

            // Convert WETH to ETH
            WETH.withdraw(amountOut);

            // Send ETH to Receiver Contract
            (bool success, ) = payable(receiverContract).call{value: amountOut}(
                ""
            );
            require(success, "ETH transfer failed");

            emit SwappedUSDCForETH(amount, amountOut);
            return amountOut;
        } catch Error(string memory reason) {
            // Reset the approval
            USDC.approve(address(swapRouter), 0);

            // Send USDC back to vault
            USDC.transfer(vaultContract, amount);

            emit SwapFailed(amount, reason);
            revert(reason);
        }
    }

    // In your Swap contract
    function recoverUSDC() external {
        require(msg.sender == vaultContract, "Only vault can call");
        uint256 usdcBalance = USDC.balanceOf(address(this));
        if (usdcBalance > 0) {
            USDC.transfer(vaultContract, usdcBalance);
        }
    }

    function swapAllETHForUSDC(
        uint256 amountOutMin
    ) external returns (uint256 amountOut) {
        require(msg.sender == receiverContract, "Only receiver can call");

        uint256 ethBalance = address(this).balance;
        require(ethBalance > 0, "No ETH to swap");

        // Convert ETH to WETH
        WETH.deposit{value: ethBalance}();

        // Approve Uniswap to use WETH
        WETH.approve(address(swapRouter), ethBalance);

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
            .ExactInputSingleParams({
                tokenIn: address(WETH),
                tokenOut: address(USDC),
                fee: poolFee,
                recipient: vaultContract, // Send USDC directly to Vault
                deadline: block.timestamp + 300,
                amountIn: ethBalance,
                amountOutMinimum: amountOutMin,
                sqrtPriceLimitX96: 0
            });

        // Swap ETH (WETH) for USDC
        amountOut = swapRouter.exactInputSingle(params);
        require(amountOut >= amountOutMin, "Slippage exceeded");

        emit SwappedETHForUSDC(ethBalance, amountOut);
        return amountOut;
    }

    function depositUSDC(uint256 amount) external {
        require(msg.sender == vaultContract, "Only vault can deposit");
        require(amount > 0, "Amount must be greater than 0");

        bool success = USDC.transferFrom(vaultContract, address(this), amount);
        require(success, "USDC transfer failed");
    }

    function depositETH() external payable {
        require(msg.sender == receiverContract, "Only receiver can deposit");
        require(msg.value > 0, "Must send ETH");
    }

    function getUSDCBalance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    function getETHBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // Allow receiving ETH
    receive() external payable {
        // Only accept ETH from WETH contract (during unwrapping) or from receiver
        require(
            msg.sender == address(WETH) || msg.sender == receiverContract,
            "Only accept ETH from WETH or receiver"
        );
    }
}
