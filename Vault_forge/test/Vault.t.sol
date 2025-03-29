// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../src/Vault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(
        address account
    ) external view override returns (uint256) {
        return _balances[account];
    }

    function transfer(
        address to,
        uint256 amount
    ) external override returns (bool) {
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        return true;
    }

    function allowance(
        address owner,
        address spender
    ) external view override returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(
        address spender,
        uint256 amount
    ) external override returns (bool) {
        _allowances[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external override returns (bool) {
        require(
            _allowances[from][msg.sender] >= amount,
            "Insufficient allowance"
        );
        _allowances[from][msg.sender] -= amount;
        _balances[from] -= amount;
        _balances[to] += amount;
        return true;
    }
}

contract MockLidoWithdrawal {
    function requestWithdrawals(
        uint256[] calldata amounts,
        address
    ) external pure returns (uint256[] memory) {
        uint256[] memory requestIds = new uint256[](amounts.length);
        for (uint i = 0; i < amounts.length; i++) {
            requestIds[i] = i + 1;
        }
        return requestIds;
    }

    function claimWithdrawals(uint256[] calldata) external pure {}

    function isWithdrawalFinalized(uint256) external pure returns (bool) {
        return true;
    }
}

contract MockWstETH {
    function wrap(uint256 _stETHAmount) external pure returns (uint256) {
        return _stETHAmount;
    }

    function unwrap(uint256 _wstETHAmount) external pure returns (uint256) {
        return _wstETHAmount;
    }

    function approve(address, uint256) external pure returns (bool) {
        return true;
    }
}

contract MockReceiver {
    function stakeETHWithLido() external payable returns (uint256) {
        return msg.value;
    }
}

contract MockSwapContract {
    function takeAndSwapUSDC(
        uint256 amount,
        uint256
    ) external pure returns (uint256) {
        return amount;
    }

    function depositETH() external payable {}

    function swapAllETHForUSDC(
        uint256 minUSDCAmount
    ) external pure returns (uint256) {
        return minUSDCAmount;
    }
}

contract VaultTest is Test {
    Yield_Bull public vault;
    MockUSDC public usdc;
    MockLidoWithdrawal public lidoWithdrawal;
    MockWstETH public wstETH;
    MockReceiver public receiver;
    MockSwapContract public swapContract;
    address public owner;
    address public user1;
    address public user2;

    function setUp() public {
        owner = address(this);
        user1 = address(0x1);
        user2 = address(0x2);

        // Deploy mock contracts
        usdc = new MockUSDC();
        lidoWithdrawal = new MockLidoWithdrawal();
        wstETH = new MockWstETH();
        receiver = new MockReceiver();
        swapContract = new MockSwapContract();

        // Give ETH balances
        vm.deal(address(this), 100 ether);
        vm.deal(user1, 10 ether);
        vm.deal(user2, 10 ether);

        // Deploy vault with constructor arguments
        vault = new Yield_Bull(
            address(lidoWithdrawal),
            address(wstETH),
            address(receiver)
        );

        // Set up contracts
        vault.setSwapContract(address(swapContract));
        vault.setFeeCollector(address(this));

        // Label addresses
        vm.label(address(vault), "Vault");
        vm.label(address(usdc), "USDC");
        vm.label(user1, "User1");
        vm.label(user2, "User2");

        // Mint initial USDC balances
        usdc.mint(user1, 10000 * 1e6);
        usdc.mint(user2, 10000 * 1e6);

        // Log setup completion
        console.log("Setup completed successfully");
    }

    // Test functions remain the same
    // ...existing test functions...
}
