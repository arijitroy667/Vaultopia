// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/console.sol";

// Import interfaces
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function transfer(address to, uint256 amount) external returns (bool);

    function decimals() external view returns (uint8);
}

interface IDiamondFacet {
    function deposit(
        uint256 assets,
        address receiver
    ) external returns (uint256);

    function balanceOf(address user) external view returns (uint256);

    function checkContractSetup()
        external
        view
        returns (bool, bool, bool, bool, uint256);

    function previewDeposit(uint256 assets) external view returns (uint256);

    function totalAssets() external view returns (uint256);

    function totalSupply() external view returns (uint256);
}

interface ILido {
    function balanceOf(address account) external view returns (uint256);

    function submit(address _referral) external payable returns (uint256);
}

interface IWstETH {
    function balanceOf(address account) external view returns (uint256);

    function getStETHByWstETH(
        uint256 _wstETHAmount
    ) external view returns (uint256);
}

contract DepositFlowForkTest is Test {
    // Contract addresses on Holesky
    address public constant DIAMOND_ADDRESS =
        0x6A36f5E31cB854573688D6603303C096433f114e;
    address public constant USDC_ADDRESS =
        0x06901fD3D877db8fC8788242F37c1A15f05CEfF8;
    address public constant SWAP_ADDRESS =
        0x5C7cda1d0784d0D662E772A2a5450EA48fd687e2;
    address public constant RECEIVER_ADDRESS =
        0xd000d2399499aB96a3fa023c8964aFBB459AAE6D;
    address public constant LIDO_ADDRESS =
        0x3F1c547b21f65e10480dE3ad8E19fAAC46C95034; // Updated to working Lido address
    address public constant WSTETH_ADDRESS =
        0x8d09a4502Cc8Cf1547aD300E066060D043f6982D;

    // Contracts
    IDiamondFacet public diamondContract;
    IERC20 public usdcContract;
    ILido public lidoContract;
    IWstETH public wstETHContract;

    // Test user
    address public testUser;
    uint256 public userPrivateKey;

    // Test deposit amount (1800 USDC)
    uint256 public depositAmount = 1800 * 10 ** 6; // USDC has 6 decimals

    function setUp() public {
        // Create and fund a test user
        (testUser, userPrivateKey) = makeAddrAndKey("testUser");
        vm.deal(testUser, 2 ether); // Fund with ETH for gas

        // Initialize contracts
        diamondContract = IDiamondFacet(DIAMOND_ADDRESS);
        usdcContract = IERC20(USDC_ADDRESS);
        lidoContract = ILido(LIDO_ADDRESS);
        wstETHContract = IWstETH(WSTETH_ADDRESS);

        // Fund test user with USDC
        // We'll use the contract's existing balance (requires fork) or mint if needed
        address usdcWhale = 0x7613c516e7c04924Ca3d68C1a6eDE09f8c094D14; // An address with USDC on Holesky

        // If we can find a whale address with USDC, use it
        if (usdcContract.balanceOf(usdcWhale) >= depositAmount) {
            vm.startPrank(usdcWhale);
            usdcContract.transfer(testUser, depositAmount);
            vm.stopPrank();
        } else {
            // We're on a fork, so we can directly set storage for test tokens
            // This simulates the testUser having USDC
            deal(address(usdcContract), testUser, depositAmount);
        }
    }

    function testCompleteDepositFlow() public {
        vm.deal(SWAP_ADDRESS, 20 ether);
        console.log(
            "Funded swap contract with ETH: ",
            address(SWAP_ADDRESS).balance / 10 ** 18,
            "ETH"
        );

        vm.startPrank(testUser);

        // STEP 1: Check initial balances and verify contract setup
        uint256 initialUsdcBalance = usdcContract.balanceOf(testUser);
        uint256 initialShareBalance = diamondContract.balanceOf(testUser);

        console.log(
            "Initial USDC balance:",
            initialUsdcBalance / 10 ** 6,
            "USDC"
        );
        console.log("Initial share balance:", initialShareBalance);

        // Verify contract setup
        (
            bool swapContractSet,
            bool receiverContractSet,
            bool lidoContractSet,
            bool wstEthContractSet,
            uint256 vaultUsdcBalance
        ) = diamondContract.checkContractSetup();

        console.log("Contract setup check:");
        console.log(" - Swap contract set:", swapContractSet);
        console.log(" - Receiver contract set:", receiverContractSet);
        console.log(" - Lido contract set:", lidoContractSet);
        console.log(" - wstETH contract set:", wstEthContractSet);
        console.log(" - Vault USDC balance:", vaultUsdcBalance);

        require(swapContractSet, "Swap contract not set");
        require(receiverContractSet, "Receiver contract not set");
        require(lidoContractSet, "Lido contract not set");
        require(wstEthContractSet, "wstETH contract not set");

        // STEP 2: Preview shares to be received
        uint256 expectedShares = diamondContract.previewDeposit(depositAmount);
        console.log("Expected shares:", expectedShares);

        // STEP 3: Approve USDC
        usdcContract.approve(DIAMOND_ADDRESS, depositAmount);
        console.log("USDC approved for vault");

        // Store state before deposit
        uint256 vaultUSDCBefore = usdcContract.balanceOf(DIAMOND_ADDRESS);
        uint256 totalAssetsBefore = diamondContract.totalAssets();
        uint256 totalSupplyBefore = diamondContract.totalSupply();

        // STEP 4: Execute deposit
        console.log("Executing deposit of", depositAmount / 10 ** 6, "USDC");
        try diamondContract.deposit(depositAmount, testUser) returns (
            uint256 sharesReceived
        ) {
            console.log("Deposit successful!");
            console.log("Shares received:", sharesReceived);

            // STEP 5: Verify deposit results
            uint256 finalUsdcBalance = usdcContract.balanceOf(testUser);
            uint256 finalShareBalance = diamondContract.balanceOf(testUser);
            uint256 vaultUSDCAfter = usdcContract.balanceOf(DIAMOND_ADDRESS);

            console.log("\nVerifying results:");
            console.log(
                "USDC spent:",
                (initialUsdcBalance - finalUsdcBalance) / 10 ** 6,
                "USDC"
            );
            console.log(
                "Shares received:",
                finalShareBalance - initialShareBalance
            );
            console.log(
                "Vault USDC increase:",
                (vaultUSDCAfter - vaultUSDCBefore) / 10 ** 6,
                "USDC"
            );

            // Check that full deposit amount was transferred
            assertEq(
                initialUsdcBalance - finalUsdcBalance,
                depositAmount,
                "Wrong USDC amount transferred"
            );

            // Check that shares were received
            assertEq(
                finalShareBalance - initialShareBalance,
                sharesReceived,
                "Wrong shares received"
            );

            // Verify vault state
            uint256 totalAssetsAfter = diamondContract.totalAssets();
            uint256 totalSupplyAfter = diamondContract.totalSupply();

            console.log("\nVault state:");
            console.log(
                "Total assets before:",
                totalAssetsBefore / 10 ** 6,
                "USDC"
            );
            console.log(
                "Total assets after:",
                totalAssetsAfter / 10 ** 6,
                "USDC"
            );
            console.log(
                "Asset increase:",
                (totalAssetsAfter - totalAssetsBefore) / 10 ** 6,
                "USDC"
            );
            console.log("Total supply before:", totalSupplyBefore);
            console.log("Total supply after:", totalSupplyAfter);
            console.log(
                "Supply increase:",
                totalSupplyAfter - totalSupplyBefore
            );
        } catch Error(string memory reason) {
            console.log("Deposit failed with reason:", reason);
            console.log("Failure reason:", reason);
            fail();
        } catch (bytes memory lowLevelData) {
            console.log("Deposit failed with low level error");
            console.log("Low level error occurred");
            fail();
        }

        vm.stopPrank();
    }
}
