// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/Vault.sol";

// Mock USDC contract
contract MockUSDC is IERC20 {
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
        _totalSupply += amount;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function allowance(
        address owner,
        address spender
    ) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "Transfer from zero");
        require(to != address(0), "Transfer to zero");
        require(_balances[from] >= amount, "Insufficient balance");

        _balances[from] -= amount;
        _balances[to] += amount;
    }

    function _approve(address owner, address spender, uint256 amount) internal {
        _allowances[owner][spender] = amount;
    }

    function _spendAllowance(
        address owner,
        address spender,
        uint256 amount
    ) internal {
        require(
            _allowances[owner][spender] >= amount,
            "Insufficient allowance"
        );
        _allowances[owner][spender] -= amount;
    }
}

// Mock Lido Withdrawal contract
contract MockLidoWithdrawal {
    function requestWithdrawals(
        uint256[] calldata amounts,
        address recipient
    ) external returns (uint256[] memory) {
        uint256[] memory requestIds = new uint256[](amounts.length);
        for (uint256 i = 0; i < amounts.length; i++) {
            requestIds[i] = i + 1;
        }
        return requestIds;
    }

    function claimWithdrawals(uint256[] calldata) external {}

    function isWithdrawalFinalized(uint256) external pure returns (bool) {
        return true;
    }
}

// Test contract
contract VaultTest is Test {
    Yield_Bull vault;
    MockUSDC usdc;
    MockLidoWithdrawal lidoWithdrawal;

    address owner = address(this);
    address user1 = address(1);
    address user2 = address(2);

    uint256 constant INITIAL_BALANCE = 10000 * 1e6; // 10,000 USDC
    uint256 constant DEPOSIT_AMOUNT = 1000 * 1e6; // 1,000 USDC

    function setUp() public {
        // Deploy mock contracts
        usdc = new MockUSDC();
        lidoWithdrawal = new MockLidoWithdrawal();

        // Deploy vault with mock addresses
        vault = new Yield_Bull(
            address(lidoWithdrawal),
            address(this), // mock wstETH
            address(this) // mock receiver
        );

        // Setup initial state
        usdc.mint(user1, INITIAL_BALANCE);
        usdc.mint(user2, INITIAL_BALANCE);

        vm.prank(user1);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(user2);
        usdc.approve(address(vault), type(uint256).max);
    }

    function testDeposit() public {
        vm.startPrank(user1);
        uint256 shares = vault.deposit(DEPOSIT_AMOUNT, user1);
        assertGt(shares, 0, "Should receive shares");
        assertEq(vault.balanceOf(user1), shares, "Incorrect share balance");
        vm.stopPrank();
    }

    // Add more tests...
}
