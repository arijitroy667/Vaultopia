// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../lib/openzeppelin-contracts/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IUSDC is IERC20 {
    function decimals() external view returns (uint8);

    function approve(address spender, uint256 amount) external returns (bool);
}

contract USDCETHRouter {
    using SafeERC20 for IERC20;
    address public USDC;
    address public receiverContract; // For ETH transfers
    address public vaultContract; // For USDC transfers
    address public owner;

    // Events
    event SwappedUSDCForETH(
        address indexed user,
        uint usdcAmount,
        uint ethAmount
    );
    event SwappedETHForUSDC(
        address indexed user,
        uint ethAmount,
        uint usdcAmount
    );
    event ETHDeposited(address indexed user, uint amount);
    event USDCDeposited(address indexed user, uint amount);
    event ReceiverContractUpdated(
        address indexed oldReceiver,
        address indexed newReceiver
    );
    event VaultContractUpdated(
        address indexed oldVault,
        address indexed newVault
    );

    // Fixed conversion rate: 1 ETH = 500 USDC
    uint public constant RATE_ETH_TO_USDC = 500;

    constructor(
        address _USDC,
        address _receiverContract,
        address _vaultContract
    ) {
        require(_USDC != address(0), "USDCETHRouter: ZERO_USDC");
        require(
            _receiverContract != address(0),
            "USDCETHRouter: ZERO_RECEIVER"
        );
        require(_vaultContract != address(0), "USDCETHRouter: ZERO_VAULT");
        USDC = _USDC;
        receiverContract = _receiverContract;
        vaultContract = _vaultContract; // Default vault contract is the deployer
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "USDCETHRouter: NOT_OWNER");
        _;
    }

    function setReceiverContract(address _receiverContract) external onlyOwner {
        require(_receiverContract != address(0), "USDCETHRouter: ZERO_ADDRESS");
        emit ReceiverContractUpdated(receiverContract, _receiverContract);
        receiverContract = _receiverContract;
    }

    function setVaultContract(address _vaultContract) external onlyOwner {
        require(_vaultContract != address(0), "USDCETHRouter: ZERO_ADDRESS");
        emit VaultContractUpdated(vaultContract, _vaultContract);
        vaultContract = _vaultContract;
    }

    // Required for receiving ETH
    receive() external payable {}

    fallback() external {
        // Code for when no other function matches
    }

    // **** DEPOSIT FUNCTIONS ****

    // Deposit ETH to the contract
    function depositETH() public payable {
        require(msg.value > 0, "USDCETHRouter: ZERO_ETH_DEPOSIT");
        emit ETHDeposited(msg.sender, msg.value);
    }

    // Deposit USDC to the contract
    function depositUSDC(uint amount) external {
        require(amount > 0, "USDCETHRouter: ZERO_USDC_DEPOSIT");
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);
        emit USDCDeposited(msg.sender, amount);
    }

    // **** SWAP FUNCTIONS ****

    // Convert a specific amount of ETH to USDC
    function swapExactETHForUSDC(
        uint amountIn, // Amount in wei (1e18)
        address to
    ) external payable returns (uint amountOut) {
        require(amountIn > 0, "USDCETHRouter: ZERO_ETH_INPUT");

        // Check if the contract has enough ETH balance
        require(
            address(this).balance >= amountIn,
            "USDCETHRouter: INSUFFICIENT_ETH_BALANCE"
        );

        // Calculate USDC amount (ETH:18 decimals, USDC:6 decimals)
        // 1 ETH = 500 USDC, so we multiply by 500
        // Then divide by 10^12 to adjust for decimal difference (18-6=12)
        uint step1 = amountIn * (RATE_ETH_TO_USDC);
        uint usdcAmount = step1 / uint(1e12);

        // Verify we have enough USDC in the contract
        uint contractUSDCBalance = IERC20(USDC).balanceOf(address(this));
        require(
            contractUSDCBalance >= usdcAmount,
            "USDCETHRouter: INSUFFICIENT_USDC_BALANCE"
        );

        // Determine recipient (use vault contract if to is zero address)
        address recipient = to == address(0) ? vaultContract : to;

        // Transfer USDC to the recipient
        IERC20(USDC).safeTransfer(recipient, usdcAmount);

        // Emit event with correct values
        emit SwappedETHForUSDC(msg.sender, amountIn, usdcAmount);

        return usdcAmount;
    }

    // Convert USDC to ETH
    function swapExactUSDCForETH(
        uint amountIn,
        address to
    ) external returns (uint amountOut) {
        require(amountIn > 0, "USDCETHRouter: ZERO_USDC_INPUT");

        // Break down the calculation - REMOVE the *100 to match quote function
        uint step1 = amountIn * (uint(1e12));
        uint ethAmount = step1 / RATE_ETH_TO_USDC;

        // Rest of function stays the same
        uint contractETHBalance = address(this).balance;
        require(
            contractETHBalance >= ethAmount,
            "USDCETHRouter: INSUFFICIENT_ETH_BALANCE"
        );

        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amountIn);

        address recipient = to == address(0) ? receiverContract : to;

        (bool success, ) = payable(recipient).call{value: ethAmount}("");
        require(success, "USDCETHRouter: ETH transfer failed");

        emit SwappedUSDCForETH(msg.sender, amountIn, ethAmount);
        return ethAmount;
    }

    // **** QUOTE FUNCTIONS ****

    // Get quote for ETH → USDC
    function getUSDCAmountOut(
        uint ethAmountIn
    ) external pure returns (uint usdcAmountOut) {
        uint step1 = ethAmountIn * (RATE_ETH_TO_USDC);
        return step1 / (uint(1e12));
    }

    // Get quote for USDC → ETH
    function getETHAmountOut(
        uint usdcAmountIn
    ) external pure returns (uint ethAmountOut) {
        uint step1 = usdcAmountIn * (uint(1e12));
        return step1 / (RATE_ETH_TO_USDC);
    }

    // **** ADMIN FUNCTIONS ****

    // Allow owner to withdraw ETH in case of emergency
    function withdrawETH(uint amount) external onlyOwner {
        require(
            amount <= address(this).balance,
            "USDCETHRouter: INSUFFICIENT_BALANCE"
        );
        (bool success, ) = payable(owner).call{value: amount}("");
        require(success, "USDCETHRouter: ETH transfer failed");
    }

    // Allow owner to withdraw USDC in case of emergency
    function withdrawUSDC(uint amount) external onlyOwner {
        uint balance = IERC20(USDC).balanceOf(address(this));
        require(amount <= balance, "USDCETHRouter: INSUFFICIENT_USDC_BALANCE");
        IERC20(USDC).safeTransfer(owner, amount);
    }
}
